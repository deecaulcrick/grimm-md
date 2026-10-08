import { Crepe } from "@milkdown/crepe";
import { remarkStringifyOptionsCtx } from "@milkdown/kit/core";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";
import "./styles.css";

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask, message, open, save } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import {
  ArrowRightLeft,
  Code,
  Columns2,
  FileText,
  FolderOpen,
  Palette,
  PanelLeft,
  Plus,
  X,
  createElement,
  createIcons,
  type IconNode,
} from "lucide";

import { codeTheme } from "./codeTheme";
import { blockEditIcons, embedIcon } from "./editorIcons";
import { codeLanguages, insertEmbed, renderEmbed } from "./htmlEmbed";
import { linkCards } from "./linkCards";
import { THEMES, applyTheme, type Theme } from "./themes";

type Mode = "rich" | "source";
type DocFont = "serif" | "sans";

interface Doc {
  path: string | null;
  dirty: boolean;
  mode: Mode;
  crepe: Crepe | null;
  // YAML frontmatter is kept out of the rich editor (it would be parsed as a
  // rule + heading) and re-attached when the document is serialized.
  frontmatter: string;
  // What the rich editor serializes an untouched document to; used to tell real
  // edits apart from the editor merely normalizing markdown on load.
  baseline: string;
  pane: Pane;
  el: HTMLElement;
  editorEl: HTMLElement;
  sourceEl: HTMLTextAreaElement;
}

interface Pane {
  docs: Doc[];
  active: Doc | null;
  el: HTMLElement;
  barEl: HTMLElement;
  bodyEl: HTMLElement;
}

interface Session {
  panes: { paths: string[]; active: string | null }[];
}

// The UI also runs in a plain browser (vite dev) with file access disabled.
const inTauri = "__TAURI_INTERNALS__" in window;
const MARKDOWN_EXTENSIONS = ["md", "markdown", "mdx", "mdown"];
const MAX_RECENTS = 12;
const MAX_PANES = 2;
const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/;
const ICON_ATTRS = { "stroke-width": 1.5 };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const app = $("app");
const panesEl = $("panes");
const docPath = $("doc-path");
const docStats = $("doc-stats");
const appearanceMenu = $("appearance");
const toastEl = $("toast");

