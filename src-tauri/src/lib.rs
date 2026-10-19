mod git;
mod history;
mod watcher;

use std::{
    fs,
    io::{ErrorKind, Write},
    path::Path,
    sync::Mutex,
    time::Duration,
};
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    Emitter, Manager,
};

use history::{History, Reason, Version, WriteError};
use watcher::Watcher;

/// A file the OS asked us to open before the frontend was ready to receive it.
#[derive(Default)]
struct PendingFile(Mutex<Option<String>>);

const MARKDOWN_EXTENSIONS: [&str; 4] = ["md", "markdown", "mdx", "mdown"];
const MAX_DEPTH: usize = 4;
const MAX_FILES: usize = 2000;
const IMAGE_EXTENSIONS: [&str; 12] = [
    "png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp", "ico", "heic", "tif", "tiff",
];
/// The folder beside a note that its uploaded images are written to.
const ASSETS_DIR: &str = "assets";
const MAX_PAGE_BYTES: usize = 600_000;
const PAGE_USER_AGENT: &str = "Mozilla/5.0 (Macintosh) Grimm/0.1 LinkPreview";

#[derive(serde::Serialize)]
struct Page {
    /// The address after redirects, used to resolve relative image and icon paths.
    url: String,
    html: String,
}

/// Downloads the start of a web page so the frontend can read its title,
/// description and preview image for a link card.
#[tauri::command]
async fn fetch_page(url: String) -> Result<Page, String> {
    let url = reqwest::Url::parse(&url).map_err(|e| e.to_string())?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("only http and https links can be previewed".into());
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .user_agent(PAGE_USER_AGENT)
        .build()
        .map_err(|e| e.to_string())?;
    let mut response = client
        .get(url)
        .header(reqwest::header::ACCEPT, "text/html,application/xhtml+xml")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let is_html = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.contains("html"));
    let mut body = Vec::new();
    if is_html {
        // The metadata lives in <head>, so the rest of a large page is not needed.
        while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
            body.extend_from_slice(&chunk);
            if body.len() >= MAX_PAGE_BYTES {
                break;
            }
        }
    }
    Ok(Page {
        url: response.url().to_string(),
        html: String::from_utf8_lossy(&body).into_owned(),
    })
}

#[derive(serde::Serialize)]
struct Opened {
    contents: String,
    /// What the note's later writes are checked against, so they never
    /// overwrite a newer file from outside.
    hash: String,
}

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// Reads a note to open it, keeping its contents as the first version of this session.
#[tauri::command]
fn open_note(history: tauri::State<History>, path: String) -> Result<Opened, String> {
    let contents = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let hash = history.opened(&path, &contents);
    Ok(Opened { contents, hash })
}

/// What a write is refused with when the file changed since `base`. The new
/// contents arrive separately, as a "file-changed" event.
const CHANGED_ON_DISK: &str = "changed-on-disk";

/// Writes a note and returns the hash of what is now on disk. See [`History::write`] for `base`.
#[tauri::command]
fn write_file(
    app: tauri::AppHandle,
    history: tauri::State<History>,
    path: String,
    contents: String,
    base: Option<String>,
) -> Result<String, String> {
    match history.write(&path, &contents, base.as_deref()) {
        Ok(hash) => Ok(hash),
        Err(WriteError::Changed(change)) => {
            let _ = app.emit("file-changed", change);
            Err(CHANGED_ON_DISK.into())
        }
        Err(WriteError::Io(e)) => Err(e),
    }
}

#[tauri::command]
fn snapshot_note(history: tauri::State<History>, path: String, contents: String, reason: Reason) {
    history.record(&path, &contents, reason);
}

#[tauri::command]
fn list_versions(history: tauri::State<History>, path: String) -> Vec<Version> {
    history.versions(&path)
}

#[tauri::command]
fn read_version(history: tauri::State<History>, hash: String) -> Result<String, String> {
    history.read(&hash)
}

/// Writes an old version back to the note and returns its hash.
#[tauri::command]
fn restore_version(
    history: tauri::State<History>,
    path: String,
    current: String,
    hash: String,
) -> Result<String, String> {
    history.restore(&path, &current, &hash)
}

