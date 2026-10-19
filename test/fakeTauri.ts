/**
 * A stand-in for Grimm's Rust backend, for testing the app in a browser: files
 * live in memory (kept in sessionStorage across reloads) and each command
 * follows the same rules as its Rust version in src-tauri/src/lib.rs, which
 * has its own tests. Dialogs answer from `window.fakeDialog`.
 */
import { mockConvertFileSrc, mockIPC, mockWindows } from "@tauri-apps/api/mocks";

type Files = Record<string, string>;

declare global {
  interface Window {
    fakeFs: { files: Files; dirs: string[]; calls: string[] };
    fakeDialog: { open?: string | string[] | null; save?: string | null; ask?: boolean };
  }
}

const KEY = "fakeFs";
const IMAGE = /\.(png|jpe?g|gif|webp|svg)$/i;
const MARKDOWN = /\.(md|markdown|mdx|mdown)$/i;
const dirOf = (p: string) => p.replace(/\/[^/]*$/, "");
const baseOf = (p: string) => p.split("/").pop() ?? p;

export function installFakeTauri() {
  window.fakeFs = JSON.parse(sessionStorage.getItem(KEY) ?? '{"files":{},"dirs":[],"calls":[]}');
  window.fakeDialog ??= {};
  const fs = window.fakeFs;
  const save = () => sessionStorage.setItem(KEY, JSON.stringify(fs));
  const isDir = (p: string) => fs.dirs.includes(p);
  const exists = (p: string) => p in fs.files || isDir(p);
  const fail = (message: string) => {
    throw message;
  };

  mockWindows("main");
  mockConvertFileSrc("macos");
  mockIPC((cmd, args = {}) => {
    const a = args as Record<string, string>;
    fs.calls.push(cmd);
    switch (cmd) {
      case "read_file":
        return a.path in fs.files ? fs.files[a.path] : fail("No such file or directory");
      case "open_note":
        if (!(a.path in fs.files)) fail("No such file or directory");
        return { contents: fs.files[a.path], hash: `${fs.files[a.path].length}` };
      case "write_file":
        if (!isDir(dirOf(a.path))) fail("No such file or directory");
        fs.files[a.path] = a.contents;
        return save();
      case "file_exists":
        return a.path in fs.files;
      case "modified_at":
        return a.path in fs.files ? Date.now() - 3_600_000 : fail("No such file");
      case "list_markdown_files":
        if (!isDir(a.dir)) fail("No such directory");
        return Object.keys(fs.files)
          .filter((p) => p.startsWith(`${a.dir}/`) && MARKDOWN.test(p))
          .sort();
      case "create_dir":
        if (exists(a.path)) fail("File exists");
        fs.dirs.push(a.path);
        return save();
      case "rename_path": {
        const { from, to } = a;
        if (!(from in fs.files)) fail("the note is no longer there");
        if (!isDir(dirOf(to))) fail("that folder does not exist");
        const sameFile = from.toLowerCase() === to.toLowerCase();
        if (exists(to) && !sameFile) fail(`“${baseOf(to)}” already exists there`);
        const contents = fs.files[from];
        delete fs.files[from];
        fs.files[to] = contents;
        return save();
      }
      case "copy_image": {
        if (!IMAGE.test(a.source)) fail("that file is not an image");
        if (!(a.source in fs.files)) fail("No such file");
        const bytes = fs.files[a.source];
        const dir = `${dirOf(a.note)}/assets`;
        if (!isDir(dir)) fs.dirs.push(dir);
        const [, stem, ext] = baseOf(a.source).match(/^(.*?)(\.[^.]+)$/) ?? [];
        for (let n = 1; ; n++) {
          const name = n === 1 ? `${stem}${ext}` : `${stem}-${n}${ext}`;
          const target = `${dir}/${name}`;
          if (target in fs.files && fs.files[target] !== bytes) continue;
          fs.files[target] = bytes;
          save();
          return `assets/${name}`;
        }
      }
      case "list_versions":
        return [];
      case "take_pending_file":
      case "allow_image":
        return null;
      case "plugin:dialog|open":
        return window.fakeDialog.open ?? null;
      case "plugin:dialog|save":
        return window.fakeDialog.save ?? null;
      case "plugin:dialog|ask":
      case "plugin:dialog|confirm":
        return window.fakeDialog.ask ?? true;
      case "plugin:updater|check":
        return null;
      default:
        // Events, window title, opener and the like: nothing to do here.
        return null;
    }
  });
}