const panes: Pane[] = [];
let focused: Pane;
let folder: string | null = localStorage.getItem("folder");
let folderFiles: string[] = [];
let recents: string[] = JSON.parse(localStorage.getItem("recents") ?? "[]");
let theme: Theme =
  THEMES.find((t) => t.id === localStorage.getItem("theme")) ??
  THEMES.find((t) => t.scheme === (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"))!;

let docFont: DocFont = localStorage.getItem("font") === "sans" ? "sans" : "serif";

// ---------- helpers ----------

const basename = (p: string) => p.split(/[\\/]/).pop() ?? p;
const dirname = (p: string) => p.replace(/[\\/][^\\/]*$/, "");
const isMarkdown = (p: string) =>
  MARKDOWN_EXTENSIONS.includes(p.split(".").pop()?.toLowerCase() ?? "");
const tildify = (p: string) => p.replace(/^\/Users\/[^/]+/, "~");
const docName = (doc: Doc) => (doc.path ? basename(doc.path) : "Untitled");
const allDocs = () => panes.flatMap((p) => p.docs);
const isPristine = (doc: Doc) => !doc.path && !doc.dirty;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

const icon = (node: IconNode) => createElement(node, { ...ICON_ATTRS, class: "lucide" });

function iconButton(node: IconNode, title: string, onClick: (e: MouseEvent) => void, className = "icon-btn") {
  const button = el("button", className);
  button.title = title;
  button.append(icon(node));
  button.addEventListener("click", onClick);
  return button;
}

let toastTimer = 0;
/** Shows a brief message; a duration of 0 keeps it up until the next one. */
function toast(text: string, duration = 2600) {
  toastEl.textContent = text;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  if (duration) toastTimer = window.setTimeout(() => (toastEl.hidden = true), duration);
}

async function confirmDiscard(text: string, okLabel: string): Promise<boolean> {
  if (!inTauri) return window.confirm(text);
  return ask(text, { title: "Unsaved changes", kind: "warning", okLabel, cancelLabel: "Cancel" });
}

// ---------- rendering ----------

function renderBar(pane: Pane) {
  const first = panes[0] === pane;
  const last = panes[panes.length - 1] === pane;
  const children: HTMLElement[] = [];

  if (first) children.push(iconButton(PanelLeft, "Toggle sidebar (⌘\\)", toggleSidebar));

  const tabs = el("div", "tabs");
  tabs.setAttribute("data-tauri-drag-region", "");
  for (const doc of pane.docs) {
    const tab = el("div", "tab");
    tab.classList.toggle("active", doc === pane.active);
    tab.classList.toggle("dirty", doc.dirty);
    tab.title = doc.path ? tildify(doc.path) : "Untitled";
    const name = el("span", "tab-name");
    name.textContent = docName(doc);
    const close = el("button", "tab-close");
    close.title = "Close tab (⌘W)";
    close.append(icon(X));
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      closeDoc(doc);
    });
    tab.append(name, close);
    tab.addEventListener("click", () => activate(doc));
    tab.addEventListener("auxclick", (e) => e.button === 1 && closeDoc(doc));
    tabs.append(tab);
  }
  tabs.append(iconButton(Plus, "New document (⌘N)", () => newDocument(pane), "icon-btn tab-new"));
  children.push(tabs);

  const actions = el("div", "pane-actions");
  const doc = pane.active;
  if (doc) {
    const source = iconButton(Code, "Markdown source (⌘/)", () =>
      setMode(doc, doc.mode === "rich" ? "source" : "rich"),
    );
    source.classList.toggle("on", doc.mode === "source");
    actions.append(source);
    if (panes.length > 1) {
      actions.append(
        iconButton(ArrowRightLeft, "Move tab to the other pane", () => {
          const target = panes.find((p) => p !== pane);
          if (target) moveDoc(doc, target);
        }),
      );
    }
  }
  if (last) {
    const split = iconButton(Columns2, panes.length > 1 ? "Close split (⇧⌘\\)" : "Split view (⇧⌘\\)", toggleSplit);
    split.classList.toggle("on", panes.length > 1);
    actions.append(
      split,
      iconButton(Palette, "Appearance", (e) => {
        e.stopPropagation();
        toggleAppearance(e.currentTarget as HTMLElement);
      }),
    );
  }
  children.push(actions);

  pane.barEl.replaceChildren(...children);
}

function renderFocus() {
  for (const pane of panes) pane.el.classList.toggle("focused", pane === focused);
  const doc = focused.active;
  const name = doc ? docName(doc) : "Grimm";
  docPath.textContent = doc?.path ? tildify(doc.path) : "Not saved yet";
  document.title = name;
  if (inTauri) getCurrentWindow().setTitle(name).catch(() => {});
  renderStats();
}

function renderStats() {
  const doc = focused.active;
  if (!doc) return;
  const text = getContent(doc).replace(FRONTMATTER, "");
  const words = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.length ?? 0;
  const count = `${words.toLocaleString()} ${words === 1 ? "word" : "words"}`;
  docStats.textContent = doc.dirty ? `Edited  ·  ${count}` : count;
}

function render() {
  panes.forEach(renderBar);
  renderFocus();
  renderSidebar();
  const session: Session = {
    panes: panes.map((p) => ({
      paths: p.docs.flatMap((d) => (d.path ? [d.path] : [])),
      active: p.active?.path ?? null,
    })),
  };
  localStorage.setItem("session", JSON.stringify(session));
}

function setFocused(pane: Pane) {
  if (focused === pane) return;
  focused = pane;
  // Only classes and the status bar change here: rebuilding the tab bar on
  // mousedown would swallow the click that caused the focus change.
  renderFocus();
  renderSidebar();
}

// ---------- resizing ----------

const SIDEBAR_DEFAULT = 256;
const SIDEBAR_MIN = 190;
const SIDEBAR_MAX = 460;
const SPLIT_MIN = 0.22;

/** Turns an element into a drag handle; `onDrag` receives the pointer's x position. */
function draggable(handle: HTMLElement, onDrag: (x: number) => void, onReset: () => void) {
  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    document.body.classList.add("resizing");
    const move = (event: PointerEvent) => onDrag(event.clientX);
    const stop = () => {
      document.body.classList.remove("resizing");
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", stop);
      handle.removeEventListener("pointercancel", stop);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
  });
  handle.addEventListener("dblclick", onReset);
}

