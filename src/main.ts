import { Crepe } from "@milkdown/crepe";
import { remarkStringifyOptionsCtx } from "@milkdown/kit/core";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";
import "./styles.css";

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask, open, save } from "@tauri-apps/plugin-dialog";

type Mode = "rich" | "source";

// The UI also runs in a plain browser (vite dev) with file access disabled.
const inTauri = "__TAURI_INTERNALS__" in window;
const MARKDOWN_EXTENSIONS = ["md", "markdown", "mdx", "mdown"];
const MAX_RECENTS = 12;
const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const app = $("app");
const editorEl = $("editor");
const sourceEl = $<HTMLTextAreaElement>("source");
const docName = $("doc-name");
const docDirty = $("doc-dirty");
const docPath = $("doc-path");
const docStats = $("doc-stats");
const saveBtn = $<HTMLButtonElement>("btn-save");
const toastEl = $("toast");

let crepe: Crepe | null = null;
let mode: Mode = "rich";
let path: string | null = null;
let dirty = false;
// YAML frontmatter is kept out of the rich editor (it would be parsed as a
// rule + heading) and re-attached when the document is serialized.
let frontmatter = "";
// What the rich editor serializes an untouched document to; used to tell real
// edits apart from the editor merely normalizing markdown on load.
let richBaseline = "";
let folder: string | null = localStorage.getItem("folder");
let recents: string[] = JSON.parse(localStorage.getItem("recents") ?? "[]");

// ---------- helpers ----------

const basename = (p: string) => p.split(/[\\/]/).pop() ?? p;
const dirname = (p: string) => p.replace(/[\\/][^\\/]*$/, "");
const isMarkdown = (p: string) =>
  MARKDOWN_EXTENSIONS.includes(p.split(".").pop()?.toLowerCase() ?? "");
const tildify = (p: string) => p.replace(/^\/Users\/[^/]+/, "~");

let toastTimer = 0;
function toast(text: string) {
  toastEl.textContent = text;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toastEl.hidden = true), 2600);
}

async function confirmDiscard(): Promise<boolean> {
  if (!dirty) return true;
  const text = "You have unsaved changes. Discard them?";
  if (!inTauri) return window.confirm(text);
  return ask(text, { title: "Unsaved changes", kind: "warning", okLabel: "Discard", cancelLabel: "Cancel" });
}

// ---------- document state ----------

function getContent(): string {
  if (mode === "source") return sourceEl.value;
  return frontmatter + (crepe?.getMarkdown() ?? "");
}

function setDirty(value: boolean) {
  dirty = value;
  docDirty.hidden = !value;
  saveBtn.disabled = !value && path !== null;
}

function refreshChrome() {
  const name = path ? basename(path) : "Untitled";
  docName.textContent = name;
  docPath.textContent = path ? tildify(path) : "Not saved yet";
  document.title = name;
  if (inTauri) getCurrentWindow().setTitle(name).catch(() => {});
  setDirty(dirty);
  renderSidebar();
}

function refreshStats() {
  const text = getContent().replace(FRONTMATTER, "");
  const words = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.length ?? 0;
  docStats.textContent = `${words.toLocaleString()} ${words === 1 ? "word" : "words"}`;
}

function autosizeSource() {
  sourceEl.style.height = "auto";
  sourceEl.style.height = `${sourceEl.scrollHeight}px`;
}

async function mountRich(markdown: string) {
  const match = markdown.match(FRONTMATTER);
  frontmatter = match ? match[0] : "";
  const body = markdown.slice(frontmatter.length);

  await crepe?.destroy();
  editorEl.replaceChildren();
  const instance = new Crepe({
    root: editorEl,
    defaultValue: body,
    features: { [Crepe.Feature.Latex]: false },
    featureConfigs: { [Crepe.Feature.Placeholder]: { text: "Start writing…", mode: "doc" } },
  });
  instance.editor.config((ctx) => {
    ctx.update(remarkStringifyOptionsCtx, (options) => ({ ...options, bullet: "-" as const, rule: "-" as const }));
  });
  instance.on((listener) => {
    listener.markdownUpdated((_ctx, md) => {
      if (crepe !== instance || mode !== "rich") return;
      if (md !== richBaseline) setDirty(true);
      refreshStats();
    });
  });
  await instance.create();
  crepe = instance;
  richBaseline = instance.getMarkdown();
}