#[tauri::command]
fn copy_history(history: tauri::State<History>, from: String, to: String) {
    history.copy(&from, &to);
}

/// Where a note's git repository is and which of its files have uncommitted
/// changes, or None for a note that isn't in one.
#[tauri::command]
async fn git_info(note: String, files: Vec<String>) -> Option<git::GitInfo> {
    tauri::async_runtime::spawn_blocking(move || git::info(&note, &files)).await.ok().flatten()
}

/// Commits a note and the images it uses; returns the commit's short hash.
#[tauri::command]
async fn git_commit(note: String, files: Vec<String>, message: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || git::commit(&note, &files, &message))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn watch_notes(watcher: tauri::State<Watcher>, paths: Vec<String>) {
    watcher.watch(paths);
}

#[tauri::command]
fn list_markdown_files(dir: String) -> Result<Vec<String>, String> {
    let mut files = Vec::new();
    collect_markdown(Path::new(&dir), 0, &mut files).map_err(|e| e.to_string())?;
    files.sort_by_key(|p| p.to_lowercase());
    Ok(files)
}

fn collect_markdown(dir: &Path, depth: usize, out: &mut Vec<String>) -> std::io::Result<()> {
    for entry in fs::read_dir(dir)?.flatten() {
        if out.len() >= MAX_FILES {
            break;
        }
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || name == "node_modules" || name == "target" {
            continue;
        }
        if path.is_dir() {
            if depth < MAX_DEPTH {
                // Unreadable subfolders are skipped rather than failing the whole listing.
                let _ = collect_markdown(&path, depth + 1, out);
            }
        } else if is_markdown(&path) {
            out.push(path.to_string_lossy().to_string());
        }
    }
    Ok(())
}

fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| MARKDOWN_EXTENSIONS.contains(&e.to_lowercase().as_str()))
}

fn image_extension(path: &Path) -> Option<String> {
    let extension = path.extension()?.to_str()?.to_lowercase();
    IMAGE_EXTENSIONS.contains(&extension.as_str()).then_some(extension)
}

/// Writes an uploaded image into the `assets` folder beside a note and returns
/// its path relative to the note, which is what goes into the Markdown.
///
/// The image bytes are the raw request body, so they skip JSON encoding; the
/// note's path and the picked file's name arrive percent-encoded in headers.
#[tauri::command]
fn save_image(request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("the image data is missing".into());
    };
    let header = |name: &str| -> Result<String, String> {
        let value = request
            .headers()
            .get(name)
            .and_then(|value| value.to_str().ok())
            .ok_or_else(|| format!("the {name} header is missing"))?;
        percent_encoding::percent_decode_str(value)
            .decode_utf8()
            .map(|decoded| decoded.into_owned())
            .map_err(|e| e.to_string())
    };
    let note = header("note")?;
    let name = header("name")?;
    write_image(Path::new(&note), &name, bytes)
}

fn write_image(note: &Path, name: &str, bytes: &[u8]) -> Result<String, String> {
    if bytes.is_empty() {
        return Err("the image is empty".into());
    }
    let folder = note
        .parent()
        .filter(|_| note.is_absolute())
        .ok_or("the note has no folder")?;
    let name = Path::new(name);
    let extension = image_extension(name).ok_or("that file is not an image")?;
    // Plain names keep the Markdown link free of escapes and angle brackets.
    let mut stem = String::new();
    for c in name.file_stem().and_then(|s| s.to_str()).unwrap_or_default().chars() {
        if c.is_ascii_alphanumeric() || c == '_' {
            stem.push(c);
        } else if !stem.ends_with('-') {
            stem.push('-');
        }
    }
    let stem = stem.trim_matches('-');
    let stem = if stem.is_empty() { "image" } else { stem };

    let dir = folder.join(ASSETS_DIR);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    for n in 1.. {
        let file_name = match n {
            1 => format!("{stem}.{extension}"),
            _ => format!("{stem}-{n}.{extension}"),
        };
        let path = dir.join(&file_name);
        match fs::OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut file) => {
                if let Err(e) = file.write_all(bytes) {
                    let _ = fs::remove_file(&path);
                    return Err(e.to_string());
                }
            }
            // The same picture uploaded again reuses the file; a different one gets the next name.
            Err(e) if e.kind() == ErrorKind::AlreadyExists => {
                if fs::read(&path).map_or(true, |existing| existing != bytes) {
                    continue;
                }
            }
            Err(e) => return Err(e.to_string()),
        }
        return Ok(format!("{ASSETS_DIR}/{file_name}"));
    }
    unreachable!()
}