function setSidebarWidth(width: number) {
  const clamped = Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, width)));
  app.style.setProperty("--sidebar-w", `${clamped}px`);
  localStorage.setItem("sidebarWidth", String(clamped));
}

function setSplitRatio(ratio: number) {
  const clamped = Math.min(1 - SPLIT_MIN, Math.max(SPLIT_MIN, ratio));
  panesEl.style.setProperty("--split", `${(clamped * 100).toFixed(2)}%`);
  localStorage.setItem("splitRatio", String(clamped));
}

// ---------- panes ----------

function createPane(): Pane {
  const paneEl = el("section", "pane");
  const barEl = el("header", "pane-bar");
  barEl.setAttribute("data-tauri-drag-region", "");
  const bodyEl = el("div", "pane-body");
  paneEl.append(barEl, bodyEl);
  if (panes.length) {
    const divider = el("div", "pane-divider");
    divider.title = "Drag to resize, double-click to reset";
    draggable(
      divider,
      (x) => {
        const bounds = panesEl.getBoundingClientRect();
        setSplitRatio((x - bounds.left) / bounds.width);
      },
      () => setSplitRatio(0.5),
    );
    panesEl.append(divider);
  }
  panesEl.append(paneEl);
  const pane: Pane = { docs: [], active: null, el: paneEl, barEl, bodyEl };
  paneEl.addEventListener("mousedown", () => setFocused(pane), true);
  paneEl.addEventListener("focusin", () => setFocused(pane));
  panes.push(pane);
  return pane;
}

function removePane(pane: Pane) {
  panes.splice(panes.indexOf(pane), 1);
  pane.el.remove();
  panesEl.querySelector(".pane-divider")?.remove();
  if (focused === pane) focused = panes[0];
}

function detach(doc: Doc) {
  const pane = doc.pane;
  const index = pane.docs.indexOf(doc);
  pane.docs.splice(index, 1);
  if (pane.active === doc) pane.active = pane.docs[Math.min(index, pane.docs.length - 1)] ?? null;
}

function attach(doc: Doc, pane: Pane) {
  doc.pane = pane;
  doc.el.hidden = true;
  pane.docs.push(doc);
  pane.bodyEl.append(doc.el);
}

/** Makes sure a pane that just lost a tab still shows something, or goes away. */
async function settlePane(pane: Pane) {
  if (pane.active) showActive(pane);
  else if (panes.length > 1) removePane(pane);
  else await createDoc(pane, null, "");
}

function showActive(pane: Pane) {
  for (const doc of pane.docs) doc.el.hidden = doc !== pane.active;
  if (pane.active?.mode === "source") autosizeSource(pane.active);
}

function activate(doc: Doc) {
  doc.pane.active = doc;
  focused = doc.pane;
  showActive(doc.pane);
  render();
}

async function moveDoc(doc: Doc, target: Pane) {
  const source = doc.pane;
  detach(doc);
  attach(doc, target);
  await settlePane(source);
  activate(doc);
}

async function toggleSplit() {
  if (panes.length < MAX_PANES) {
    const source = focused;
    const pane = createPane();
    if (source.docs.length > 1 && source.active) await moveDoc(source.active, pane);
    else await createDoc(pane, null, "");
    return;
  }
  const [first, second] = panes;
  const keep = focused.active;
  for (const doc of [...second.docs]) {
    detach(doc);
    if (isPristine(doc)) {
      await doc.crepe?.destroy();
      doc.el.remove();
    } else {
      attach(doc, first);
    }
  }
  removePane(second);
  const next = keep && first.docs.includes(keep) ? keep : first.active;
  if (next) activate(next);
}

// ---------- documents ----------

function getContent(doc: Doc): string {
  if (doc.mode === "source") return doc.sourceEl.value;
  return doc.frontmatter + (doc.crepe?.getMarkdown() ?? "");
}

function setDirty(doc: Doc, value: boolean) {
  if (doc.dirty === value) return;
  doc.dirty = value;
  renderBar(doc.pane);
  if (focused.active === doc) renderStats();
}

function autosizeSource(doc: Doc) {
  doc.sourceEl.style.height = "auto";
  doc.sourceEl.style.height = `${doc.sourceEl.scrollHeight}px`;
}

