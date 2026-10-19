//! Automatic version history for notes.
//!
//! Each note's versions are listed in `notes/<id>.json` in the app's data
//! folder, and the text of every version is stored once in `objects/`, named
//! by the SHA-256 of its contents, so a version that comes back (an undo, a
//! restore, a file synced back and forth) costs nothing. Nothing is written
//! beside the notes themselves, so folders stay clean and nothing extra syncs.

use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard},
    time::{SystemTime, UNIX_EPOCH},
};

use flate2::{read::GzDecoder, write::GzEncoder, Compression};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const HOUR: u64 = 3_600_000;
const DAY: u64 = 24 * HOUR;
const WEEK: u64 = 7 * DAY;
/// While someone keeps typing, a version is kept at most this often. The
/// frontend adds one whenever the typing pauses.
const EDIT_INTERVAL: u64 = 5 * 60_000;

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Reason {
    Opened,
    Edited,
    BeforeRestore,
    Restored,
    /// The file was changed by something other than Grimm.
    Outside,
    /// Edits that were open in Grimm when a newer file from outside replaced them.
    Replaced,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Version {
    pub hash: String,
    /// Milliseconds since the Unix epoch.
    pub time: u64,
    pub reason: Reason,
}

#[derive(Clone, Serialize, Deserialize)]
struct Note {
    path: String,
    /// The file's contents as Grimm last read, wrote or saw them, which tells
    /// its own writes apart from outside ones and finds a note after a rename.
    seen: String,
    versions: Vec<Version>,
}

/// A note whose file holds something other than what Grimm expected.
#[derive(Clone, Serialize)]
pub struct Change {
    pub path: String,
    pub contents: String,
    pub hash: String,
}

pub enum WriteError {
    Changed(Change),
    Io(String),
}

#[derive(Default)]
struct State {
    notes: HashMap<String, Note>,
    by_path: HashMap<String, String>,
}

pub struct History {
    dir: PathBuf,
    state: Mutex<State>,
}

pub fn hash(text: &str) -> String {
    Sha256::digest(text.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

/// Writes through a temporary file so a crash never leaves half a file behind.
fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("file");
    let temp = path.with_file_name(format!(".{name}.tmp"));
    fs::write(&temp, bytes)?;
    fs::rename(&temp, path)
}

/// Thins a note's versions, oldest first: everything from the last day, then
/// the latest version of each hour for a week, of each day for a month, and of
/// each week after that.
fn thin(versions: &mut Vec<Version>, now: u64) {
    let mut buckets = HashSet::new();
    let mut kept: Vec<Version> = versions
        .iter()
        .rev()
        .filter(|v| {
            let age = now.saturating_sub(v.time);
            let bucket = match age {
                a if a < DAY => return true,
                a if a < 7 * DAY => (0, v.time / HOUR),
                a if a < 30 * DAY => (1, v.time / DAY),
                _ => (2, v.time / WEEK),
            };
            buckets.insert(bucket)
        })
        .cloned()
        .collect();
    kept.reverse();
    *versions = kept;
}

impl History {
    pub fn open(dir: PathBuf) -> Self {
        let mut state = State::default();
        for entry in fs::read_dir(dir.join("notes")).into_iter().flatten().flatten() {
            let path = entry.path();
            if path.extension().is_none_or(|e| e != "json") {
                continue;
            }
            let Some(id) = path.file_stem().and_then(|s| s.to_str()) else { continue };
            // A file that can't be read is left alone rather than losing the rest.
            let Some(note) = fs::read(&path).ok().and_then(|b| serde_json::from_slice::<Note>(&b).ok()) else {
                continue;
            };
            state.by_path.insert(note.path.clone(), id.to_string());
            state.notes.insert(id.to_string(), note);
        }
        History { dir, state: Mutex::new(state) }
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn object_path(&self, hash: &str) -> PathBuf {
        self.dir.join("objects").join(&hash[..2]).join(format!("{}.gz", &hash[2..]))
    }

    fn store_object(&self, hash: &str, text: &str) -> std::io::Result<()> {
        let path = self.object_path(hash);
        if path.exists() {
            return Ok(());
        }
        fs::create_dir_all(path.parent().unwrap())?;
        let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(text.as_bytes())?;
        write_atomic(&path, &encoder.finish()?)
    }

    fn save(&self, id: &str, note: &Note) {
        let dir = self.dir.join("notes");
        let saved = fs::create_dir_all(&dir)
            .and_then(|_| write_atomic(&dir.join(format!("{id}.json")), &serde_json::to_vec(note).unwrap()));
        if let Err(e) = saved {
            eprintln!("couldn't save the history of {}: {e}", note.path);
        }
    }

    /// The history of the note at `path`, made if it has none. A note with no
    /// history may be one renamed or moved in Finder, so first a history whose
    /// file is gone and that last saw these same contents is taken over.
    fn note_id(&self, state: &mut State, path: &str, hash: &str, adopt: bool) -> String {
        if let Some(id) = state.by_path.get(path) {
            return id.clone();
        }
        let orphan = adopt
            .then(|| {
                state
                    .notes
                    .iter()
                    .filter(|(_, n)| n.seen == hash && !Path::new(&n.path).exists())
                    .max_by_key(|(_, n)| n.versions.last().map_or(0, |v| v.time))
                    .map(|(id, _)| id.clone())
            })
            .flatten();
        let id = match orphan {
            Some(id) => {
                let note = state.notes.get_mut(&id).unwrap();
                state.by_path.remove(&note.path);
                note.path = path.to_string();
                id
            }
            None => {
                let id = crate::history::hash(&format!("{path}\n{}", now()))[..16].to_string();
                let note = Note { path: path.to_string(), seen: hash.to_string(), versions: Vec::new() };
                state.notes.insert(id.clone(), note);
                id
            }
        };
        state.by_path.insert(path.to_string(), id.clone());
        id
    }

    /// Adds a version unless it is the same as the latest one, then thins the list.
    fn add(&self, state: &mut State, id: &str, text: &str, reason: Reason) {
        let hash = hash(text);
        let note = state.notes.get_mut(id).unwrap();
        if note.versions.last().is_none_or(|v| v.hash != hash) {
            if let Err(e) = self.store_object(&hash, text) {
                eprintln!("couldn't keep a version of {}: {e}", note.path);
                return;
            }
            let time = now();
            note.versions.push(Version { hash, time, reason });
            thin(&mut note.versions, time);
        }
        self.save(id, note);
    }

    /// Records a note's contents as they were read from disk when it was opened.
    pub fn opened(&self, path: &str, text: &str) -> String {
        let mut state = self.lock();
        let hash = hash(text);
        let id = self.note_id(&mut state, path, &hash, !text.trim().is_empty());
        state.notes.get_mut(&id).unwrap().seen = hash.clone();
        self.add(&mut state, &id, text, Reason::Opened);
        hash
    }

    /// Records the file at `path` as changed from outside Grimm if it is not
    /// what Grimm last saw there. Only notes Grimm knows about are tracked.
    pub fn saw(&self, path: &str) -> Option<Change> {
        let mut state = self.lock();
        let id = state.by_path.get(path)?.clone();
        let contents = fs::read_to_string(path).ok()?;
        let hash = hash(&contents);
        let note = state.notes.get_mut(&id)?;
        if note.seen == hash {
            return None;
        }
        note.seen = hash.clone();
        self.add(&mut state, &id, &contents, Reason::Outside);
        Some(Change { path: path.to_string(), contents, hash })
    }

    /// Writes a note to disk. With a `base`, the hash of the file the text was
    /// edited from, a file that has changed since is kept and reported instead
    /// of overwritten. Without one the file is written regardless (Save As).
    pub fn write(&self, path: &str, text: &str, base: Option<&str>) -> Result<String, WriteError> {
        let mut state = self.lock();
        let hash = hash(text);
        if let Some(base) = base {
            // A missing file was deleted or moved, and is simply written again.
            if let Ok(disk) = fs::read_to_string(path) {
                let disk_hash = crate::history::hash(&disk);
                if disk_hash != base && disk_hash != hash {
                    let id = self.note_id(&mut state, path, &disk_hash, false);
                    let note = state.notes.get_mut(&id).unwrap();
                    if note.seen != disk_hash {
                        note.seen = disk_hash.clone();
                        self.add(&mut state, &id, &disk, Reason::Outside);
                    }
                    return Err(WriteError::Changed(Change { path: path.to_string(), contents: disk, hash: disk_hash }));
                }
            }
        }
        // Done under the lock, so the file watcher can't mistake this write for an outside one.
        fs::write(path, text).map_err(|e| WriteError::Io(e.to_string()))?;
        let id = self.note_id(&mut state, path, &hash, false);
        let note = state.notes.get_mut(&id).unwrap();
        note.seen = hash.clone();
        if note.versions.last().is_none_or(|v| now().saturating_sub(v.time) >= EDIT_INTERVAL) {
            self.add(&mut state, &id, text, Reason::Edited);
        } else {
            let note = note.clone();
            self.save(&id, &note);
        }
        Ok(hash)
    }

    /// Keeps a version of a note now, such as when the typing pauses.
    pub fn record(&self, path: &str, text: &str, reason: Reason) {
        let mut state = self.lock();
        let id = self.note_id(&mut state, path, &hash(text), false);
        self.add(&mut state, &id, text, reason);
    }

    /// A note's versions, newest first.
    pub fn versions(&self, path: &str) -> Vec<Version> {
        let state = self.lock();
        let Some(note) = state.by_path.get(path).and_then(|id| state.notes.get(id)) else {
            return Vec::new();
        };
        note.versions.iter().rev().cloned().collect()
    }

    pub fn read(&self, hash: &str) -> Result<String, String> {
        if hash.len() != 64 || !hash.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err("not a version".into());
        }
        let file = fs::File::open(self.object_path(hash)).map_err(|_| "that version is no longer kept")?;
        let mut text = String::new();
        GzDecoder::new(file).read_to_string(&mut text).map_err(|e| e.to_string())?;
        Ok(text)
    }

    /// Puts an old version back, keeping what it replaces (both what was in
    /// the editor and anything newer on disk) so the restore can be undone.
    pub fn restore(&self, path: &str, current: &str, hash: &str) -> Result<String, String> {
        let text = self.read(hash)?;
        let mut state = self.lock();
        let id = self.note_id(&mut state, path, &crate::history::hash(current), false);
        if let Ok(disk) = fs::read_to_string(path) {
            if crate::history::hash(&disk) != state.notes[&id].seen {
                self.add(&mut state, &id, &disk, Reason::Outside);
            }
        }
        self.add(&mut state, &id, current, Reason::BeforeRestore);
        fs::write(path, &text).map_err(|e| e.to_string())?;
        state.notes.get_mut(&id).unwrap().seen = hash.to_string();
        self.add(&mut state, &id, &text, Reason::Restored);
        Ok(hash.to_string())
    }

    /// Gives a note saved under a new name (Save As) the history of the one it came from.
    pub fn copy(&self, from: &str, to: &str) {
        let mut state = self.lock();
        if from == to || state.by_path.contains_key(to) {
            return;
        }
        let Some(mut note) = state.by_path.get(from).and_then(|id| state.notes.get(id)).cloned() else {
            return;
        };
        note.path = to.to_string();
        let id = hash(&format!("{to}\n{}", now()))[..16].to_string();
        self.save(&id, &note);
        state.notes.insert(id.clone(), note);
        state.by_path.insert(to.to_string(), id);
    }

    /// Moves a note's history along with a rename or move made in Grimm.
    pub fn moved(&self, from: &str, to: &str) {
        let mut state = self.lock();
        let Some(id) = state.by_path.remove(from) else { return };
        let Some(note) = state.notes.get_mut(&id) else { return };
        note.path = to.to_string();
        let note = note.clone();
        self.save(&id, &note);
        state.by_path.insert(to.to_string(), id);
    }

    /// Links a file that just appeared to the history of one of `missing`, the
    /// open notes whose files are gone, when it holds the same text. That is a
    /// rename or move made outside Grimm. Returns the old path.
    pub fn renamed(&self, to: &str, missing: &[String]) -> Option<String> {
        let mut state = self.lock();
        if state.by_path.contains_key(to) {
            return None;
        }
        let hash = hash(&fs::read_to_string(to).ok()?);
        let from = missing
            .iter()
            .find(|p| state.by_path.get(*p).and_then(|id| state.notes.get(id)).is_some_and(|n| n.seen == hash))?
            .clone();
        let id = state.by_path.remove(&from)?;
        let note = state.notes.get_mut(&id)?;
        note.path = to.to_string();
        let note = note.clone();
        self.save(&id, &note);
        state.by_path.insert(to.to_string(), id);
        Some(from)
    }

    /// Deletes stored texts that no version refers to any more.
    pub fn collect_garbage(&self) {
        let state = self.lock();
        let used: HashSet<&str> = state.notes.values().flat_map(|n| n.versions.iter().map(|v| v.hash.as_str())).collect();
        for shard in fs::read_dir(self.dir.join("objects")).into_iter().flatten().flatten() {
            let prefix = shard.file_name().to_string_lossy().to_string();
            for object in fs::read_dir(shard.path()).into_iter().flatten().flatten() {
                let name = object.file_name().to_string_lossy().to_string();
                let Some(rest) = name.strip_suffix(".gz") else { continue };
                if !used.contains(format!("{prefix}{rest}").as_str()) {
                    let _ = fs::remove_file(object.path());
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("grimm-history-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn at(time: u64) -> Version {
        Version { hash: time.to_string(), time, reason: Reason::Edited }
    }

    #[test]
    fn thinning_keeps_less_the_older_it_gets() {
        let now = 400 * DAY;
        let mut versions: Vec<Version> = (0..=60 * 24 * 4).rev().map(|q| at(now - q * HOUR / 4)).collect();
        thin(&mut versions, now);
        let count = |from: u64, to: u64| {
            versions.iter().filter(|v| now - v.time >= from && now - v.time < to).count()
        };
        // Every quarter hour from the last day, one an hour for the week, one a day for the month.
        assert_eq!(count(0, DAY), 96);
        assert!((144..=145).contains(&count(DAY, 7 * DAY)));
        assert!((22..=24).contains(&count(7 * DAY, 30 * DAY)));
        assert!((4..=6).contains(&count(30 * DAY, 61 * DAY)));
        assert_eq!(versions.last().unwrap().time, now);
    }

    #[test]
    fn writes_keep_versions_and_never_overwrite_outside_changes() {
        let dir = temp("write");
        let history = History::open(dir.join("data"));
        let note = dir.join("note.md");
        let path = note.to_str().unwrap();
        fs::write(&note, "one").unwrap();

        let base = history.opened(path, "one");
        let second = history.write(path, "two", Some(&base)).ok().unwrap();
        assert_eq!(fs::read_to_string(&note).unwrap(), "two");
        // Within the edit interval of the first version, a write isn't a version of its own.
        assert_eq!(history.versions(path).len(), 1);
        assert!(history.saw(path).is_none());

        fs::write(&note, "from another device").unwrap();
        let change = history.saw(path).unwrap();
        assert_eq!(change.contents, "from another device");
        assert!(history.saw(path).is_none());
        // A write based on the older file is refused and the newer one is kept.
        assert!(matches!(history.write(path, "three", Some(&second)), Err(WriteError::Changed(_))));
        assert_eq!(fs::read_to_string(&note).unwrap(), "from another device");
        assert!(history.write(path, "three", Some(&change.hash)).is_ok());

        let versions = history.versions(path);
        assert_eq!(versions[0].reason, Reason::Outside);
        assert_eq!(history.read(&versions[0].hash).unwrap(), "from another device");

        // Restoring keeps what it replaced.
        let first = versions.last().unwrap().hash.clone();
        history.restore(path, "three", &first).unwrap();
        assert_eq!(fs::read_to_string(&note).unwrap(), "one");
        let reasons: Vec<Reason> = history.versions(path).iter().map(|v| v.reason).collect();
        assert_eq!(&reasons[..2], &[Reason::Restored, Reason::BeforeRestore]);

        // History survives a restart, and the identical texts were stored once.
        let reopened = History::open(dir.join("data"));
        assert_eq!(reopened.versions(path).len(), history.versions(path).len());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn history_follows_renames() {
        let dir = temp("rename");
        let history = History::open(dir.join("data"));
        let old = dir.join("old.md");
        let new = dir.join("new.md");
        fs::write(&old, "hello").unwrap();
        history.opened(old.to_str().unwrap(), "hello");

        fs::rename(&old, &new).unwrap();
        let missing = vec![old.to_string_lossy().to_string()];
        assert_eq!(history.renamed(new.to_str().unwrap(), &missing), Some(missing[0].clone()));
        assert_eq!(history.versions(new.to_str().unwrap()).len(), 1);

        // Renamed while Grimm wasn't running: found by its contents when opened.
        let moved = dir.join("moved.md");
        fs::rename(&new, &moved).unwrap();
        history.opened(moved.to_str().unwrap(), "hello");
        assert_eq!(history.versions(moved.to_str().unwrap()).len(), 1);

        history.copy(moved.to_str().unwrap(), "/elsewhere/copy.md");
        assert_eq!(history.versions("/elsewhere/copy.md").len(), 1);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn unused_texts_are_collected() {
        let dir = temp("gc");
        let history = History::open(dir.join("data"));
        history.store_object(&hash("stray"), "stray").unwrap();
        history.record("/a.md", "kept", Reason::Edited);
        history.collect_garbage();
        assert!(history.read(&hash("stray")).is_err());
        assert_eq!(history.read(&hash("kept")).unwrap(), "kept");
        fs::remove_dir_all(&dir).unwrap();
    }
}