/// Lets the webview load one local image through the asset protocol. Nothing
/// is in that scope to begin with, so only images a note points at are readable.
#[tauri::command]
fn allow_image(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let path = Path::new(&path);
    if !path.is_file() || image_extension(path).is_none() {
        return Err("not an image file".into());
    }
    app.asset_protocol_scope()
        .allow_file(path)
        .map_err(|e| e.to_string())
}

/// Whether a note still exists, for listing shared pages whose file may have moved.
#[tauri::command]
fn file_exists(path: String) -> bool {
    Path::new(&path).is_file()
}

/// Renames or moves a note. Never replaces another file: a name that is taken
/// is refused, except a change of capitals only ("chapter.md" to "Chapter.md"),
/// which on macOS is the same file. Between disks, where a plain rename cannot
/// work, the note is copied and the original removed.
#[tauri::command]
fn rename_path(history: tauri::State<History>, from: String, to: String) -> Result<(), String> {
    move_note(Path::new(&from), Path::new(&to))?;
    history.moved(&from, &to);
    Ok(())
}

fn move_note(from: &Path, to: &Path) -> Result<(), String> {
    if !from.is_file() {
        return Err("the note is no longer there".into());
    }
    if !to.parent().is_some_and(Path::is_dir) {
        return Err("that folder does not exist".into());
    }
    if from == to {
        return Ok(());
    }
    let same_file = to.exists() && fs::canonicalize(from).ok() == fs::canonicalize(to).ok();
    if to.exists() && !same_file {
        let name = to.file_name().and_then(|n| n.to_str()).unwrap_or("that name");
        return Err(format!("“{name}” already exists there"));
    }
    match fs::rename(from, to) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == ErrorKind::CrossesDevices => {
            // Created fresh so a file that appeared meanwhile is still never replaced.
            let bytes = fs::read(from).map_err(|e| e.to_string())?;
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(to)
                .map_err(|e| e.to_string())?;
            file.write_all(&bytes).map_err(|e| e.to_string())?;
            fs::remove_file(from).map_err(|e| e.to_string())
        }
        Err(e) => Err(e.to_string()),
    }
}

/// Copies an image a note uses into the `assets` folder beside the note's new
/// place, for a note that moved folders; returns the new relative path.
#[tauri::command]
fn copy_image(note: String, source: String) -> Result<String, String> {
    let source = Path::new(&source);
    image_extension(source).ok_or("that file is not an image")?;
    let bytes = fs::read(source).map_err(|e| e.to_string())?;
    let name = source.file_name().and_then(|n| n.to_str()).unwrap_or("image");
    write_image(Path::new(&note), name, &bytes)
}

/// Makes a new, empty folder for notes. Fails if something is already there.
#[tauri::command]
fn create_dir(path: String) -> Result<(), String> {
    std::fs::create_dir(&path).map_err(|e| e.to_string())
}

/// When a note was last written, in milliseconds since the epoch, for the "Edited" label.
#[tauri::command]
fn modified_at(path: String) -> Result<u64, String> {
    let modified = std::fs::metadata(&path)
        .and_then(|meta| meta.modified())
        .map_err(|e| e.to_string())?;
    let since = modified
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?;
    Ok(since.as_millis() as u64)
}

#[tauri::command]
fn take_pending_file(state: tauri::State<PendingFile>) -> Option<String> {
    state.0.lock().unwrap().take()
}