async function mountRich(doc: Doc, markdown: string) {
  const match = markdown.match(FRONTMATTER);
  doc.frontmatter = match ? match[0] : "";
  const body = markdown.slice(doc.frontmatter.length);

  await doc.crepe?.destroy();
  doc.crepe = null;
  doc.editorEl.replaceChildren();
  const instance = new Crepe({
    root: doc.editorEl,
    defaultValue: body,
    features: { [Crepe.Feature.Latex]: false },
    featureConfigs: {
      [Crepe.Feature.Placeholder]: { text: "Start writing…", mode: "doc" },
      [Crepe.Feature.CodeMirror]: {
        theme: codeTheme,
        languages: codeLanguages,
        renderPreview: renderEmbed,
        previewOnlyByDefault: true,
        previewToggleText: (previewOnly) => (previewOnly ? "Edit HTML" : "Hide HTML"),
      },
      [Crepe.Feature.BlockEdit]: {
        ...blockEditIcons,
        buildMenu: (builder) => {
          builder.getGroup("advanced").addItem("embed", { label: "HTML embed", icon: embedIcon, onRun: insertEmbed });
        },
      },
    },
  });
  instance.editor.config((ctx) => {
    ctx.update(remarkStringifyOptionsCtx, (options) => ({ ...options, bullet: "-" as const, rule: "-" as const }));
  });
  instance.editor.use(linkCards);
  instance.on((listener) => {
    listener.markdownUpdated((_ctx, md) => {
      if (doc.crepe !== instance || doc.mode !== "rich") return;
      if (md !== doc.baseline) setDirty(doc, true);
      if (focused.active === doc) renderStats();
    });
  });
  await instance.create();
  doc.crepe = instance;
  doc.baseline = instance.getMarkdown();
}

async function setMode(doc: Doc, next: Mode) {
  if (next === doc.mode) return;
  const content = getContent(doc);
  doc.mode = next;
  doc.editorEl.hidden = next !== "rich";
  doc.sourceEl.hidden = next !== "source";
  if (next === "source") {
    doc.sourceEl.value = content;
    autosizeSource(doc);
    doc.sourceEl.focus();
  } else {
    await mountRich(doc, content);
  }
  render();
}

async function createDoc(pane: Pane, path: string | null, content: string): Promise<Doc> {
  const docEl = el("div", "doc");
  const page = el("div", "page");
  const editorEl = el("div", "editor");
  const sourceEl = el("textarea", "source");
  sourceEl.spellcheck = false;
  sourceEl.placeholder = "Start writing…";
  sourceEl.hidden = true;
  page.append(editorEl, sourceEl);
  docEl.append(page);

  const doc: Doc = {
    path,
    dirty: false,
    mode: "rich",
    crepe: null,
    frontmatter: "",
    baseline: "",
    pane,
    el: docEl,
    editorEl,
    sourceEl,
  };

  sourceEl.addEventListener("input", () => {
    setDirty(doc, true);
    autosizeSource(doc);
    renderStats();
  });
  sourceEl.addEventListener("keydown", (e) => {
    if (e.key !== "Tab" || e.metaKey || e.ctrlKey || e.altKey) return;
    e.preventDefault();
    document.execCommand("insertText", false, "  ");
  });
  // Clicking the empty space below the text puts the caret at the end of the document.
  page.addEventListener("mousedown", (e) => {
    if (e.target !== page && e.target !== editorEl) return;
    if (doc.mode !== "rich") return;
    e.preventDefault();
    const pm = editorEl.querySelector<HTMLElement>(".ProseMirror");
    if (!pm) return;
    pm.focus();
    const selection = window.getSelection();
    selection?.selectAllChildren(pm);
    selection?.collapseToEnd();
  });

  attach(doc, pane);
  await mountRich(doc, content);
  activate(doc);
  return doc;
}

async function closeDoc(doc: Doc, confirm = true): Promise<boolean> {
  if (confirm && doc.dirty) {
    activate(doc);
    if (!(await confirmDiscard(`“${docName(doc)}” has unsaved changes. Close it anyway?`, "Close"))) return false;
  }
  const pane = doc.pane;
  detach(doc);
  await doc.crepe?.destroy();
  doc.el.remove();
  await settlePane(pane);
  render();
  return true;
}

async function newDocument(pane = focused) {
  const doc = await createDoc(pane, null, "");
  doc.editorEl.querySelector<HTMLElement>(".ProseMirror")?.focus();
}