async function setContent(markdown: string) {
  if (mode === "source") {
    sourceEl.value = markdown;
    autosizeSource();
  } else {
    await mountRich(markdown);
  }
  refreshStats();
}

async function setMode(next: Mode) {
  if (next === mode) return;
  const content = getContent();
  mode = next;
  $("mode-rich").classList.toggle("active", mode === "rich");
  $("mode-source").classList.toggle("active", mode === "source");
  editorEl.hidden = mode !== "rich";
  sourceEl.hidden = mode !== "source";
  await setContent(content);
  if (mode === "source") sourceEl.focus();
}

// ---------- file operations ----------

function rememberRecent(p: string) {
  recents = [p, ...recents.filter((r) => r !== p)].slice(0, MAX_RECENTS);
  localStorage.setItem("recents", JSON.stringify(recents));
}

async function loadFile(p: string, { skipConfirm = false } = {}) {
  if (!skipConfirm && !(await confirmDiscard())) return;
  let text: string;
  try {
    text = await invoke<string>("read_file", { path: p });
  } catch (err) {
    recents = recents.filter((r) => r !== p);
    localStorage.setItem("recents", JSON.stringify(recents));
    if (localStorage.getItem("lastFile") === p) localStorage.removeItem("lastFile");
    renderSidebar();
    toast(`Couldn't open ${basename(p)}: ${err}`);
    return;
  }
  path = p;
  dirty = false;
  await setContent(text);
  rememberRecent(p);
  localStorage.setItem("lastFile", p);
  refreshChrome();
  $("scroller").scrollTop = 0;
}

async function newDocument() {
  if (!(await confirmDiscard())) return;
  path = null;
  dirty = false;
  localStorage.removeItem("lastFile");
  await setContent("");
  refreshChrome();
  if (mode === "source") sourceEl.focus();
  else editorEl.querySelector<HTMLElement>(".ProseMirror")?.focus();
}

async function openDialog() {
  if (!inTauri) return toast("Opening files needs the desktop app");
  const picked = await open({
    multiple: false,
    filters: [
      { name: "Markdown", extensions: MARKDOWN_EXTENSIONS },
      { name: "All files", extensions: ["*"] },
    ],
  });
  if (typeof picked === "string") await loadFile(picked);
}