/// Builds the menu bar, returning it with its Help submenu. Custom items are
/// forwarded to the frontend as "menu" events carrying the item id, which is
/// where the commands are implemented.
fn build_menu(
    app: &tauri::AppHandle,
) -> tauri::Result<(tauri::menu::Menu<tauri::Wry>, tauri::menu::Submenu<tauri::Wry>)> {
    let item = |id: &str, text: &str, accelerator: &str| {
        MenuItemBuilder::with_id(id, text)
            .accelerator(accelerator)
            .build(app)
    };

    let app_menu = SubmenuBuilder::new(app, "Grimm")
        .about(None)
        .text("check-updates", "Check for Updates…")
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .item(&item("quit", "Quit Grimm", "CmdOrCtrl+Q")?)
        .build()?;
    let file = SubmenuBuilder::new(app, "File")
        .item(&item("new", "New Document", "CmdOrCtrl+N")?)
        .item(&item("open", "Open…", "CmdOrCtrl+O")?)
        .item(&item("open-folder", "Open Folder…", "CmdOrCtrl+Shift+O")?)
        .separator()
        .item(&item("save", "Save", "CmdOrCtrl+S")?)
        .item(&item("save-as", "Save As…", "CmdOrCtrl+Shift+S")?)
        .item(&item("history", "Version History…", "CmdOrCtrl+Alt+Y")?)
        .item(&item("commit", "Commit…", "CmdOrCtrl+Alt+K")?)
        .separator()
        .text("share", "Share…")
        .text("shared-pages", "Shared Pages…")
        .separator()
        .item(&item("close-tab", "Close Tab", "CmdOrCtrl+W")?)
        .build()?;
    let edit = SubmenuBuilder::new(app, "Edit")
        // Not the native items: those only undo typing, not edits the editor makes itself.
        .item(&item("undo", "Undo", "CmdOrCtrl+Z")?)
        .item(&item("redo", "Redo", "CmdOrCtrl+Shift+Z")?)
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let view = SubmenuBuilder::new(app, "View")
        .item(&item("toggle-sidebar", "Toggle Sidebar", "CmdOrCtrl+Backslash")?)
        .item(&item("toggle-split", "Toggle Split View", "CmdOrCtrl+Shift+Backslash")?)
        .item(&item("toggle-source", "Toggle Markdown Source", "CmdOrCtrl+Slash")?)
        .separator()
        .fullscreen()
        .build()?;
    let window = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .separator()
        .item(&item("next-tab", "Next Tab", "CmdOrCtrl+Shift+BracketRight")?)
        .item(&item("prev-tab", "Previous Tab", "CmdOrCtrl+Shift+BracketLeft")?)
        .build()?;

    let help = SubmenuBuilder::new(app, "Help")
        .text("help", "Grimm Help")
        .separator()
        .text("onboarding", "Welcome Screen")
        .text("welcome", "Welcome to Grimm")
        .text("features", "Features")
        .text("examples", "Examples")
        .build()?;

    let menu = MenuBuilder::new(app)
        .items(&[&app_menu, &file, &edit, &view, &window, &help])
        .build()?;
    Ok((menu, help))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(PendingFile::default())
        .setup(|app| {
            let (menu, _help) = build_menu(app.handle())?;
            app.set_menu(menu)?;
            // Gives the Help menu its search field and standard place in the menu bar.
            #[cfg(target_os = "macos")]
            _help.set_as_help_menu_for_nsapp()?;
            let data = app.path().app_data_dir()?;
            let history = History::open(data.join("history"));
            app.manage(history);
            app.manage(Watcher::new(app.handle()));
            // Thinning leaves texts no version needs; clearing them can wait until after startup.
            let handle = app.handle().clone();
            std::thread::spawn(move || handle.state::<History>().collect_garbage());
            app.on_menu_event(|app, event| {
                let _ = app.emit("menu", event.id().as_ref());
            });
            if let Some(arg) = std::env::args().nth(1) {
                if Path::new(&arg).is_file() {
                    *app.state::<PendingFile>().0.lock().unwrap() = Some(arg);
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_file,
            open_note,
            write_file,
            snapshot_note,
            list_versions,
            read_version,
            restore_version,
            copy_history,
            watch_notes,
            git_info,
            git_commit,
            list_markdown_files,
            fetch_page,
            save_image,
            allow_image,
            file_exists,
            modified_at,
            create_dir,
            rename_path,
            copy_image,
            take_pending_file
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, _event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = _event {
                for url in urls {
                    if let Ok(path) = url.to_file_path() {
                        let path = path.to_string_lossy().to_string();
                        *_app.state::<PendingFile>().0.lock().unwrap() = Some(path.clone());
                        let _ = _app.emit("open-file", path);
                    }
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn images_are_written_beside_the_note() {
        let dir = std::env::temp_dir().join(format!("grimm-images-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let note = dir.join("note.md");

        assert_eq!(write_image(&note, "My Photo (1).PNG", b"one").unwrap(), "assets/My-Photo-1.png");
        assert_eq!(fs::read(dir.join("assets/My-Photo-1.png")).unwrap(), b"one");
        // Same bytes reuse the file, different bytes never overwrite it.
        assert_eq!(write_image(&note, "My Photo (1).PNG", b"one").unwrap(), "assets/My-Photo-1.png");
        assert_eq!(write_image(&note, "My Photo (1).PNG", b"two").unwrap(), "assets/My-Photo-1-2.png");
        assert_eq!(fs::read(dir.join("assets/My-Photo-1.png")).unwrap(), b"one");
        assert_eq!(write_image(&note, "../../é.jpg", b"three").unwrap(), "assets/image.jpg");

        assert!(write_image(&note, "script.sh", b"x").is_err());
        assert!(write_image(&note, "empty.png", b"").is_err());
        assert!(write_image(Path::new("note.md"), "a.png", b"x").is_err());
        fs::remove_dir_all(&dir).unwrap();
    }

    fn scratch(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("grimm-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn notes_are_renamed_and_moved() {
        let dir = scratch("rename");
        fs::create_dir_all(dir.join("drafts")).unwrap();
        fs::write(dir.join("a.md"), "alpha").unwrap();

        move_note(&dir.join("a.md"), &dir.join("b.md")).unwrap();
        assert!(!dir.join("a.md").exists());
        assert_eq!(fs::read_to_string(dir.join("b.md")).unwrap(), "alpha");

        move_note(&dir.join("b.md"), &dir.join("drafts/b.md")).unwrap();
        assert_eq!(fs::read_to_string(dir.join("drafts/b.md")).unwrap(), "alpha");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_rename_never_replaces_another_note() {
        let dir = scratch("clash");
        fs::write(dir.join("a.md"), "alpha").unwrap();
        fs::write(dir.join("b.md"), "beta").unwrap();

        let err = move_note(&dir.join("a.md"), &dir.join("b.md")).unwrap_err();
        assert!(err.contains("already exists"), "{err}");
        assert_eq!(fs::read_to_string(dir.join("a.md")).unwrap(), "alpha");
        assert_eq!(fs::read_to_string(dir.join("b.md")).unwrap(), "beta");

        assert!(move_note(&dir.join("gone.md"), &dir.join("c.md")).is_err());
        assert!(move_note(&dir.join("a.md"), &dir.join("no-such-folder/a.md")).is_err());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_change_of_capitals_is_a_rename() {
        let dir = scratch("case");
        fs::write(dir.join("chapter.md"), "text").unwrap();
        move_note(&dir.join("chapter.md"), &dir.join("Chapter.md")).unwrap();
        let names: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().into_string().unwrap())
            .collect();
        assert_eq!(names, ["Chapter.md"]);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn images_are_copied_beside_a_moved_note() {
        let dir = scratch("copy-image");
        fs::create_dir_all(dir.join("old/assets")).unwrap();
        fs::create_dir_all(dir.join("new")).unwrap();
        fs::write(dir.join("old/assets/cat.png"), b"cat").unwrap();
        let note = dir.join("new/note.md").to_string_lossy().into_owned();
        let source = dir.join("old/assets/cat.png").to_string_lossy().into_owned();

        assert_eq!(copy_image(note.clone(), source.clone()).unwrap(), "assets/cat.png");
        assert_eq!(fs::read(dir.join("new/assets/cat.png")).unwrap(), b"cat");
        // The original stays: another note may still use it.
        assert!(dir.join("old/assets/cat.png").exists());
        // Copying again reuses the copy.
        assert_eq!(copy_image(note.clone(), source).unwrap(), "assets/cat.png");
        assert!(copy_image(note, dir.join("old/notes.txt").to_string_lossy().into_owned()).is_err());
        fs::remove_dir_all(&dir).unwrap();
    }
}