// ---------- file operations ----------

function rememberRecent(p: string) {
  recents = [p, ...recents.filter((r) => r !== p)].slice(0, MAX_RECENTS);
  localStorage.setItem("recents", JSON.stringify(recents));
}

async function openPath(p: string, { otherPane = false, quiet = false } = {}) {
  const existing = allDocs().find((d) => d.path === p);
  if (existing) return activate(existing);

  let text: string;
  try {
    text = await invoke<string>("read_file", { path: p });
  } catch (err) {
    recents = recents.filter((r) => r !== p);
    localStorage.setItem("recents", JSON.stringify(recents));
    renderSidebar();
    if (!quiet) toast(`Couldn't open ${basename(p)}: ${err}`);
    return;
  }

  let pane = focused;
  if (otherPane) pane = panes.find((candidate) => candidate !== focused) ?? createPane();
  // An untouched "Untitled" tab is replaced rather than left behind.
  const placeholder = pane.active && isPristine(pane.active) ? pane.active : null;
  await createDoc(pane, p, text);
  if (placeholder) await closeDoc(placeholder, false);
  rememberRecent(p);
  render();
}

async function openDialog() {
  if (!inTauri) return toast("Opening files needs the desktop app");
  const picked = await open({
    multiple: true,
    filters: [
      { name: "Markdown", extensions: MARKDOWN_EXTENSIONS },
      { name: "All files", extensions: ["*"] },
    ],
  });
  for (const p of picked ?? []) await openPath(p);
}

