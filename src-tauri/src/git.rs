//! A light "Commit" for notes in folders that are already git repositories.
//!
//! Grimm never makes a repository, stages anything it was not asked to, or
//! pushes: it runs the user's own git on the note and the images it uses.

use std::{
    path::{Path, PathBuf},
    process::Command,
    sync::OnceLock,
};

#[derive(serde::Serialize)]
pub struct GitInfo {
    /// The repository's folder.
    root: String,
    /// None when no branch is checked out.
    branch: Option<String>,
    /// Which of the files asked about differ from the last commit, as absolute paths.
    changed: Vec<String>,
}

fn git_binary() -> Option<&'static Path> {
    static GIT: OnceLock<Option<PathBuf>> = OnceLock::new();
    GIT.get_or_init(|| {
        // An app opened from Finder doesn't get the shell's PATH, so Homebrew's git is looked for by name.
        for candidate in ["/opt/homebrew/bin/git", "/usr/local/bin/git"] {
            if Path::new(candidate).is_file() {
                return Some(candidate.into());
            }
        }
        // Without the developer tools, /usr/bin/git only offers to install them.
        let tools = Command::new("/usr/bin/xcode-select")
            .arg("-p")
            .output()
            .is_ok_and(|output| output.status.success());
        tools.then(|| "/usr/bin/git".into())
    })
    .as_deref()
}

fn repo_root(note: &Path) -> Option<PathBuf> {
    note.ancestors().skip(1).find(|dir| dir.join(".git").exists()).map(Path::to_path_buf)
}

fn git(root: &Path, args: &[&str]) -> Result<String, String> {
    let output = Command::new(git_binary().ok_or("git isn't installed")?)
        .current_dir(root)
        .args(args)
        // Never wait on a password prompt nobody can see.
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|e| e.to_string())?;
    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).into_owned());
    }
    // A failing hook may explain itself on either stream.
    let text = [&output.stderr, &output.stdout]
        .iter()
        .map(|bytes| String::from_utf8_lossy(bytes).trim().to_string())
        .find(|text| !text.is_empty())
        .unwrap_or_else(|| "git failed".into());
    Err(text.strip_prefix("fatal: ").unwrap_or(&text).to_string())
}

/// Which of `files` differ from the last commit (changed, new or deleted),
/// relative to the repository. Files outside it, or ignored by it, are left out.
fn changed(root: &Path, files: &[String]) -> Result<Vec<String>, String> {
    let relative: Vec<String> = files
        .iter()
        .filter_map(|file| Path::new(file).strip_prefix(root).ok())
        .map(|path| path.to_string_lossy().into_owned())
        .collect();
    if relative.is_empty() {
        return Ok(Vec::new());
    }
    let mut args = vec!["status", "--porcelain=v1", "-z", "--untracked-files=all", "--"];
    args.extend(relative.iter().map(String::as_str));
    let output = git(root, &args)?;
    let mut paths = Vec::new();
    let mut entries = output.split('\0');
    while let Some(entry) = entries.next() {
        if entry.len() < 4 {
            continue;
        }
        // A rename is followed by the name it had before.
        if matches!(entry.as_bytes()[0], b'R' | b'C') {
            entries.next();
        }
        paths.push(entry[3..].to_string());
    }
    Ok(paths)
}

/// Where a note's repository is and which of its files have changes, or
/// None for a note that isn't in a git repository.
pub fn info(note: &str, files: &[String]) -> Option<GitInfo> {
    let root = repo_root(Path::new(note))?;
    git_binary()?;
    let branch = git(&root, &["symbolic-ref", "--short", "-q", "HEAD"])
        .ok()
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty());
    let changed = changed(&root, files).unwrap_or_default();
    Some(GitInfo {
        root: root.to_string_lossy().into_owned(),
        branch,
        changed: changed.iter().map(|path| root.join(path).to_string_lossy().into_owned()).collect(),
    })
}

/// Commits the changed ones among `files`, and nothing else, even if other
/// changes are staged. Returns the new commit's short hash.
pub fn commit(note: &str, files: &[String], message: &str) -> Result<String, String> {
    let root = repo_root(Path::new(note)).ok_or("this note isn't in a git repository")?;
    let message = message.trim();
    if message.is_empty() {
        return Err("the commit needs a message".into());
    }
    let paths = changed(&root, files)?;
    if paths.is_empty() {
        return Err("nothing has changed since the last commit".into());
    }
    let mut add = vec!["add", "-A", "--"];
    add.extend(paths.iter().map(String::as_str));
    git(&root, &add)?;
    // With paths, git commits only those, leaving whatever else is staged alone.
    let mut commit = vec!["commit", "-q", "-m", message, "--"];
    commit.extend(paths.iter().map(String::as_str));
    git(&root, &commit)?;
    Ok(git(&root, &["rev-parse", "--short", "HEAD"])?.trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn only_the_note_and_its_images_are_committed() {
        let dir = std::env::temp_dir().join(format!("grimm-git-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("notes/assets")).unwrap();
        let run = |args: &[&str]| git(&dir, args).unwrap();
        run(&["init", "-q", "-b", "main"]);
        run(&["config", "user.name", "Test"]);
        run(&["config", "user.email", "test@example.com"]);

        let note = dir.join("notes/note.md").to_string_lossy().into_owned();
        let image = dir.join("notes/assets/a.png").to_string_lossy().into_owned();
        let unlinked = dir.join("notes/assets/unused.png").to_string_lossy().into_owned();
        fs::write(&note, "# Note\n\n![](assets/a.png)\n").unwrap();
        fs::write(&image, b"png").unwrap();
        fs::write(&unlinked, b"png").unwrap();
        fs::write(dir.join("code.rs"), "fn main() {}").unwrap();
        run(&["add", "code.rs"]);

        let files = vec![note.clone(), image.clone(), "/elsewhere/b.png".to_string()];
        let found = info(&note, &files).unwrap();
        assert_eq!(found.branch.as_deref(), Some("main"));
        assert_eq!(found.changed, vec![image.clone(), note.clone()]);

        let hash = commit(&note, &files, "Update note").unwrap();
        assert!(!hash.is_empty());
        let committed = run(&["show", "--name-only", "--format=", "HEAD"]);
        assert_eq!(committed.lines().collect::<Vec<_>>(), ["notes/assets/a.png", "notes/note.md"]);
        // What else was staged or lying around is still there, uncommitted.
        assert!(run(&["status", "--porcelain"]).contains("A  code.rs"));
        assert!(info(&note, &files).unwrap().changed.is_empty());
        assert!(commit(&note, &files, "Again").is_err());

        // A deleted image is committed as deleted.
        fs::remove_file(&image).unwrap();
        fs::write(&note, "# Note\n").unwrap();
        commit(&note, &files, "Remove image").unwrap();
        assert!(run(&["ls-files"]).lines().all(|f| f != "notes/assets/a.png"));

        assert!(info("/not/a/repo/note.md", &[]).is_none());
        fs::remove_dir_all(&dir).unwrap();
    }
}