async function saveDocument(saveAs = false) {
  if (!inTauri) return toast("Saving needs the desktop app");
  let target = path;
  if (!target || saveAs) {
    const picked = await save({
      defaultPath: path ?? (folder ? `${folder}/Untitled.md` : "Untitled.md"),
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (!picked) return;
    target = picked;
  }
  try {
    await invoke("write_file", { path: target, contents: getContent() });
  } catch (err) {
    toast(`Couldn't save: ${err}`);
    return;
  }
  path = target;
  dirty = false;
  if (mode === "rich" && crepe) richBaseline = crepe.getMarkdown();
  rememberRecent(target);
  localStorage.setItem("lastFile", target);
  refreshChrome();
  if (folder && target.startsWith(folder)) await refreshFolder();
  toast("Saved");
}

// ---------- sidebar ----------

let folderFiles: string[] = [];

async function refreshFolder() {
  if (!folder || !inTauri) return renderSidebar();
  try {
    folderFiles = await invoke<string[]>("list_markdown_files", { dir: folder });
  } catch {
    folder = null;
    folderFiles = [];
    localStorage.removeItem("folder");
  }
  renderSidebar();
}

async function openFolderDialog() {
  if (!inTauri) return toast("Opening folders needs the desktop app");
  const picked = await open({ directory: true, multiple: false });
  if (typeof picked !== "string") return;
  folder = picked;
  localStorage.setItem("folder", picked);
  await refreshFolder();
}

function fileItem(p: string, detail: string): HTMLLIElement {
  const li = document.createElement("li");
  li.title = p;
  li.classList.toggle("current", p === path);
  const name = document.createElement("span");
  name.className = "name";
  name.textContent = basename(p);
  li.append(name);
  if (detail) {
    const dir = document.createElement("span");
    dir.className = "dir";
    // The bidi mark keeps the leading "/" or "~" in place inside the rtl-truncated label.
    dir.textContent = `‎${detail}`;
    li.append(dir);
  }
  li.addEventListener("click", () => p !== path && loadFile(p));
  return li;
}

function renderSidebar() {
  const folderSection = $("folder-section");
  folderSection.hidden = !folder;
  if (folder) {
    $("folder-name").textContent = basename(folder);
    $("folder-name").title = folder;
    const root = folder;
    const items = folderFiles.map((p) => {
      const rel = dirname(p).slice(root.length).replace(/^[\\/]/, "");
      return fileItem(p, rel);
    });
    if (!items.length) {
      const empty = document.createElement("li");
      empty.className = "empty";
      empty.textContent = "No markdown files";
      items.push(empty);
    }
    $("folder-list").replaceChildren(...items);
  }

  $("recent-section").hidden = recents.length === 0;
  $("recent-list").replaceChildren(...recents.map((p) => fileItem(p, tildify(dirname(p)))));
}

function toggleSidebar() {
  const collapsed = app.classList.toggle("sidebar-collapsed");
  localStorage.setItem("sidebarCollapsed", String(collapsed));
}

// ---------- wiring ----------

$("btn-new").addEventListener("click", newDocument);
$("btn-open").addEventListener("click", openDialog);
$("btn-folder").addEventListener("click", openFolderDialog);
$("btn-close-folder").addEventListener("click", () => {
  folder = null;
  folderFiles = [];
  localStorage.removeItem("folder");
  renderSidebar();
});
$("btn-sidebar").addEventListener("click", toggleSidebar);
$("btn-save").addEventListener("click", () => saveDocument());
$("mode-rich").addEventListener("click", () => setMode("rich"));
$("mode-source").addEventListener("click", () => setMode("source"));

sourceEl.addEventListener("input", () => {
  setDirty(true);
  autosizeSource();
  refreshStats();
});

sourceEl.addEventListener("keydown", (e) => {
  if (e.key !== "Tab" || e.metaKey || e.ctrlKey || e.altKey) return;
  e.preventDefault();
  document.execCommand("insertText", false, "  ");
});

// Clicking the empty space below the text puts the caret at the end of the document.
$("page").addEventListener("mousedown", (e) => {
  if (e.target !== e.currentTarget && e.target !== editorEl) return;
  if (mode !== "rich") return;
  e.preventDefault();
  const pm = editorEl.querySelector<HTMLElement>(".ProseMirror");
  if (!pm) return;
  pm.focus();
  const selection = window.getSelection();
  selection?.selectAllChildren(pm);
  selection?.collapseToEnd();
});

window.addEventListener("keydown", (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
  const key = e.key.toLowerCase();
  if (key === "s") {
    e.preventDefault();
    saveDocument(e.shiftKey);
  } else if (key === "o") {
    e.preventDefault();
    e.shiftKey ? openFolderDialog() : openDialog();
  } else if (key === "n") {
    e.preventDefault();
    newDocument();
  } else if (key === "\\") {
    e.preventDefault();
    toggleSidebar();
  } else if (key === "/") {
    e.preventDefault();
    setMode(mode === "rich" ? "source" : "rich");
  }
});

window.addEventListener("resize", () => mode === "source" && autosizeSource());

async function init() {
  if (localStorage.getItem("sidebarCollapsed") === "true") app.classList.add("sidebar-collapsed");
  if (inTauri && navigator.userAgent.includes("Mac")) app.classList.add("overlay-titlebar");

  await setContent("");
  refreshChrome();

  if (!inTauri) return;

  await listen<string>("open-file", async ({ payload }) => {
    await invoke("take_pending_file");
    await loadFile(payload);
  });

  await getCurrentWebview().onDragDropEvent(({ payload }) => {
    if (payload.type !== "drop") return;
    const dropped = payload.paths.find(isMarkdown) ?? payload.paths[0];
    if (dropped) loadFile(dropped);
  });

  await getCurrentWindow().onCloseRequested(async (event) => {
    if (!(await confirmDiscard())) event.preventDefault();
  });

  const pending = await invoke<string | null>("take_pending_file");
  const initial = pending ?? localStorage.getItem("lastFile");
  if (initial) await loadFile(initial, { skipConfirm: true });
  await refreshFolder();
}

init();