async function saveDocument(doc: Doc | null, saveAs = false) {
  if (!doc) return;
  if (!inTauri) return toast("Saving needs the desktop app");
  let target = doc.path;
  if (!target || saveAs) {
    const picked = await save({
      defaultPath: doc.path ?? (folder ? `${folder}/Untitled.md` : "Untitled.md"),
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (!picked) return;
    target = picked;
  }
  try {
    await invoke("write_file", { path: target, contents: getContent(doc) });
  } catch (err) {
    toast(`Couldn't save: ${err}`);
    return;
  }
  doc.path = target;
  doc.dirty = false;
  if (doc.mode === "rich" && doc.crepe) doc.baseline = doc.crepe.getMarkdown();
  rememberRecent(target);
  render();
  if (folder && target.startsWith(folder)) await refreshFolder();
  toast("Saved");
}

// ---------- sidebar ----------

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

function fileItem(p: string, detail: string, openPaths: Set<string>): HTMLLIElement {
  const li = el("li");
  li.title = `${p}\n⌘-click to open in the other pane`;
  li.classList.toggle("open", openPaths.has(p));
  li.classList.toggle("current", focused.active?.path === p);
  const name = el("span", "name");
  name.textContent = basename(p);
  li.append(name);
  if (detail) {
    const dir = el("span", "dir");
    // The bidi mark keeps the leading "/" or "~" in place inside the rtl-truncated label.
    dir.textContent = `‎${detail}`;
    li.append(dir);
  }
  li.addEventListener("click", (e) => openPath(p, { otherPane: e.metaKey || e.ctrlKey }));
  return li;
}

function renderSidebar() {
  const openPaths = new Set(allDocs().flatMap((d) => (d.path ? [d.path] : [])));
  $("folder-section").hidden = !folder;
  if (folder) {
    $("folder-name").textContent = basename(folder);
    $("folder-name").title = folder;
    const root = folder;
    const items = folderFiles.map((p) => {
      const rel = dirname(p).slice(root.length).replace(/^[\\/]/, "");
      return fileItem(p, rel, openPaths);
    });
    if (!items.length) {
      const empty = el("li", "empty");
      empty.textContent = "No markdown files";
      items.push(empty);
    }
    $("folder-list").replaceChildren(...items);
  }

  $("recent-section").hidden = recents.length === 0;
  $("recent-list").replaceChildren(...recents.map((p) => fileItem(p, tildify(dirname(p)), openPaths)));
}

function toggleSidebar() {
  const collapsed = app.classList.toggle("sidebar-collapsed");
  localStorage.setItem("sidebarCollapsed", String(collapsed));
}

// ---------- appearance ----------

function setTheme(next: Theme) {
  theme = next;
  applyTheme(next);
  localStorage.setItem("theme", next.id);
}

function setDocFont(next: DocFont) {
  docFont = next;
  document.documentElement.dataset.font = next;
  localStorage.setItem("font", next);
}

function renderAppearance() {
  const label = (text: string) => {
    const node = el("div", "menu-label");
    node.textContent = text;
    return node;
  };

  const grid = el("div", "theme-grid");
  for (const t of THEMES) {
    const tile = el("button", "theme-tile");
    tile.classList.toggle("selected", t === theme);
    const preview = el("span", "tile-preview");
    preview.style.background = t.bg;
    preview.style.color = t.text;
    preview.textContent = "Aa";
    const dot = el("i");
    dot.style.background = t.accent;
    preview.append(dot);
    const name = el("span", "tile-name");
    name.textContent = t.name;
    tile.append(preview, name);
    tile.addEventListener("click", () => {
      setTheme(t);
      renderAppearance();
    });
    grid.append(tile);
  }

  const fonts = el("div", "font-toggle");
  for (const [id, text] of [["serif", "Serif"], ["sans", "Sans"]] as const) {
    const button = el("button", id);
    button.textContent = text;
    button.classList.toggle("selected", id === docFont);
    button.addEventListener("click", () => {
      setDocFont(id);
      renderAppearance();
    });
    fonts.append(button);
  }

  appearanceMenu.replaceChildren(label("Theme"), grid, label("Font"), fonts);
}

function toggleAppearance(anchor: HTMLElement) {
  if (!appearanceMenu.hidden) return void (appearanceMenu.hidden = true);
  renderAppearance();
  appearanceMenu.hidden = false;
  const rect = anchor.getBoundingClientRect();
  appearanceMenu.style.top = `${rect.bottom + 6}px`;
  appearanceMenu.style.left = `${Math.max(8, rect.right - appearanceMenu.offsetWidth)}px`;
}

// ---------- updates ----------

let updating = false;

async function installUpdate(update: Update) {
  const unsaved = allDocs().filter((d) => d.dirty).length;
  if (unsaved && !(await confirmDiscard("Updating restarts Grimm and discards unsaved changes. Continue?", "Update")))
    return;
  updating = true;
  toast(`Downloading Grimm ${update.version}…`, 0);
  try {
    await update.downloadAndInstall();
    await relaunch();
  } catch (err) {
    updating = false;
    toast(`Update failed: ${err}`);
  }
}

/** Looks for a newer release. Only a manual check reports "up to date" or errors. */
async function checkForUpdates(manual = false) {
  if (!inTauri || updating) return;
  let update: Update | null;
  try {
    update = await check();
  } catch (err) {
    if (manual) await message(`Couldn't check for updates.\n${err}`, { title: "Grimm", kind: "error" });
    return;
  }
  if (!update) {
    if (manual) await message("You're on the latest version.", { title: "Grimm" });
    return;
  }
  const notes = update.body?.trim() ? `\n\n${update.body.trim()}` : "";
  const install = await ask(`Grimm ${update.version} is available (you have ${update.currentVersion}).${notes}`, {
    title: "Update available",
    okLabel: "Update and restart",
    cancelLabel: "Later",
  });
  if (install) await installUpdate(update);
}

// ---------- commands ----------

function cycleTab(step: number) {
  const { docs, active } = focused;
  if (!active || docs.length < 2) return;
  activate(docs[(docs.indexOf(active) + step + docs.length) % docs.length]);
}

const commands: Record<string, () => unknown> = {
  new: () => newDocument(),
  open: openDialog,
  "open-folder": openFolderDialog,
  save: () => saveDocument(focused.active),
  "save-as": () => saveDocument(focused.active, true),
  "close-tab": () => focused.active && closeDoc(focused.active),
  "toggle-sidebar": toggleSidebar,
  "toggle-source": () => focused.active && setMode(focused.active, focused.active.mode === "rich" ? "source" : "rich"),
  "toggle-split": toggleSplit,
  "next-tab": () => cycleTab(1),
  "prev-tab": () => cycleTab(-1),
  // Goes through the window so the unsaved-changes check runs first.
  quit: () => inTauri && getCurrentWindow().close(),
  "check-updates": () => checkForUpdates(true),
};

// A shortcut can arrive both as a keydown and as a native menu event; the
// short window keeps it from running twice.
let lastCommand = "";
let lastCommandAt = 0;
function run(id: string) {
  const now = performance.now();
  if (id === lastCommand && now - lastCommandAt < 250) return;
  lastCommand = id;
  lastCommandAt = now;
  commands[id]?.();
}

function shortcut(e: KeyboardEvent): string | null {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return null;
  switch (e.code) {
    case "KeyS":
      return e.shiftKey ? "save-as" : "save";
    case "KeyO":
      return e.shiftKey ? "open-folder" : "open";
    case "KeyN":
    case "KeyT":
      return e.shiftKey ? null : "new";
    case "KeyW":
      return e.shiftKey ? null : "close-tab";
    case "Backslash":
      return e.shiftKey ? "toggle-split" : "toggle-sidebar";
    case "Slash":
      return "toggle-source";
    case "BracketRight":
      return e.shiftKey ? "next-tab" : null;
    case "BracketLeft":
      return e.shiftKey ? "prev-tab" : null;
    default:
      return null;
  }
}

// ---------- wiring ----------

createIcons({
  icons: { Plus, FileText, FolderOpen, X },
  attrs: ICON_ATTRS,
});

$("btn-new").addEventListener("click", () => newDocument());
$("btn-open").addEventListener("click", openDialog);
$("btn-folder").addEventListener("click", openFolderDialog);
$("btn-close-folder").addEventListener("click", () => {
  folder = null;
  folderFiles = [];
  localStorage.removeItem("folder");
  renderSidebar();
});

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") appearanceMenu.hidden = true;
  const id = shortcut(e);
  if (!id) return;
  e.preventDefault();
  run(id);
});

