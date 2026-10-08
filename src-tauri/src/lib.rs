use std::{fs, path::Path, sync::Mutex, time::Duration};
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    Emitter, Manager,
};

/// A file the OS asked us to open before the frontend was ready to receive it.
#[derive(Default)]
struct PendingFile(Mutex<Option<String>>);

const MARKDOWN_EXTENSIONS: [&str; 4] = ["md", "markdown", "mdx", "mdown"];
const MAX_DEPTH: usize = 4;
const MAX_FILES: usize = 2000;
const MAX_PAGE_BYTES: usize = 600_000;
const PAGE_USER_AGENT: &str = "Mozilla/5.0 (Macintosh) Folio/0.1 LinkPreview";

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

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_file(path: String, contents: String) -> Result<(), String> {
    fs::write(&path, contents).map_err(|e| e.to_string())
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
        } else if path
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| MARKDOWN_EXTENSIONS.contains(&e.to_lowercase().as_str()))
        {
            out.push(path.to_string_lossy().to_string());
        }
    }
    Ok(())
}

#[tauri::command]
fn take_pending_file(state: tauri::State<PendingFile>) -> Option<String> {
    state.0.lock().unwrap().take()
}

/// Builds the menu bar. Custom items are forwarded to the frontend as "menu"
/// events carrying the item id, which is where the commands are implemented.
fn build_menu(app: &tauri::AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    let item = |id: &str, text: &str, accelerator: &str| {
        MenuItemBuilder::with_id(id, text)
            .accelerator(accelerator)
            .build(app)
    };

    let app_menu = SubmenuBuilder::new(app, "Folio")
        .about(None)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .item(&item("quit", "Quit Folio", "CmdOrCtrl+Q")?)
        .build()?;
    let file = SubmenuBuilder::new(app, "File")
        .item(&item("new", "New Document", "CmdOrCtrl+N")?)
        .item(&item("open", "Open…", "CmdOrCtrl+O")?)
        .item(&item("open-folder", "Open Folder…", "CmdOrCtrl+Shift+O")?)
        .separator()
        .item(&item("save", "Save", "CmdOrCtrl+S")?)
        .item(&item("save-as", "Save As…", "CmdOrCtrl+Shift+S")?)
        .separator()
        .item(&item("close-tab", "Close Tab", "CmdOrCtrl+W")?)
        .build()?;
    let edit = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
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

    MenuBuilder::new(app)
        .items(&[&app_menu, &file, &edit, &view, &window])
        .build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(PendingFile::default())
        .setup(|app| {
            let menu = build_menu(app.handle())?;
            app.set_menu(menu)?;
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
            write_file,
            list_markdown_files,
            fetch_page,
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
