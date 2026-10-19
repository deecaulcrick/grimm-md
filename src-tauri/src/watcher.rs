//! Notices when an open note's file is changed or renamed by something other
//! than Grimm: another editor, a sync service, or Finder.
//!
//! The folders holding the open notes are watched rather than the files
//! themselves, since many programs save by replacing a file with a new one.

use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::Mutex,
};

use notify::{RecommendedWatcher, RecursiveMode, Watcher as _};
use tauri::{AppHandle, Emitter, Manager};

use crate::history::History;

#[derive(Default)]
struct Watched {
    files: HashSet<String>,
    dirs: HashSet<PathBuf>,
}

pub struct Watcher {
    watcher: Mutex<Option<RecommendedWatcher>>,
    watched: Mutex<Watched>,
}

#[derive(Clone, serde::Serialize)]
struct Rename {
    from: String,
    to: String,
}

impl Watcher {
    pub fn new(app: &AppHandle) -> Self {
        let handle = app.clone();
        let watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
            if let Ok(event) = event {
                changed(&handle, event.paths);
            }
        });
        if let Err(e) = &watcher {
            eprintln!("couldn't watch for outside changes: {e}");
        }
        Watcher { watcher: Mutex::new(watcher.ok()), watched: Mutex::default() }
    }

    /// Replaces the set of note files being watched.
    pub fn watch(&self, paths: Vec<String>) {
        let mut guard = self.watcher.lock().unwrap();
        let Some(watcher) = guard.as_mut() else { return };
        // Not held while (un)watching: that can wait on the event thread, which takes this lock.
        let current = self.watched.lock().unwrap().dirs.clone();
        let wanted: HashSet<PathBuf> = paths.iter().filter_map(|p| Path::new(p).parent()).map(Path::to_path_buf).collect();
        for dir in current.difference(&wanted) {
            let _ = watcher.unwatch(dir);
        }
        let mut dirs = HashSet::new();
        for dir in wanted {
            if current.contains(&dir) || watcher.watch(&dir, RecursiveMode::NonRecursive).is_ok() {
                dirs.insert(dir);
            }
        }
        *self.watched.lock().unwrap() = Watched { files: paths.into_iter().collect(), dirs };
    }
}

fn changed(app: &AppHandle, paths: Vec<PathBuf>) {
    let files = app.state::<Watcher>().watched.lock().unwrap().files.clone();
    let history = app.state::<History>();
    for path in paths {
        let Some(path) = path.to_str() else { continue };
        if files.contains(path) {
            if let Some(change) = history.saw(path) {
                let _ = app.emit("file-changed", change);
            }
            continue;
        }
        if !Path::new(path).is_file() || !crate::is_markdown(Path::new(path)) {
            continue;
        }
        // A new file beside an open note that has just disappeared may be that note, renamed.
        let missing: Vec<String> = files.iter().filter(|f| !Path::new(f).exists()).cloned().collect();
        if missing.is_empty() {
            continue;
        }
        if let Some(from) = history.renamed(path, &missing) {
            let _ = app.emit("file-renamed", Rename { from, to: path.to_string() });
        }
    }
}