window.addEventListener("mousedown", (e) => {
  if (!appearanceMenu.hidden && !appearanceMenu.contains(e.target as Node)) appearanceMenu.hidden = true;
});

window.addEventListener("resize", () => {
  appearanceMenu.hidden = true;
  for (const pane of panes) if (pane.active?.mode === "source") autosizeSource(pane.active);
});

async function restoreSession() {
  const saved: Session | null = JSON.parse(localStorage.getItem("session") ?? "null");
  for (const [index, entry] of (saved?.panes ?? []).slice(0, MAX_PANES).entries()) {
    if (!entry.paths.length) continue;
    focused = index === 0 ? panes[0] : createPane();
    const pane = focused;
    for (const p of entry.paths) await openPath(p, { quiet: true });
    const active = pane.docs.find((d) => d.path === entry.active);
    if (active) activate(active);
    // None of this pane's files could be reopened.
    if (!pane.docs.length && panes.length > 1) removePane(pane);
  }
  focused = panes[0];
  render();
}

async function init() {
  applyTheme(theme);
  document.documentElement.dataset.font = docFont;
  if (localStorage.getItem("sidebarCollapsed") === "true") app.classList.add("sidebar-collapsed");
  setSidebarWidth(Number(localStorage.getItem("sidebarWidth")) || SIDEBAR_DEFAULT);
  setSplitRatio(Number(localStorage.getItem("splitRatio")) || 0.5);
  draggable($("sidebar-resizer"), setSidebarWidth, () => setSidebarWidth(SIDEBAR_DEFAULT));
  if (inTauri && navigator.userAgent.includes("Mac")) app.classList.add("overlay-titlebar");

  focused = createPane();
  await createDoc(focused, null, "");

  if (!inTauri) return;

  await restoreSession();

  await listen<string>("menu", ({ payload }) => run(payload));

  await listen<string>("open-file", async ({ payload }) => {
    await invoke("take_pending_file");
    await openPath(payload);
  });

  await getCurrentWebview().onDragDropEvent(async ({ payload }) => {
    if (payload.type !== "drop") return;
    const dropped = payload.paths.filter(isMarkdown);
    for (const p of dropped.length ? dropped : payload.paths.slice(0, 1)) await openPath(p);
  });

  await getCurrentWindow().onCloseRequested(async (event) => {
    const unsaved = allDocs().filter((d) => d.dirty).length;
    if (!unsaved) return;
    const text =
      unsaved === 1
        ? "A document has unsaved changes. Quit anyway?"
        : `${unsaved} documents have unsaved changes. Quit anyway?`;
    if (!(await confirmDiscard(text, "Quit"))) event.preventDefault();
  });

  const pending = await invoke<string | null>("take_pending_file");
  if (pending) await openPath(pending);
  await refreshFolder();
  checkForUpdates();
}

init();
