import { Crepe } from "@milkdown/crepe";
import { editorViewCtx, remarkStringifyOptionsCtx } from "@milkdown/kit/core";
import { headingIdGenerator } from "@milkdown/kit/preset/commonmark";
import { redo, undo } from "@milkdown/kit/prose/history";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";
import "./styles.css";

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask, message, open, save } from "@tauri-apps/plugin-dialog";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import {
  ArrowRightLeft,
  Check,
  FolderInput,
  PenLine,
  Folder,
  FolderPlus,
  Star,
  ChevronDown,
  ChevronRight,
  SquarePen,
  ClipboardCopy,
  CopyPlus,
  Ellipsis,
  Link2,
  Lock,
  Search,
  CircleQuestionMark,
  Clock,
  Code,
  Copy,
  ExternalLink,
  Columns2,
  FileText,
  FolderOpen,
  GitCommitHorizontal,
  Globe,
  History as HistoryIcon,
  Image as ImageIcon,
  Info,
  Palette,
  PanelLeft,
  Plus,
  RefreshCw,
  Share,
  Trash2,
  X,
  createElement,
  createIcons,
  type IconNode,
} from "lucide";

import { blockDrag } from "./blockDrag";
import { codeTheme } from "./codeTheme";
import { blockEditIcons, codeBlockIcons, diagramIcon, embedIcon, imageBlockConfig, tableIcons } from "./editorIcons";
import examplesGuide from "./guides/examples.md?raw";
import featuresGuide from "./guides/features.md?raw";
import helpGuide from "./guides/help.md?raw";
import welcomeGuide from "./guides/welcome.md?raw";
import { imageTitles, imageUrl, saveImage } from "./images";
import { codeLanguages, insertCodeBlock, renderPreview } from "./codeBlocks";
import { DIAGRAM_LANGUAGE } from "./diagrams";
import { closeHistory, historyOpen, openHistory, type Reason } from "./history";
import { EMBED_LANGUAGE } from "./htmlEmbed";
import { linkCards } from "./linkCards";
import { emptySearchScene, tinyLeaf } from "./illustrations";
import { showOnboarding, startHead, startPanel } from "./onboarding";
import { Outline } from "./outline";
import { anchorScroll } from "./scrollAnchor";
import { installTableDrag } from "./tableDrag";
import { fingerprint, moveShare, publish, sharedPages, shareHost, shareRecord, shareStatus, unshare, type ShareInput } from "./share";
import {
  dirOf,
  localImageRefs,
  movedPath,
  nameProblem,
  remapList,
  renamedPath,
  resolveRelative,
  rewriteImageRefs,
} from "./notePaths";
import { taskShortcut } from "./taskShortcut";
import { selectionToolbar } from "./selectionToolbar";
import { configureTextColor, textColor } from "./textColor";
import { THEMES, applyTheme, findTheme, type Theme } from "./themes";

type Mode = "rich" | "source";
type DocFont = "serif" | "sans" | "mono";
type PageWidth = "centered" | "full";
type DocSize = "small" | "normal" | "large";

/** How one note looks and behaves; each note keeps its own, like a Notion page. */
interface NotePrefs {
  font: DocFont;
  size: DocSize;
  width: PageWidth;
  locked: boolean;
}

interface Doc {
  path: string | null;
  // The name of a built-in guide, shown on its tab until it is saved somewhere.
  title: string | null;
  dirty: boolean;
  mode: Mode;
  crepe: Crepe | null;
  // YAML frontmatter is kept out of the rich editor (it would be parsed as a
  // rule + heading) and re-attached when the document is serialized.
  frontmatter: string;
  // What the rich editor serializes an untouched document to; used to tell real
  // edits apart from the editor merely normalizing markdown on load.
  baseline: string;
  // Hash of the file the text was last read from or written to, so a save
  // never overwrites a newer file from outside (see write_file).
  disk: string | null;
  // A newer file from outside that arrived while there were unsaved edits.
  conflict: { contents: string; hash: string } | null;
  // Set for a note in a git repository; looked up again as the note changes.
  git: GitInfo | null;
  pane: Pane;
  el: HTMLElement;
  noticeEl: HTMLElement;
  editorEl: HTMLElement;
  sourceEl: HTMLTextAreaElement;
  prefs: NotePrefs;
  // When the file was last written, for the "Edited" label.
  modified: number | null;
}

interface Pane {
  docs: Doc[];
  active: Doc | null;
  el: HTMLElement;
  barEl: HTMLElement;
  headEl: HTMLElement;
  bodyEl: HTMLElement;
  /** Shown in place of a note when the pane has none open. */
  startEl: HTMLElement;
  outline: Outline;
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
const shareMenu = $("share-menu");
const commitMenu = $("commit-menu");
const sharedPagesEl = $("shared-pages");
const sidebarEl = $("sidebar");
const sideSearch = $<HTMLInputElement>("side-search");
const toastEl = $("toast");

const panes: Pane[] = [];
let focused: Pane;
// Every folder open in the sidebar, each with its Markdown files. The one
// folder older versions kept is carried over.
let folders: string[] = JSON.parse(localStorage.getItem("folders") ?? "null") ?? [localStorage.getItem("folder")].filter(Boolean);
const folderFiles = new Map<string, string[]>();
// Folders and subfolders shown expanded in the sidebar. Open folders start out
// expanded, subfolders folded.
const openDirs = new Set<string>(JSON.parse(localStorage.getItem("openDirs") ?? "null") ?? folders);
// Sidebar sections (Favorites, Folders, Shared, Recents) folded away by their header.
const collapsedSections = new Set<string>(JSON.parse(localStorage.getItem("collapsedSections") ?? "[]"));
let favorites: string[] = JSON.parse(localStorage.getItem("favorites") ?? "[]");
const saveFolders = () => {
  localStorage.setItem("folders", JSON.stringify(folders));
  localStorage.setItem("openDirs", JSON.stringify([...openDirs]));
  localStorage.removeItem("folder");
  localStorage.removeItem("collapsedFolders");
};
/** The open folder a path is inside, the deepest one if folders nest. */
const folderOf = (p: string) =>
  folders.filter((f) => p.startsWith(`${f}/`) || p.startsWith(`${f}\\`)).sort((a, b) => b.length - a.length)[0] ?? null;
let recents: string[] = JSON.parse(localStorage.getItem("recents") ?? "[]");
let theme: Theme =
  findTheme(localStorage.getItem("theme")) ??
  THEMES.find((t) => t.scheme === (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"))!;

const DOC_FONTS: DocFont[] = ["serif", "sans", "mono"];
let docFont: DocFont = DOC_FONTS.find((f) => f === localStorage.getItem("font")) ?? "serif";
const DOC_SIZES: DocSize[] = ["small", "normal", "large"];
let docSize: DocSize = DOC_SIZES.find((size) => size === localStorage.getItem("fontSize")) ?? "normal";
let pageWidth: PageWidth = localStorage.getItem("pageWidth") === "full" ? "full" : "centered";

// Per-note settings by file path. Notes without any use the old app-wide
// choices above, so nothing changes for notes that were set up before.
const notePrefs: Record<string, NotePrefs> = JSON.parse(localStorage.getItem("notePrefs") ?? "{}");
const prefsFor = (path: string | null): NotePrefs => ({
  font: docFont,
  size: docSize,
  width: pageWidth,
  locked: false,
  ...(path ? notePrefs[path] : undefined),
});

// ---------- helpers ----------

const basename = (p: string) => p.split(/[\\/]/).pop() ?? p;
const dirname = (p: string) => p.replace(/[\\/][^\\/]*$/, "");
const isMarkdown = (p: string) =>
  MARKDOWN_EXTENSIONS.includes(p.split(".").pop()?.toLowerCase() ?? "");
const tildify = (p: string) => p.replace(/^\/Users\/[^/]+/, "~");
const docName = (doc: Doc) => (doc.path ? basename(doc.path) : (doc.title ?? "Untitled"));
const allDocs = () => panes.flatMap((p) => p.docs);
const isPristine = (doc: Doc) => !doc.path && !doc.dirty && !doc.title;

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

  // With the sidebar closed its toggle and the new-note button move into the
  // first tab bar; hovering the toggle peeks at the sidebar.
  if (first && app.classList.contains("sidebar-collapsed")) {
    const toggle = iconButton(PanelLeft, "Open sidebar (⌘\\)", toggleSidebar, "icon-btn sidebar-toggle");
    toggle.addEventListener("mouseenter", () => peekSidebar(true));
    toggle.addEventListener("mouseleave", () => peekSidebar(false));
    children.push(toggle, iconButton(SquarePen, "New note (⌘N)", () => newDocument(pane)));
  }

  const tabs = el("div", "tabs");
  tabs.setAttribute("data-tauri-drag-region", "");
  for (const doc of pane.docs) {
    const tab = el("div", "tab");
    tab.classList.toggle("active", doc === pane.active);
    tab.classList.toggle("dirty", doc.dirty);
    tab.title = doc.path ? tildify(doc.path) : "Untitled";
    const name = el("span", "tab-name");
    name.textContent = displayName(doc);
    const close = el("button", "tab-close");
    close.title = "Close tab (⌘W)";
    close.append(icon(X));
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      closeDoc(doc);
    });
    tab.append(icon(FileText), name, close);
    tab.addEventListener("click", () => tabDragged || activate(doc));
    tab.addEventListener("pointerdown", (e) => startTabDrag(e, doc, tab));
    tab.addEventListener("auxclick", (e) => e.button === 1 && closeDoc(doc));
    tabs.append(tab);
  }
  tabs.append(iconButton(Plus, "New document (⌘N)", () => newDocument(pane), "icon-btn tab-new"));
  children.push(tabs);

  if (last) {
    const actions = el("div", "pane-actions");
    const split = iconButton(Columns2, panes.length > 1 ? "Close split (⇧⌘\\)" : "Split view (⇧⌘\\)", toggleSplit);
    split.classList.toggle("on", panes.length > 1);
    actions.append(split);
    children.push(actions);
  }

  pane.barEl.replaceChildren(...children);
  renderHead(pane);
}

/** The note's own header: where it lives, when it was edited, Share and its menu. */
function renderHead(pane: Pane) {
  // Not while its name is being edited, or the edit would be thrown away.
  if (pane.headEl.contains(document.activeElement) && document.activeElement?.matches(".rename-input")) return;
  const doc = pane.active;
  if (!doc) return pane.headEl.replaceChildren();

  const crumbs = el("nav", "crumbs");
  for (const part of crumbParts(doc)) {
    if (crumbs.childElementCount) crumbs.append(Object.assign(el("span", "crumb-sep"), { textContent: "/" }));
    crumbs.append(Object.assign(el("span", "crumb"), { textContent: part }));
  }
  const title = crumbs.querySelector<HTMLElement>(".crumb:last-of-type");
  if (title) {
    title.title = "Double-click to rename";
    title.addEventListener("dblclick", () => renameDoc(doc));
  }
  if (doc.prefs.locked) {
    const lock = icon(Lock);
    lock.classList.add("crumb-lock");
    crumbs.append(lock);
  }

  const edited = el(doc.path ? "button" : "span", "edited");
  edited.textContent = editedLabel(doc);
  if (doc.path) {
    edited.title = "Version history (⌥⌘Y)";
    edited.addEventListener("click", () => showHistory(doc));
  }

  const shared = Boolean(doc.path && shareRecord(doc.path));
  const share = el("button", "head-btn share-btn");
  share.classList.toggle("on", shared);
  share.append(icon(shared ? Globe : Share), Object.assign(el("span"), { textContent: shared ? "Shared" : "Share" }));
  share.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleShare(doc, share);
  });

  const more = iconButton(Ellipsis, "Page options", (e) => {
    e.stopPropagation();
    togglePageMenu(doc, e.currentTarget as HTMLElement);
  }, "icon-btn more-btn");
  more.classList.toggle("on", !pageMenu.hidden && menuDoc === doc);

  const items: HTMLElement[] = [crumbs, el("div", "head-gap"), edited];
  if (doc.git) items.push(commitButton(doc));
  items.push(share);
  if (doc.path) {
    const path = doc.path;
    const starred = favorites.includes(path);
    const star = iconButton(Star, starred ? "Remove from Favorites" : "Add to Favorites", () => toggleFavorite(path), "icon-btn star-btn");
    star.classList.toggle("starred", starred);
    items.push(star);
  }
  pane.headEl.replaceChildren(...items, more);
}

const stripExtension = (name: string) => name.replace(/\.(md|markdown|mdx|mdown)$/i, "");
const displayName = (doc: Doc) => stripExtension(docName(doc));

/** The folders above a note (from the open folder it is in, or just its own), then its name. */
function crumbParts(doc: Doc): string[] {
  if (!doc.path) return [displayName(doc)];
  const dir = dirname(doc.path);
  const root = folderOf(doc.path);
  const parts = root ? [basename(root), ...dir.slice(root.length).split(/[\\/]/).filter(Boolean)] : [basename(dir)];
  return [...parts, displayName(doc)];
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: "narrow" });

function timeAgo(ms: number): string {
  const seconds = (Date.now() - ms) / 1000;
  if (seconds < 60) return "just now";
  const steps: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, "minute"],
    [3600, "hour"],
    [86400, "day"],
    [604800, "week"],
    [2629800, "month"],
    [31557600, "year"],
  ];
  let unit = steps[0];
  for (const step of steps) if (seconds >= step[0]) unit = step;
  return relative.format(-Math.floor(seconds / unit[0]), unit[1]);
}

function editedLabel(doc: Doc): string {
  if (!doc.path) return doc.title ? "" : "Not saved yet";
  if (doc.dirty) return "Edited just now";
  return doc.modified ? `Edited ${timeAgo(doc.modified)}` : "";
}

/** "Today at 10:34", "Yesterday at 10:34" or the date, as Notion's menu shows it. */
function editedAt(ms: number): string {
  const date = new Date(ms);
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(ms).setHours(0, 0, 0, 0)) / 86400000);
  if (days === 0) return `Today at ${time}`;
  if (days === 1) return `Yesterday at ${time}`;
  return `${date.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })} at ${time}`;
}

function renderFocus() {
  for (const pane of panes) pane.el.classList.toggle("focused", pane === focused);
  const doc = focused.active;
  const name = doc ? docName(doc) : "Grimm";
  docPath.textContent = doc?.path ? tildify(doc.path) : "";
  document.title = name;
  if (inTauri) getCurrentWindow().setTitle(name).catch(() => {});
  renderStats();
}

function wordCount(doc: Doc): string {
  const text = getContent(doc).replace(FRONTMATTER, "");
  const words = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.length ?? 0;
  return `${words.toLocaleString()} ${words === 1 ? "word" : "words"}`;
}

function renderStats() {
  const doc = focused.active;
  if (!doc) return void (docStats.textContent = "");
  docStats.textContent = wordCount(doc);
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
  watchOpenNotes();
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
  const headEl = el("div", "page-head");
  const bodyEl = el("div", "pane-body");
  paneEl.append(barEl, headEl, bodyEl);
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
  const outline = new Outline();
  const startEl = el("div", "pane-start");
  bodyEl.append(outline.el, startEl);
  const pane: Pane = { docs: [], active: null, el: paneEl, barEl, headEl, bodyEl, startEl, outline };
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

function attach(doc: Doc, pane: Pane, index = pane.docs.length) {
  doc.pane = pane;
  doc.el.hidden = true;
  pane.docs.splice(index, 0, doc);
  pane.bodyEl.append(doc.el);
}

/** A pane that just lost its last tab goes away, unless it is the only one. */
async function settlePane(pane: Pane) {
  if (!pane.active && panes.length > 1) removePane(pane);
  else showActive(pane);
}

function showActive(pane: Pane) {
  for (const doc of pane.docs) doc.el.hidden = doc !== pane.active;
  renderStart(pane);
  if (pane.active?.mode === "source") autosizeSource(pane.active);
  refreshOutline(pane);
}

/** The outline follows the pane's visible document; the raw Markdown view has none. */
function refreshOutline(pane: Pane) {
  const doc = pane.active;
  const rich = doc?.mode === "rich";
  pane.outline.show(rich ? doc.el : null, rich ? doc.editorEl : null);
}

function activate(doc: Doc) {
  doc.pane.active = doc;
  focused = doc.pane;
  showActive(doc.pane);
  render();
}

async function moveDoc(doc: Doc, target: Pane, index?: number) {
  const source = doc.pane;
  detach(doc);
  attach(doc, target, index);
  await settlePane(source);
  activate(doc);
}

// ---------- tab dragging ----------

const TAB_DRAG_THRESHOLD = 5;
const tabDropEl = el("div", "tab-drop");
// Set while a press on a tab turned into a drag, so the click that ends it is ignored.
let tabDragged = false;

/** Where a tab dragged to this point would land: a slot in a tab bar, or the end of another pane. */
function tabDropTarget(doc: Doc, x: number, y: number): { pane: Pane; index: number } | null {
  const pane = panes.find((p) => {
    const r = p.el.getBoundingClientRect();
    return x >= r.left && x < r.right && y >= r.top && y < r.bottom;
  });
  if (!pane) return null;
  if (y >= pane.barEl.getBoundingClientRect().bottom) {
    return pane === doc.pane ? null : { pane, index: pane.docs.length };
  }
  const tabs = [...pane.barEl.querySelectorAll<HTMLElement>(".tab")];
  const index = tabs.filter((tab) => {
    const r = tab.getBoundingClientRect();
    return x > r.left + r.width / 2;
  }).length;
  return { pane, index };
}

function showTabDrop(target: { pane: Pane; index: number } | null, from?: Pane) {
  for (const pane of panes) pane.el.classList.remove("drop-target");
  tabDropEl.hidden = true;
  if (!target) return;
  const tabs = [...target.pane.barEl.querySelectorAll<HTMLElement>(".tab")];
  const edge = tabs[target.index]?.getBoundingClientRect().left ?? tabs[tabs.length - 1]?.getBoundingClientRect().right;
  if (edge === undefined) return;
  const bar = tabs[0].getBoundingClientRect();
  tabDropEl.style.left = `${Math.round(edge) - 2}px`;
  tabDropEl.style.top = `${bar.top}px`;
  tabDropEl.style.height = `${bar.height}px`;
  tabDropEl.hidden = false;
  if (target.pane !== from) target.pane.el.classList.add("drop-target");
}

function startTabDrag(down: PointerEvent, doc: Doc, tab: HTMLElement) {
  tabDragged = false;
  if (down.button !== 0 || (down.target as HTMLElement).closest(".tab-close")) return;
  let target: { pane: Pane; index: number } | null = null;

  const move = (e: PointerEvent) => {
    if (!tabDragged) {
      if (Math.hypot(e.clientX - down.clientX, e.clientY - down.clientY) < TAB_DRAG_THRESHOLD) return;
      tabDragged = true;
      tab.classList.add("dragging");
      document.body.classList.add("dragging-tab");
      document.body.append(tabDropEl);
    }
    target = tabDropTarget(doc, e.clientX, e.clientY);
    showTabDrop(target, doc.pane);
  };
  const stop = (drop: boolean) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cancel);
    window.removeEventListener("keydown", key, true);
    if (!tabDragged) return;
    tab.classList.remove("dragging");
    document.body.classList.remove("dragging-tab");
    showTabDrop(null);
    tabDropEl.remove();
    if (drop && target) dropTab(doc, target.pane, target.index);
  };
  const up = () => stop(true);
  const cancel = () => stop(false);
  const key = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    stop(false);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cancel);
  window.addEventListener("keydown", key, true);
}

function dropTab(doc: Doc, pane: Pane, index: number) {
  if (pane !== doc.pane) return void moveDoc(doc, pane, index);
  const from = pane.docs.indexOf(doc);
  const to = index > from ? index - 1 : index;
  if (to !== from) {
    pane.docs.splice(from, 1);
    pane.docs.splice(to, 0, doc);
  }
  activate(doc);
}

async function toggleSplit() {
  // Splitting an empty window would only show the start view twice.
  if (panes.length < MAX_PANES && !focused.docs.length) return;
  if (panes.length < MAX_PANES) {
    const source = focused;
    const pane = createPane();
    if (source.docs.length > 1 && source.active) await moveDoc(source.active, pane);
    else showActive(pane);
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
    // The selection menu is Grimm's own (selectionToolbar.ts).
    features: { [Crepe.Feature.Latex]: false, [Crepe.Feature.Toolbar]: false },
    featureConfigs: {
      [Crepe.Feature.Placeholder]: { text: "Start writing…", mode: "doc" },
      [Crepe.Feature.CodeMirror]: {
        ...codeBlockIcons,
        theme: codeTheme,
        languages: codeLanguages,
        renderPreview,
        previewOnlyByDefault: true,
        previewToggleText: (previewOnly) => (previewOnly ? "Edit source" : "Hide source"),
      },
      [Crepe.Feature.Table]: tableIcons,
      [Crepe.Feature.ImageBlock]: {
        ...imageBlockConfig,
        onUpload: (file) => uploadImage(doc, file),
        proxyDomURL: (url) => imageUrl(url, doc.path),
      },
      [Crepe.Feature.BlockEdit]: {
        ...blockEditIcons,
        buildMenu: (builder) => {
          builder
            .getGroup("advanced")
            .addItem("embed", { label: "HTML embed", icon: embedIcon, onRun: insertCodeBlock(EMBED_LANGUAGE) })
            .addItem("diagram", { label: "Diagram", icon: diagramIcon, onRun: insertCodeBlock(DIAGRAM_LANGUAGE) });
        },
      },
    },
  });
  instance.editor.config((ctx) => {
    ctx.update(remarkStringifyOptionsCtx, (options) => ({ ...options, bullet: "-" as const, rule: "-" as const }));
    // Headings get an id from their text. Prefixed, a heading called "Appearance"
    // or "Sidebar" cannot collide with the app's own element of that id.
    ctx.update(headingIdGenerator.key, (slug) => (node) => `h-${slug(node)}`);
    configureTextColor(ctx);
  });
  instance.editor.use(linkCards).use(taskShortcut).use(blockDrag).use(imageTitles).use(textColor).use(selectionToolbar);
  instance.on((listener) => {
    listener.markdownUpdated((_ctx, md) => {
      if (doc.crepe !== instance || doc.mode !== "rich") return;
      if (md !== doc.baseline) {
        setDirty(doc, true);
        scheduleAutosave(doc);
      }
      if (focused.active === doc) renderStats();
      if (doc.pane.active === doc) refreshOutline(doc.pane);
    });
  });
  await instance.create();
  instance.setReadonly(doc.prefs.locked);
  doc.crepe = instance;
  doc.baseline = instance.getMarkdown();
}

/**
 * Stores a picked image beside the note and returns the relative path that goes
 * into the Markdown. An empty result leaves the image block as it was.
 */
async function uploadImage(doc: Doc, file: File): Promise<string> {
  // In a plain browser there is no disk to write to; the picture lasts for the session.
  if (!inTauri) return URL.createObjectURL(file);
  // The path is relative to the note, so the note needs a place on disk first.
  if (!doc.path) {
    toast("Save this note first: its images are kept in a folder beside it", 6000);
    await saveDocument(doc);
    if (!doc.path) {
      toast("Image not added, the note has to be saved first");
      return "";
    }
  }
  try {
    return await saveImage(file, doc.path);
  } catch (err) {
    toast(`Couldn't add the image: ${err}`);
    return "";
  }
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
  refreshOutline(doc.pane);
  render();
}

async function createDoc(pane: Pane, path: string | null, content: string, title: string | null = null): Promise<Doc> {
  const docEl = el("div", "doc");
  const noticeEl = el("div", "doc-notice");
  noticeEl.hidden = true;
  const page = el("div", "page");
  const editorEl = el("div", "editor");
  const sourceEl = el("textarea", "source");
  sourceEl.spellcheck = false;
  sourceEl.placeholder = "Start writing…";
  sourceEl.hidden = true;
  page.append(editorEl, sourceEl);
  docEl.append(noticeEl, page);

  const doc: Doc = {
    path,
    title,
    dirty: false,
    mode: "rich",
    crepe: null,
    frontmatter: "",
    baseline: "",
    disk: null,
    conflict: null,
    git: null,
    pane,
    el: docEl,
    noticeEl,
    editorEl,
    sourceEl,
    prefs: prefsFor(path),
    modified: null,
  };
  applyPrefs(doc);
  if (path && inTauri) {
    invoke<number>("modified_at", { path }).then(
      (ms) => {
        doc.modified = ms;
        renderHead(doc.pane);
      },
      () => {},
    );
  }

  docEl.addEventListener("scroll", () => doc.pane.active === doc && doc.pane.outline.sync(), { passive: true });
  anchorScroll(docEl, editorEl);
  sourceEl.addEventListener("input", () => {
    setDirty(doc, true);
    scheduleAutosave(doc);
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
  // The empty pane greets the reader as a welcome until their first note.
  localStorage.setItem("welcomed", "1");
  await mountRich(doc, content);
  activate(doc);
  return doc;
}

async function closeDoc(doc: Doc, confirm = true): Promise<boolean> {
  if (confirm) await autosave(doc);
  if (confirm && doc.conflict) {
    activate(doc);
    if (!(await confirmDiscard(`“${docName(doc)}” changed outside Grimm and your edits weren't saved over it. Close it anyway? Your edits stay in its version history.`, "Close"))) return false;
  }
  snapshot(doc, "edited");
  if (confirm && doc.dirty && !doc.conflict) {
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

async function openPath(
  p: string,
  { otherPane = false, quiet = false, pane: into }: { otherPane?: boolean; quiet?: boolean; pane?: Pane } = {},
) {
  const existing = allDocs().find((d) => d.path === p);
  if (existing) return into && existing.pane !== into ? moveDoc(existing, into) : activate(existing);

  let text: string;
  let hash: string;
  try {
    ({ contents: text, hash } = await invoke<{ contents: string; hash: string }>("open_note", { path: p }));
  } catch (err) {
    recents = recents.filter((r) => r !== p);
    localStorage.setItem("recents", JSON.stringify(recents));
    renderSidebar();
    if (!quiet) toast(`Couldn't open ${basename(p)}: ${err}`);
    return;
  }

  let pane = into && panes.includes(into) ? into : focused;
  if (!into && otherPane) pane = panes.find((candidate) => candidate !== focused) ?? createPane();
  // An untouched "Untitled" tab is replaced rather than left behind.
  const placeholder = pane.active && isPristine(pane.active) ? pane.active : null;
  const doc = await createDoc(pane, p, text);
  doc.disk = hash;
  refreshGit(doc);
  if (placeholder) await closeDoc(placeholder, false);
  rememberRecent(p);
  render();
}

// ---------- guides ----------

// The notes Grimm ships with. They open as unsaved documents, so they can be
// edited freely and are only written to disk if the reader saves them.
const GUIDES = {
  welcome: { title: "Welcome to Grimm", text: welcomeGuide },
  features: { title: "Features", text: featuresGuide },
  help: { title: "Help", text: helpGuide },
  examples: { title: "Examples", text: examplesGuide },
};

async function openGuide(id: keyof typeof GUIDES) {
  const { title, text } = GUIDES[id];
  const existing = allDocs().find((d) => d.title === title);
  if (existing) return activate(existing);
  const pane = focused;
  const placeholder = pane.active && isPristine(pane.active) ? pane.active : null;
  await createDoc(pane, null, text, title);
  if (placeholder) await closeDoc(placeholder, false);
  render();
}

const START_ACTIONS = {
  tour: openTour,
  openFolder: openFolderDialog,
  openFile: openDialog,
  write: () => newDocument(),
};

/**
 * An empty pane shows the ways in, with the files opened most recently below
 * them. The first time Grimm runs, this is the welcome.
 */
function renderStart(pane: Pane) {
  const empty = !pane.docs.length;
  pane.startEl.hidden = !empty;
  if (!empty) return void pane.startEl.replaceChildren();
  const first = !localStorage.getItem("welcomed");
  const head = first
    ? startHead("Welcome to Grimm", "A quiet place to write Markdown. Your notes stay plain <code>.md</code> files on your own disk.")
    : startHead("Nothing open", "Start a note, or open one you already have.");
  const column = el("div", "start-column");
  column.append(head, startPanel(START_ACTIONS));
  const recent = recents.slice(0, 5);
  if (recent.length && !first) {
    const list = el("ul", "start-recents");
    for (const p of recent) {
      const item = el("li");
      const button = el("button");
      button.append(icon(FileText), Object.assign(el("span", "name"), { textContent: basename(p) }), Object.assign(el("span", "where"), { textContent: tildify(dirname(p)) }));
      button.addEventListener("click", () => openPath(p, { pane }));
      item.append(button);
      list.append(item);
    }
    column.append(Object.assign(el("h2", "start-label"), { textContent: "Recent" }), list);
  }
  pane.startEl.replaceChildren(column);
}

/** The welcome screen over the whole window, from the Help menu. */
function showWelcomeScreen() {
  showOnboarding(START_ACTIONS);
}

/** The welcome note with the feature list beside it. */
async function openTour() {
  await openGuide("features");
  await openGuide("welcome");
  const pane = focused;
  const first = pane.docs.find((d) => d.title === GUIDES.welcome.title);
  // Welcome first in the tab bar, and the one on screen.
  if (first) {
    pane.docs.splice(pane.docs.indexOf(first), 1);
    pane.docs.unshift(first);
    activate(first);
  }
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

// ---------- autosave ----------

// A note that lives in a file is written back shortly after the typing stops.
// New notes have nowhere to go until they are saved once by hand.
const AUTOSAVE_DELAY = 1200;
// A longer pause in the writing keeps a version in the note's history. While
// the typing goes on, the backend keeps one every few minutes as it saves.
const PAUSE_DELAY = 30_000;
const autosaveTimers = new WeakMap<Doc, number>();
const pauseTimers = new WeakMap<Doc, number>();
let autosaveFailed = false;

function scheduleAutosave(doc: Doc) {
  if (!doc.path || !inTauri) return;
  window.clearTimeout(autosaveTimers.get(doc));
  window.clearTimeout(pauseTimers.get(doc));
  pauseTimers.set(doc, window.setTimeout(() => snapshot(doc, "edited"), PAUSE_DELAY));
  // A newer file from outside is waiting on a choice; nothing is written until then.
  if (doc.conflict) return;
  autosaveTimers.set(doc, window.setTimeout(() => autosave(doc), AUTOSAVE_DELAY));
}

/** Keeps the note's current text as a version in its history. */
function snapshot(doc: Doc, reason: Reason) {
  window.clearTimeout(pauseTimers.get(doc));
  if (!doc.path || !inTauri) return;
  invoke("snapshot_note", { path: doc.path, contents: getContent(doc), reason }).catch(() => {});
}

/** Writes a changed note to its file now. Does nothing for a note with no file yet. */
async function autosave(doc: Doc) {
  window.clearTimeout(autosaveTimers.get(doc));
  if (!doc.path || !doc.dirty || doc.conflict || !inTauri) return;
  const contents = getContent(doc);
  try {
    doc.disk = await invoke<string>("write_file", { path: doc.path, contents, base: doc.disk });
  } catch (err) {
    // The file changed outside Grimm; a "file-changed" event brings the new text.
    if (err === "changed-on-disk") return;
    // Say so once, not on every keystroke; the dot on the tab stays until a save works.
    if (!autosaveFailed) toast(`Couldn't save ${docName(doc)}: ${err}`);
    autosaveFailed = true;
    return;
  }
  autosaveFailed = false;
  doc.modified = Date.now();
  refreshGit(doc, GIT_DELAY);
  // More was typed while the file was being written: that needs its own save.
  if (getContent(doc) !== contents) return scheduleAutosave(doc);
  if (doc.mode === "rich" && doc.crepe) doc.baseline = doc.crepe.getMarkdown();
  setDirty(doc, false);
}

// Leaving the window is a good moment to make sure everything is on disk.
window.addEventListener("blur", () => allDocs().forEach(autosave));
// A commit may have been made elsewhere meanwhile.
window.addEventListener("focus", () => allDocs().forEach((doc) => refreshGit(doc)));

async function saveDocument(doc: Doc | null, saveAs = false) {
  if (!doc) return;
  if (!inTauri) return toast("Saving needs the desktop app");
  let target = doc.path;
  if (!target || saveAs) {
    const picked = await save({
      defaultPath: doc.path ?? `${folders[0] ? `${folders[0]}/` : ""}${doc.title ?? "Untitled"}.md`,
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (!picked) return;
    target = picked;
  }
  const sameFile = target === doc.path;
  // A copy under a new name starts with the history of the note it came from.
  if (doc.path && !sameFile) await invoke("copy_history", { from: doc.path, to: target });
  try {
    // A file picked in the save dialog has been agreed to be replaced.
    const base = sameFile ? doc.disk : null;
    doc.disk = await invoke<string>("write_file", { path: target, contents: getContent(doc), base });
  } catch (err) {
    if (err !== "changed-on-disk") toast(`Couldn't save: ${err}`);
    return;
  }
  window.clearTimeout(autosaveTimers.get(doc));
  doc.conflict = null;
  renderNotice(doc);
  doc.path = target;
  doc.title = null;
  doc.dirty = false;
  doc.modified = Date.now();
  storePrefs(doc);
  if (doc.mode === "rich" && doc.crepe) doc.baseline = doc.crepe.getMarkdown();
  rememberRecent(target);
  render();
  if (folderOf(target)) await refreshFolders();
  toast("Saved");
}

// ---------- outside changes ----------

let watchedPaths = "";

/** Tells the backend which files to watch for changes made outside Grimm. */
function watchOpenNotes() {
  if (!inTauri) return;
  const paths = [...new Set(allDocs().flatMap((d) => (d.path ? [d.path] : [])))];
  if (paths.join("\n") === watchedPaths) return;
  watchedPaths = paths.join("\n");
  invoke("watch_notes", { paths }).catch(() => {});
}

/** Swaps the text in a note's editor for new text that is already on disk. */
async function replaceContent(doc: Doc, text: string) {
  window.clearTimeout(autosaveTimers.get(doc));
  const scroll = doc.el.scrollTop;
  if (doc.mode === "source") {
    doc.sourceEl.value = text;
    autosizeSource(doc);
  } else {
    await mountRich(doc, text);
  }
  doc.el.scrollTop = scroll;
  // The new editor may report its first render as an edit; it is not one.
  window.clearTimeout(autosaveTimers.get(doc));
  setDirty(doc, false);
  if (doc.pane.active === doc) refreshOutline(doc.pane);
  if (focused.active === doc) renderStats();
}

function renderNotice(doc: Doc) {
  const conflict = doc.conflict;
  doc.noticeEl.hidden = !conflict;
  if (!conflict) return void doc.noticeEl.replaceChildren();
  const text = el("p");
  text.textContent = "This note was changed outside Grimm while you were editing it.";
  const keep = el("button", "share-secondary");
  keep.textContent = "Keep mine";
  keep.title = "Save your edits over it. The other version stays in the note's history.";
  keep.addEventListener("click", () => {
    doc.disk = conflict.hash;
    doc.conflict = null;
    renderNotice(doc);
    autosave(doc);
  });
  const reload = el("button", "share-primary");
  reload.textContent = "Use the newer file";
  reload.title = "Your edits stay in the note's history.";
  reload.addEventListener("click", async () => {
    if (doc.path) await invoke("snapshot_note", { path: doc.path, contents: getContent(doc), reason: "replaced" });
    doc.disk = conflict.hash;
    doc.conflict = null;
    renderNotice(doc);
    await replaceContent(doc, conflict.contents);
  });
  doc.noticeEl.replaceChildren(text, keep, reload);
}

/**
 * A note's file was changed by something else. With nothing unsaved the new
 * text simply replaces the old; otherwise saving stops until the reader picks one.
 */
async function outsideChange(change: { path: string; contents: string; hash: string }) {
  const doc = allDocs().find((d) => d.path === change.path);
  if (!doc) return;
  if (change.contents === getContent(doc)) {
    doc.disk = change.hash;
    doc.conflict = null;
    renderNotice(doc);
    return setDirty(doc, false);
  }
  if (!doc.dirty) {
    doc.disk = change.hash;
    return replaceContent(doc, change.contents);
  }
  window.clearTimeout(autosaveTimers.get(doc));
  doc.conflict = { contents: change.contents, hash: change.hash };
  renderNotice(doc);
}

/** A note open in Grimm was renamed or moved in Finder; its tab follows. */
function outsideRename({ from, to }: { from: string; to: string }) {
  const doc = allDocs().find((d) => d.path === from);
  if (!doc) return;
  doc.path = to;
  // Its star, settings and shared link come along, as with a rename in Grimm.
  favorites = remapList(favorites, from, to);
  localStorage.setItem("favorites", JSON.stringify(favorites));
  recents = remapList(recents, from, to);
  localStorage.setItem("recents", JSON.stringify(recents));
  if (notePrefs[from]) {
    notePrefs[to] = notePrefs[from];
    delete notePrefs[from];
    localStorage.setItem("notePrefs", JSON.stringify(notePrefs));
  }
  moveShare(from, to);
  refreshGit(doc);
  render();
  refreshFolders();
}

// ---------- git ----------

interface GitInfo {
  root: string;
  branch: string | null;
  /** The note's files that differ from the last commit. */
  changed: string[];
}

// After a save, git is asked again once the writing has settled a little.
const GIT_DELAY = 1500;
const gitTimers = new WeakMap<Doc, number>();
let commitDoc: Doc | null = null;
let commitMessage = "";
let commitBusy = false;

/** What committing a note covers: the note, and the images on disk that it shows. */
function noteFiles(doc: Doc): string[] {
  if (!doc.path) return [];
  const dir = dirOf(doc.path);
  return [doc.path, ...localImageRefs(getContent(doc)).map((src) => resolveRelative(dir, src))];
}

async function gitInfo(doc: Doc): Promise<GitInfo | null> {
  if (!doc.path || !inTauri) return null;
  return invoke<GitInfo | null>("git_info", { note: doc.path, files: noteFiles(doc) }).catch(() => null);
}

/** Looks again at whether a note is in a git repository and what of it is uncommitted. */
function refreshGit(doc: Doc, delay = 0) {
  if (!inTauri) return;
  window.clearTimeout(gitTimers.get(doc));
  const timer = window.setTimeout(async () => {
    const path = doc.path;
    const git = await gitInfo(doc);
    if (doc.path !== path || JSON.stringify(git) === JSON.stringify(doc.git)) return;
    doc.git = git;
    if (doc.pane.active === doc) renderHead(doc.pane);
    if (commitDoc === doc && !commitMenu.hidden && !commitBusy) renderCommitMenu();
  }, delay);
  gitTimers.set(doc, timer);
}

function commitButton(doc: Doc): HTMLElement {
  const changes = Boolean(doc.git?.changed.length) || doc.dirty;
  const button = el("button", "head-btn commit-btn");
  button.classList.toggle("on", changes);
  button.title = changes ? "Commit this note (⌥⌘K)" : "No changes since the last commit";
  button.append(icon(GitCommitHorizontal), Object.assign(el("span"), { textContent: "Commit" }));
  button.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleCommit(doc, button);
  });
  return button;
}

function renderCommitMenu(error = "") {
  const doc = commitDoc;
  if (!doc?.path || !doc.git) return;
  const { root, branch, changed } = doc.git;
  const head = el("div", "share-head");
  head.append(Object.assign(el("span", "share-title"), { textContent: "Commit" }));
  if (branch) head.append(Object.assign(el("span", "commit-branch"), { textContent: branch, title: "Branch" }));
  const intro = el("p", "share-intro");
  intro.textContent = `Saves this note and its images to the git repository “${basename(root)}”. Nothing is pushed.`;
  const children: HTMLElement[] = [head, intro];

  // An edit not yet on disk is saved as the commit starts.
  const files = doc.dirty || changed.includes(doc.path) ? [doc.path, ...changed.filter((f) => f !== doc.path)] : changed;
  if (doc.conflict) {
    children.push(Object.assign(el("p", "share-error"), { textContent: "This note changed outside Grimm. Choose which version to keep first." }));
  } else if (!files.length) {
    children.push(Object.assign(el("p", "commit-clean"), { textContent: "No changes since the last commit." }));
  } else {
    const list = el("ul", "commit-files");
    for (const file of files) {
      const row = el("li");
      row.title = file;
      row.append(icon(file === doc.path ? FileText : ImageIcon), Object.assign(el("span"), { textContent: file.slice(root.length + 1) }));
      list.append(row);
    }
    const message = el("textarea", "commit-message");
    message.rows = 2;
    message.value = commitMessage;
    message.placeholder = "What changed?";
    message.disabled = commitBusy;
    message.addEventListener("input", () => (commitMessage = message.value));
    message.addEventListener("keydown", (e) => {
      // Enter commits; Shift-Enter starts a new line of the message.
      if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
      e.preventDefault();
      runCommit();
    });
    children.push(list, message);
    if (error) children.push(Object.assign(el("p", "share-error"), { textContent: error }));
    const actions = el("div", "share-actions");
    const commit = shareButton(commitBusy ? "Committing…" : "Commit", "share-primary", runCommit);
    commit.disabled = commitBusy || !commitMessage.trim();
    message.addEventListener("input", () => (commit.disabled = !commitMessage.trim()));
    const cancel = shareButton("Cancel", "share-secondary", () => (commitMenu.hidden = true));
    cancel.disabled = commitBusy;
    actions.append(cancel, commit);
    children.push(actions);
  }
  commitMenu.replaceChildren(...children);
}

async function toggleCommit(doc: Doc, anchor?: HTMLElement) {
  if (!commitMenu.hidden && commitDoc === doc) return void (commitMenu.hidden = true);
  if (!inTauri) return toast("Committing needs the desktop app");
  if (!doc.path) return toast("Save this note first");
  appearanceMenu.hidden = shareMenu.hidden = true;
  closePageMenu();
  window.clearTimeout(gitTimers.get(doc));
  doc.git = await gitInfo(doc);
  if (doc.pane.active === doc) renderHead(doc.pane);
  if (!doc.git) return toast(`“${displayName(doc)}” isn't in a git repository`);
  commitDoc = doc;
  commitMessage = `Update ${displayName(doc)}`;
  renderCommitMenu();
  commitMenu.hidden = false;
  // The header was drawn again above, so the button that was clicked may be gone.
  const target = anchor?.isConnected ? anchor : doc.pane.headEl.querySelector<HTMLElement>(".commit-btn");
  const rect = target?.getBoundingClientRect() ?? new DOMRect(window.innerWidth - 16, 40, 0, 0);
  commitMenu.style.top = `${rect.bottom + 6}px`;
  commitMenu.style.left = `${Math.max(8, rect.right - commitMenu.offsetWidth)}px`;
  const message = commitMenu.querySelector<HTMLTextAreaElement>(".commit-message");
  message?.focus();
  message?.select();
}

async function runCommit() {
  const doc = commitDoc;
  if (!doc?.path || !doc.git || commitBusy || !commitMessage.trim()) return;
  commitBusy = true;
  renderCommitMenu();
  let error = "";
  try {
    // The commit takes what is on disk, so the latest edits go there first.
    await autosave(doc);
    if (doc.dirty || doc.conflict) throw "the note couldn't be saved first";
    const hash = await invoke<string>("git_commit", { note: doc.path, files: noteFiles(doc), message: commitMessage });
    commitMenu.hidden = true;
    toast(`Committed to ${doc.git.branch ?? "the repository"} · ${hash}`);
  } catch (err) {
    const text = String(err);
    error = text.charAt(0).toUpperCase() + text.slice(1);
  }
  commitBusy = false;
  refreshGit(doc);
  if (error) renderCommitMenu(error);
}

// ---------- version history ----------

async function showHistory(doc: Doc | null) {
  if (!doc) return;
  if (!inTauri) return toast("Version history needs the desktop app");
  if (!doc.path) return toast("Version history starts once this note is saved");
  appearanceMenu.hidden = shareMenu.hidden = true;
  await openHistory({
    name: docName(doc),
    path: doc.path,
    current: getContent(doc),
    restore: async (hash, text, time) => {
      if (!doc.path) return false;
      try {
        doc.disk = await invoke<string>("restore_version", { path: doc.path, current: getContent(doc), hash });
      } catch (err) {
        toast(`Couldn't restore that version: ${err}`);
        return false;
      }
      doc.conflict = null;
      renderNotice(doc);
      activate(doc);
      await replaceContent(doc, text);
      const when = new Date(time).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
      toast(`Restored the version from ${when}. The text it replaced is in the history.`, 4000);
      return true;
    },
  });
}

// ---------- sidebar ----------

/** Lists each open folder's Markdown files again; a folder that has gone is closed. */
async function refreshFolders() {
  if (!inTauri) return renderSidebar();
  const gone: string[] = [];
  await Promise.all(
    folders.map(async (dir) => {
      try {
        folderFiles.set(dir, await invoke<string[]>("list_markdown_files", { dir }));
      } catch {
        gone.push(dir);
      }
    }),
  );
  if (gone.length) {
    folders = folders.filter((f) => !gone.includes(f));
    saveFolders();
  }
  renderSidebar();
}

async function openFolderDialog() {
  if (!inTauri) return toast("Opening folders needs the desktop app");
  const picked = await open({ directory: true, multiple: true });
  const paths = typeof picked === "string" ? [picked] : (picked ?? []);
  if (!paths.length) return;
  for (const dir of paths) {
    if (!folders.includes(dir)) folders.push(dir);
    openDirs.add(dir);
  }
  saveFolders();
  await refreshFolders();
}

function closeFolder(dir: string) {
  folders = folders.filter((f) => f !== dir);
  folderFiles.delete(dir);
  for (const open of [...openDirs]) if (open === dir || open.startsWith(`${dir}/`)) openDirs.delete(open);
  saveFolders();
  renderSidebar();
}

function toggleDir(dir: string) {
  if (!openDirs.delete(dir)) openDirs.add(dir);
  saveFolders();
  renderSidebar();
}

/** Picks a place and a name, makes the folder there and opens it in the sidebar. */
async function newFolderDialog() {
  if (!inTauri) return toast("Creating folders needs the desktop app");
  const picked = await save({ title: "New folder", defaultPath: `${folders[0] ? `${dirname(folders[0])}/` : ""}Untitled folder` });
  if (!picked) return;
  try {
    await invoke("create_dir", { path: picked });
  } catch (err) {
    return toast(`Couldn't create the folder: ${err}`);
  }
  if (!folders.includes(picked)) folders.push(picked);
  openDirs.add(picked);
  saveFolders();
  await refreshFolders();
}

/** Makes "Untitled.md" (or "Untitled 2.md", …) in a folder and opens it. */
async function newNoteIn(dir: string) {
  if (!inTauri) return newDocument();
  let target = `${dir}/Untitled.md`;
  for (let n = 2; await invoke<boolean>("file_exists", { path: target }); n++) target = `${dir}/Untitled ${n}.md`;
  try {
    await invoke("write_file", { path: target, contents: "" });
  } catch (err) {
    return toast(`Couldn't create the note: ${err}`);
  }
  openDirs.add(dir);
  saveFolders();
  await openPath(target);
  await refreshFolders();
}

function toggleFavorite(path: string) {
  favorites = favorites.includes(path) ? favorites.filter((p) => p !== path) : [...favorites, path];
  localStorage.setItem("favorites", JSON.stringify(favorites));
  renderSidebar();
  panes.forEach(renderHead);
}

// ---------- renaming and moving ----------

/**
 * Renames or moves a note on disk, and everything Grimm remembers by its path
 * goes with it: the open tab, favorites, recents, the note's own settings and
 * its shared link. A note that changes folder takes its images along: each is
 * copied into the new folder's assets and the links rewritten.
 */
async function relocate(from: string, to: string): Promise<boolean> {
  if (from === to) return true;
  if (!inTauri) {
    toast("Renaming and moving notes needs the desktop app");
    return false;
  }
  const doc = allDocs().find((d) => d.path === from);
  if (doc) {
    // Written first, and no autosave may land on the old path meanwhile.
    await autosave(doc);
    window.clearTimeout(autosaveTimers.get(doc));
    if (doc.dirty) {
      toast("Couldn't save the note first, so it was left where it is");
      return false;
    }
  }

  let rewritten: string | null = null;
  // Images resolve against the note's folder, so after a move the editor shows
  // them afresh even when no link had to change.
  let reload: string | null = null;
  if (dirOf(from) !== dirOf(to)) {
    // Refused up front, so no images are copied for a move that can't happen.
    if (await invoke<boolean>("file_exists", { path: to })) {
      toast(`“${basename(to)}” already exists there`);
      return false;
    }
    // From disk, which the save above brought up to date: the file keeps its own
    // formatting rather than the editor's.
    const markdown = await invoke<string>("read_file", { path: from });
    const map: Record<string, string> = {};
    for (const src of localImageRefs(markdown)) {
      try {
        map[src] = await invoke<string>("copy_image", { note: to, source: resolveRelative(dirOf(from), src) });
      } catch {
        // Missing, or not an image: its link is left as it was.
      }
    }
    const next = rewriteImageRefs(markdown, map);
    if (next !== markdown) rewritten = next;
    if (Object.keys(map).length) reload = markdown;
  }

  try {
    await invoke("rename_path", { from, to });
  } catch (err) {
    toast(`Couldn't ${dirOf(from) === dirOf(to) ? "rename" : "move"} the note: ${err}`);
    return false;
  }
  if (rewritten !== null) {
    try {
      const written = await invoke<string>("write_file", { path: to, contents: rewritten });
      if (doc) doc.disk = written;
    } catch (err) {
      toast(`Moved, but its image links couldn't be updated: ${err}`, 6000);
      rewritten = null;
    }
  }

  favorites = remapList(favorites, from, to);
  localStorage.setItem("favorites", JSON.stringify(favorites));
  recents = remapList(recents, from, to);
  localStorage.setItem("recents", JSON.stringify(recents));
  if (notePrefs[from]) {
    notePrefs[to] = notePrefs[from];
    delete notePrefs[from];
    localStorage.setItem("notePrefs", JSON.stringify(notePrefs));
  }
  moveShare(from, to);

  if (doc) {
    doc.path = to;
    refreshGit(doc);
    doc.title = null;
    doc.modified = Date.now();
    const content = rewritten ?? reload;
    if (content !== null) {
      if (doc.mode === "rich") await mountRich(doc, content);
      else doc.sourceEl.value = content;
    }
  }
  render();
  await refreshFolders();
  return true;
}

async function renameNote(path: string, name: string) {
  const problem = nameProblem(name);
  if (problem) return toast(problem);
  await relocate(path, renamedPath(path, name));
}

async function moveNote(path: string, dir: string) {
  const to = movedPath(path, dir);
  if (to === path) return;
  if (await relocate(path, to)) {
    openDirs.add(dir);
    saveFolders();
    renderSidebar();
    toast(`Moved to ${basename(dir)}`);
  }
}

/** Swaps a label for a text field to rename what it names; Enter or leaving it renames, Escape cancels. */
function editInPlace(label: HTMLElement, current: string, commit: (name: string) => unknown) {
  const input = el("input", "rename-input");
  input.value = current;
  input.spellcheck = false;
  let done = false;
  const finish = (save: boolean) => {
    if (done) return;
    done = true;
    input.replaceWith(label);
    const name = input.value.trim();
    if (save && name && name !== current) commit(name);
  };
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") finish(true);
    else if (e.key === "Escape") finish(false);
  });
  input.addEventListener("blur", () => finish(true));
  for (const type of ["click", "pointerdown", "dblclick"]) input.addEventListener(type, (e) => e.stopPropagation());
  label.replaceWith(input);
  input.focus();
  input.select();
}

/** Renames an open note from its header: a saved note on disk, an unsaved one just on its tab. */
function renameDoc(doc: Doc) {
  const label = doc.pane.headEl.querySelector<HTMLElement>(".crumb:last-of-type");
  if (!label) return;
  editInPlace(label, displayName(doc), (name) => {
    if (doc.path) return renameNote(doc.path, name);
    const problem = nameProblem(name);
    if (problem) return toast(problem);
    doc.title = name;
    render();
  });
}

/** Renames a note from its sidebar row. */
function renameRow(li: HTMLElement, path: string) {
  const label = li.querySelector<HTMLElement>(".name");
  if (label) editInPlace(label, stripExtension(basename(path)), (name) => renameNote(path, name));
}

/** The open folders and their subfolders, as places a note can move to. */
function moveTargets(exclude: string): { dir: string; label: string }[] {
  const out: { dir: string; label: string }[] = [];
  const walk = (node: DirNode, trail: string[]) => {
    const label = [...trail, basename(node.path)];
    if (node.path !== exclude) out.push({ dir: node.path, label: label.join(" / ") });
    for (const sub of [...node.dirs.values()].sort((a, b) => a.path.localeCompare(b.path))) walk(sub, label);
  };
  for (const dir of folders) walk(dirTree(dir, folderFiles.get(dir) ?? []), []);
  return out.slice(0, 40);
}

function openMoveMenu(path: string, anchor: HTMLElement) {
  const items: MenuItem[] = moveTargets(dirOf(path)).map(({ dir, label }) => ({
    label,
    icon: Folder,
    run: () => moveNote(path, dir),
  }));
  items.push({
    label: "Choose a folder…",
    icon: FolderOpen,
    run: async () => {
      if (!inTauri) return toast("Moving notes needs the desktop app");
      const picked = await open({ directory: true, multiple: false, defaultPath: dirOf(path) });
      if (typeof picked === "string") await moveNote(path, picked);
    },
  });
  openRowMenu(anchor, items);
}

/** The "…" on a note's sidebar row. */
function noteRowMenu(li: HTMLElement, path: string, anchor: HTMLElement) {
  const starred = favorites.includes(path);
  openRowMenu(anchor, [
    { label: "Rename", icon: PenLine, run: () => renameRow(li, path) },
    { label: "Move to…", icon: FolderInput, run: () => setTimeout(() => openMoveMenu(path, anchor)) },
    { label: starred ? "Remove from Favorites" : "Add to Favorites", icon: Star, run: () => toggleFavorite(path) },
    ...(inTauri ? [{ label: "Show in Finder", icon: FolderOpen, run: () => revealItemInDir(path) }] : []),
  ]);
}

// ---------- row menus ----------

// The small menu behind a sidebar row's "…" (and the Folders "+").
const rowMenu = document.body.appendChild(el("div", "page-menu row-menu"));
rowMenu.hidden = true;

function openRowMenu(anchor: HTMLElement, items: MenuItem[]) {
  rowMenu.replaceChildren(...items.map((item) => menuRow(item, () => (rowMenu.hidden = true))));
  rowMenu.hidden = false;
  const rect = anchor.getBoundingClientRect();
  const top = rect.bottom + 4 + rowMenu.offsetHeight > window.innerHeight ? rect.top - rowMenu.offsetHeight - 4 : rect.bottom + 4;
  rowMenu.style.top = `${Math.max(8, top)}px`;
  rowMenu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - rowMenu.offsetWidth - 8))}px`;
}

function rowAction(node: IconNode, title: string, onClick: (anchor: HTMLElement) => void) {
  const button = iconButton(node, title, (e) => {
    e.stopPropagation();
    onClick(e.currentTarget as HTMLElement);
  }, "icon-btn small row-action");
  // Pressing an action must not start a file drag or toggle the row.
  button.addEventListener("pointerdown", (e) => e.stopPropagation());
  return button;
}

function fileItem(p: string, detail: string, openPaths: Set<string>, depth = 0): HTMLLIElement {
  const li = el("li");
  li.style.setProperty("--depth", String(depth));
  li.title = `${p}\n⌘-click to open in the other pane`;
  li.classList.toggle("open", openPaths.has(p));
  li.classList.toggle("current", focused.active?.path === p);
  const name = el("span", "name");
  name.textContent = stripExtension(basename(p));
  li.append(icon(FileText), name);
  if (detail) {
    const dir = el("span", "dir");
    dir.textContent = detail;
    li.append(dir);
  }
  const actions = el("span", "row-actions");
  actions.append(rowAction(Ellipsis, "Rename, move and more", (anchor) => noteRowMenu(li, p, anchor)));
  li.append(actions);
  li.addEventListener("click", (e) => fileDragged || openPath(p, { otherPane: e.metaKey || e.ctrlKey }));
  li.addEventListener("pointerdown", (e) => startFileDrag(e, p));
  return li;
}

// Set while a press on a file turned into a drag, so the click that ends it is ignored.
let fileDragged = false;

/** Dragging a file out of the sidebar opens it in the pane it is dropped on. */
function startFileDrag(down: PointerEvent, path: string) {
  fileDragged = false;
  if (down.button !== 0) return;
  const ghost = el("div", "drag-ghost");
  ghost.textContent = basename(path);
  let target: Pane | null = null;
  // A folder row under the pointer: dropping there moves the note into it.
  let folderTarget: HTMLElement | null = null;

  const mark = (pane: Pane | null) => {
    target = pane;
    for (const p of panes) p.el.classList.toggle("drop-target", p === pane);
  };
  const markFolder = (row: HTMLElement | null) => {
    folderTarget?.classList.remove("drop-into");
    folderTarget = row && row.dataset.dir !== dirOf(path) ? row : null;
    folderTarget?.classList.add("drop-into");
  };
  const move = (e: PointerEvent) => {
    if (!fileDragged) {
      if (Math.hypot(e.clientX - down.clientX, e.clientY - down.clientY) < TAB_DRAG_THRESHOLD) return;
      fileDragged = true;
      document.body.classList.add("dragging-tab");
      document.body.append(ghost);
    }
    ghost.style.transform = `translate(${e.clientX + 12}px, ${e.clientY + 14}px)`;
    markFolder(document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>(".dir-row[data-dir]") ?? null);
    mark(
      panes.find((p) => {
        const r = p.el.getBoundingClientRect();
        return e.clientX >= r.left && e.clientX < r.right && e.clientY >= r.top && e.clientY < r.bottom;
      }) ?? null,
    );
  };
  const stop = (drop: boolean) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cancel);
    window.removeEventListener("keydown", key, true);
    if (!fileDragged) return;
    const pane = target;
    const into = folderTarget?.dataset.dir;
    mark(null);
    markFolder(null);
    document.body.classList.remove("dragging-tab");
    ghost.remove();
    if (drop && into) moveNote(path, into);
    else if (drop && pane) openPath(path, { pane });
  };
  const up = () => stop(true);
  const cancel = () => stop(false);
  const key = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    stop(false);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cancel);
  window.addEventListener("keydown", key, true);
}

const RECENTS_SHOWN = 6;
let showAllRecents = false;

interface DirNode {
  path: string;
  dirs: Map<string, DirNode>;
  files: string[];
}

/** An open folder's files as a tree of subfolders. */
function dirTree(root: string, files: string[]): DirNode {
  const top: DirNode = { path: root, dirs: new Map(), files: [] };
  for (const file of files) {
    let node = top;
    for (const part of dirname(file).slice(root.length).split(/[\\/]/).filter(Boolean)) {
      let next = node.dirs.get(part);
      if (!next) node.dirs.set(part, (next = { path: `${node.path}/${part}`, dirs: new Map(), files: [] }));
      node = next;
    }
    node.files.push(file);
  }
  return top;
}

/** A folder row: its icon turns into a fold chevron on hover; + and … sit at the right. */
function dirRow(node: DirNode, depth: number, openPaths: Set<string>, top: boolean): HTMLElement[] {
  const open = openDirs.has(node.path);
  const li = el("li", "dir-row");
  li.dataset.dir = node.path;
  li.style.setProperty("--depth", String(depth));
  li.classList.toggle("expanded", open);
  li.title = tildify(node.path);
  const glyph = el("span", "row-glyph");
  glyph.append(icon(Folder), icon(ChevronRight));
  const name = Object.assign(el("span", "name"), { textContent: basename(node.path) });
  const menu: MenuItem[] = [{ label: "New note", icon: SquarePen, run: () => newNoteIn(node.path) }];
  if (inTauri) menu.push({ label: "Show in Finder", icon: FolderOpen, run: () => revealItemInDir(node.path) });
  if (top) menu.push({ label: "Remove from sidebar", icon: X, run: () => closeFolder(node.path) });
  const actions = el("span", "row-actions");
  actions.append(
    rowAction(Plus, "New note in this folder", () => newNoteIn(node.path)),
    rowAction(Ellipsis, "More", (anchor) => openRowMenu(anchor, menu)),
  );
  li.append(glyph, name, actions);
  li.addEventListener("click", () => toggleDir(node.path));

  const rows: HTMLElement[] = [li];
  if (!open) return rows;
  const subdirs = [...node.dirs.values()].sort((a, b) => basename(a.path).localeCompare(basename(b.path)));
  for (const sub of subdirs) rows.push(...dirRow(sub, depth + 1, openPaths, false));
  for (const file of node.files) rows.push(fileItem(file, "", openPaths, depth + 1));
  if (top && !subdirs.length && !node.files.length) {
    const empty = Object.assign(el("li", "empty"), { textContent: "No notes yet" });
    empty.style.setProperty("--depth", String(depth + 1));
    rows.push(empty);
  }
  return rows;
}

/** A sidebar section whose header folds it; `extra` goes at the header's right. */
function sideSection(id: string, title: string, rows: HTMLElement[], extra: HTMLElement[] = [], forceOpen = false): HTMLElement {
  const collapsed = collapsedSections.has(id) && !forceOpen;
  const section = el("section", "side-section");
  section.classList.toggle("collapsed", collapsed);
  const header = el("header");
  const fold = el("button", "section-fold");
  fold.append(Object.assign(el("h2"), { textContent: title }), icon(ChevronDown));
  fold.title = collapsed ? `Show ${title.toLowerCase()}` : `Hide ${title.toLowerCase()}`;
  fold.addEventListener("click", () => {
    if (!collapsedSections.delete(id)) collapsedSections.add(id);
    localStorage.setItem("collapsedSections", JSON.stringify([...collapsedSections]));
    renderSidebar();
  });
  header.append(fold, ...extra);
  section.append(header);
  if (!collapsed) {
    const list = el("ul", "file-list");
    list.append(...rows);
    section.append(list);
  }
  return section;
}

function renderSidebar() {
  if (sidebarEl.contains(document.activeElement) && document.activeElement?.matches(".rename-input")) return;
  const openPaths = new Set(allDocs().flatMap((d) => (d.path ? [d.path] : [])));
  const query = sideSearch.value.trim().toLowerCase();
  const matches = (p: string) => !query || basename(p).toLowerCase().includes(query);
  const sections: HTMLElement[] = [];

  const favs = favorites.filter(matches);
  if (favs.length) sections.push(sideSection("favorites", "Favorites", favs.map((p) => fileItem(p, "", openPaths)), [], Boolean(query)));

  // While searching, each folder lists its matching notes flat, with their subfolder.
  const folderRows = folders.flatMap((dir) => {
    const files = folderFiles.get(dir) ?? [];
    if (!query) return dirRow(dirTree(dir, files), 0, openPaths, true);
    const found = files.filter(matches);
    if (!found.length) return [];
    const head = Object.assign(el("li", "dir-row expanded search-dir"), { title: tildify(dir) });
    const glyph = el("span", "row-glyph");
    glyph.append(icon(Folder));
    head.append(glyph, Object.assign(el("span", "name"), { textContent: basename(dir) }));
    return [head, ...found.map((p) => fileItem(p, dirname(p).slice(dir.length).replace(/^[\\/]/, ""), openPaths, 1))];
  });
  if (!folders.length && !query) {
    const open = Object.assign(el("li", "empty add-folder"), { textContent: "Open or create a folder" });
    open.addEventListener("click", openFolderDialog);
    folderRows.push(open);
  }
  const addFolder = rowAction(Plus, "Add a folder", (anchor) =>
    openRowMenu(anchor, [
      { label: "Open folder…", icon: FolderOpen, hint: "⇧⌘O", run: openFolderDialog },
      { label: "New folder…", icon: FolderPlus, run: newFolderDialog },
    ]),
  );
  if (folderRows.length || !query) sections.push(sideSection("folders", "Folders", folderRows, [addFolder], Boolean(query)));

  const shared = sharedPages().map((page) => page.path).filter(matches);
  if (shared.length) {
    const rows = shared.map((p) => {
      const li = fileItem(p, "", openPaths);
      li.querySelector(".lucide")?.replaceWith(icon(Globe));
      return li;
    });
    sections.push(sideSection("shared", "Shared", rows, [], Boolean(query)));
  }

  const found = recents.filter(matches);
  if (found.length) {
    const shown = query || showAllRecents ? found : found.slice(0, RECENTS_SHOWN);
    const rows: HTMLElement[] = shown.map((p) => fileItem(p, "", openPaths));
    if (!query && found.length > RECENTS_SHOWN) {
      const more = el("li", "more-row");
      more.append(icon(Ellipsis), Object.assign(el("span", "name"), { textContent: showAllRecents ? "Show less" : "View all" }));
      more.addEventListener("click", () => {
        showAllRecents = !showAllRecents;
        renderSidebar();
      });
      rows.push(more);
    }
    sections.push(sideSection("recents", "Recents", rows, [], Boolean(query)));
  }

  $("side-sections").replaceChildren(...sections);
  $("search-empty").hidden = !query || sections.length > 0;
}

function toggleSidebar() {
  const collapsed = app.classList.toggle("sidebar-collapsed");
  localStorage.setItem("sidebarCollapsed", String(collapsed));
  peekSidebar(false, true);
  panes.forEach(renderBar);
}

// While the sidebar is closed it can be peeked at: it floats over the page
// for as long as the pointer is on the toggle or on the sidebar itself.
let peekTimer = 0;
function peekSidebar(show: boolean, now = false) {
  window.clearTimeout(peekTimer);
  if (show && app.classList.contains("sidebar-collapsed")) return void app.classList.add("sidebar-peek");
  if (now) return void app.classList.remove("sidebar-peek");
  peekTimer = window.setTimeout(() => {
    // A menu opened from the sidebar keeps it out.
    if (!appearanceMenu.hidden || !rowMenu.hidden || sidebarEl.contains(document.activeElement)) return;
    app.classList.remove("sidebar-peek");
  }, 300);
}

// ---------- appearance ----------

function setTheme(next: Theme) {
  theme = next;
  // Cross-fades the whole UI to the new colours where the webview supports it.
  if (document.startViewTransition) {
    // The theme is applied even when the animation itself gets skipped.
    const transition = document.startViewTransition(() => applyTheme(next));
    transition.ready.catch(() => {});
    transition.finished.catch(() => {});
  } else {
    applyTheme(next);
  }
  localStorage.setItem("theme", next.id);
}

function storePrefs(doc: Doc) {
  if (!doc.path) return;
  notePrefs[doc.path] = { ...doc.prefs };
  localStorage.setItem("notePrefs", JSON.stringify(notePrefs));
}

function applyPrefs(doc: Doc) {
  const { font, size, width, locked } = doc.prefs;
  Object.assign(doc.el.dataset, { font, size, width });
  doc.el.classList.toggle("locked", locked);
  doc.sourceEl.readOnly = locked;
  doc.crepe?.setReadonly(locked);
}

function updatePrefs(doc: Doc, patch: Partial<NotePrefs>) {
  Object.assign(doc.prefs, patch);
  applyPrefs(doc);
  storePrefs(doc);
  if (doc.mode === "source") autosizeSource(doc);
  if (doc.pane.active === doc) doc.pane.outline.sync();
  renderHead(doc.pane);
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
    // The theme's accent as a little painted leaf.
    const mark = el("i");
    mark.innerHTML = tinyLeaf(t.accent);
    preview.append(mark);
    const name = el("span", "tile-name");
    name.textContent = t.name;
    tile.append(preview, name);
    tile.addEventListener("click", () => {
      setTheme(t);
      renderAppearance();
    });
    grid.append(tile);
  }

  appearanceMenu.replaceChildren(label("Theme"), grid);
}

function toggleAppearance(anchor: HTMLElement) {
  if (!appearanceMenu.hidden) return void (appearanceMenu.hidden = true);
  shareMenu.hidden = true;
  renderAppearance();
  appearanceMenu.hidden = false;
  const rect = anchor.getBoundingClientRect();
  // Opened from the sidebar's foot, it rises above the button.
  appearanceMenu.style.top = `${Math.max(8, rect.top - appearanceMenu.offsetHeight - 6)}px`;
  appearanceMenu.style.left = `${Math.max(8, rect.left)}px`;
}

// ---------- page menu ----------

// Each note's "…" menu: what can be done to this note, and how it looks.
const pageMenu = document.body.appendChild(el("div", "page-menu"));
pageMenu.hidden = true;
let menuDoc: Doc | null = null;

interface MenuItem {
  label: string;
  icon: IconNode;
  run?: () => void;
  hint?: string;
  toggle?: boolean;
}

function closePageMenu() {
  if (pageMenu.hidden) return;
  pageMenu.hidden = true;
  const doc = menuDoc;
  menuDoc = null;
  if (doc) renderHead(doc.pane);
}

function switchEl(on: boolean) {
  const node = el("span", "switch");
  node.classList.toggle("on", on);
  node.append(el("i"));
  return node;
}

function menuRow(item: MenuItem, close: () => void): HTMLButtonElement {
  const row = el("button", "menu-row");
  row.append(icon(item.icon), Object.assign(el("span", "menu-text"), { textContent: item.label }));
  if (item.hint) row.append(Object.assign(el("span", "menu-hint"), { textContent: item.hint }));
  if (item.toggle !== undefined) row.append(switchEl(item.toggle));
  row.addEventListener("click", (e) => {
    e.stopPropagation();
    item.run?.();
    if (item.toggle === undefined) close();
  });
  return row;
}

function pageMenuItems(doc: Doc): MenuItem[][] {
  const record = doc.path ? shareRecord(doc.path) : null;
  const copy = (text: string, done: string) =>
    navigator.clipboard.writeText(text).then(
      () => toast(done),
      () => toast("Couldn't copy"),
    );
  const actions: MenuItem[] = [];
  if (record) actions.push({ label: "Copy link", icon: Link2, run: () => copy(record.url, "Link copied") });
  if (doc.path) {
    const path = doc.path;
    const starred = favorites.includes(path);
    actions.push({ label: starred ? "Remove from Favorites" : "Add to Favorites", icon: Star, run: () => toggleFavorite(path) });
    actions.push({ label: "Copy file path", icon: ClipboardCopy, run: () => copy(path, "Path copied") });
  }
  actions.push({ label: "Rename", icon: PenLine, run: () => setTimeout(() => renameDoc(doc)) });
  if (doc.path) {
    const path = doc.path;
    const more = doc.pane.headEl.querySelector<HTMLElement>(".more-btn");
    actions.push({ label: "Move to…", icon: FolderInput, run: () => setTimeout(() => more && openMoveMenu(path, more)) });
  }
  actions.push(
    { label: "Copy page contents", icon: Copy, run: () => copy(getContent(doc), "Contents copied") },
    { label: "Duplicate", icon: CopyPlus, run: () => duplicateDoc(doc) },
  );
  if (doc.path && inTauri) actions.push({ label: "Show in Finder", icon: FolderOpen, run: () => revealItemInDir(doc.path!) });
  if (panes.length > 1) {
    actions.push({
      label: "Move to other pane",
      icon: ArrowRightLeft,
      run: () => {
        const target = panes.find((p) => p !== doc.pane);
        if (target) moveDoc(doc, target);
      },
    });
  }

  const look: MenuItem[] = [
    {
      label: "Markdown source",
      icon: Code,
      hint: "⌘/",
      toggle: doc.mode === "source",
      run: () => setMode(doc, doc.mode === "rich" ? "source" : "rich").then(() => renderPageMenu(doc)),
    },
  ];

  const page: MenuItem[] = [
    { label: record ? "Shared to web…" : "Share to web…", icon: record ? Globe : Share, run: () => toggleShare(doc) },
    ...(doc.path ? [{ label: "Version history…", icon: HistoryIcon, hint: "⌥⌘Y", run: () => showHistory(doc) }] : []),
    ...(doc.git ? [{ label: "Commit…", icon: GitCommitHorizontal, hint: "⌥⌘K", run: () => toggleCommit(doc) }] : []),
    {
      label: "Lock page",
      icon: Lock,
      toggle: doc.prefs.locked,
      run: () => {
        updatePrefs(doc, { locked: !doc.prefs.locked });
        renderPageMenu(doc);
      },
    },
  ];
  return [actions, look, page];
}

function renderPageMenu(doc: Doc, filter = "") {
  const search = el("label", "menu-search");
  const input = el("input");
  input.placeholder = "Search actions…";
  input.value = filter;
  search.append(icon(Search), input);
  input.addEventListener("input", () => {
    renderPageMenu(doc, input.value);
    const next = pageMenu.querySelector<HTMLInputElement>(".menu-search input");
    next?.focus();
    next?.setSelectionRange(next.value.length, next.value.length);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    pageMenu.querySelector<HTMLButtonElement>(".menu-row")?.click();
  });

  const children: HTMLElement[] = [search];
  const needle = filter.trim().toLowerCase();
  if ("font text size full width layout appearance".includes(needle) || !needle) children.push(...layoutControls(doc));
  for (const section of pageMenuItems(doc)) {
    const rows = section.filter((item) => item.label.toLowerCase().includes(needle));
    if (!rows.length) continue;
    children.push(el("div", "menu-sep"), ...rows.map((item) => menuRow(item, closePageMenu)));
  }

  if (!needle) {
    const foot = el("div", "menu-foot");
    const lines: string[] = [];
    if (doc.modified) lines.push(editedAt(doc.modified));
    lines.push(wordCount(doc));
    foot.append(Object.assign(el("div", "menu-foot-label"), { textContent: doc.modified ? "Last edited" : "This note" }));
    for (const line of lines) foot.append(Object.assign(el("div"), { textContent: line }));
    children.push(el("div", "menu-sep"), foot);
  }
  pageMenu.replaceChildren(...children);
}

function togglePageMenu(doc: Doc, anchor: HTMLElement) {
  if (!pageMenu.hidden && menuDoc === doc) return closePageMenu();
  appearanceMenu.hidden = shareMenu.hidden = true;
  menuDoc = doc;
  renderPageMenu(doc);
  pageMenu.hidden = false;
  const rect = anchor.getBoundingClientRect();
  pageMenu.style.top = `${rect.bottom + 6}px`;
  pageMenu.style.left = `${Math.max(8, rect.right - pageMenu.offsetWidth)}px`;
  anchor.classList.add("on");
  pageMenu.querySelector<HTMLInputElement>(".menu-search input")?.focus();
}

/** Font, text size and width for one note, at the top of its page menu. */
function layoutControls(doc: Doc): HTMLElement[] {
  const refresh = (patch: Partial<NotePrefs>) => {
    updatePrefs(doc, patch);
    const input = pageMenu.querySelector<HTMLInputElement>(".menu-search input");
    renderPageMenu(doc, input?.value ?? "");
  };

  const fonts = el("div", "font-tiles");
  for (const [id, text] of [["serif", "Serif"], ["sans", "Sans"], ["mono", "Mono"]] as const) {
    const tile = el("button", "font-tile");
    tile.dataset.font = id;
    tile.classList.toggle("selected", doc.prefs.font === id);
    tile.append(Object.assign(el("span", "font-sample"), { textContent: "Ag" }), Object.assign(el("span"), { textContent: text }));
    tile.addEventListener("click", (e) => {
      e.stopPropagation();
      refresh({ font: id });
    });
    fonts.append(tile);
  }

  const sizes = el("div", "font-toggle menu-sizes");
  for (const [id, text] of [["small", "Small"], ["normal", "Normal"], ["large", "Large"]] as const) {
    const button = el("button");
    button.textContent = text;
    button.classList.toggle("selected", doc.prefs.size === id);
    button.addEventListener("click", (e) => {
      e.stopPropagation();
      refresh({ size: id });
    });
    sizes.append(button);
  }

  const full = menuRow(
    {
      label: "Full width",
      icon: Columns2,
      toggle: doc.prefs.width === "full",
      run: () => refresh({ width: doc.prefs.width === "full" ? "centered" : "full" }),
    },
    () => {},
  );

  return [el("div", "menu-sep"), fonts, sizes, full];
}

/** Opens a copy of the note: beside the file as "name copy.md", or as a new unsaved note. */
async function duplicateDoc(doc: Doc) {
  const contents = getContent(doc);
  if (!doc.path || !inTauri) {
    await createDoc(doc.pane, null, contents, `${displayName(doc)} copy`);
    return render();
  }
  const base = doc.path.replace(/\.[^./\\]+$/, "");
  const ext = doc.path.slice(base.length) || ".md";
  let target = `${base} copy${ext}`;
  for (let n = 2; await invoke<boolean>("file_exists", { path: target }); n++) target = `${base} copy ${n}${ext}`;
  try {
    await invoke("write_file", { path: target, contents });
  } catch (err) {
    return toast(`Couldn't duplicate: ${err}`);
  }
  notePrefs[target] = { ...doc.prefs, locked: false };
  localStorage.setItem("notePrefs", JSON.stringify(notePrefs));
  await openPath(target, { pane: doc.pane });
  if (folderOf(target)) await refreshFolders();
}

// ---------- sharing ----------

let shareDoc: Doc | null = null;
let shareBusy: "publish" | "unshare" | null = null;

function shareInput(doc: Doc): ShareInput | null {
  if (!doc.path) return null;
  return {
    path: doc.path,
    markdown: getContent(doc),
    title: docName(doc).replace(/\.[^.]+$/, ""),
    appearance: { theme: theme.id, font: doc.prefs.font, size: doc.prefs.size, width: doc.prefs.width },
  };
}

const shareDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "long" });

function copyLink(url: string) {
  return navigator.clipboard.writeText(url).then(
    () => true,
    () => false,
  );
}

/** Roughly what the shared page will lead with: its title and first line. */
function sharePreview(markdown: string, fallback: string) {
  const plain = (line: string) =>
    line
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/[*_`~]+/g, "")
      .replace(/^\s*(?:[-+*]|\d+\.|>)\s+(?:\[[ xX]\]\s+)?/, "")
      .trim();
  let title = "";
  let line = "";
  let inCode = false;
  for (const raw of markdown.replace(FRONTMATTER, "").split("\n")) {
    if (raw.trimStart().startsWith("```")) inCode = !inCode;
    if (inCode || !raw.trim() || /^\s*(?:---|\*\*\*|___)\s*$/.test(raw) || /^\s*https?:\/\/\S+\s*$/.test(raw)) continue;
    const heading = raw.match(/^#{1,6}\s+(.*)/);
    if (heading && !title) title = plain(heading[1]);
    else if (!heading && !line) line = plain(raw);
    if (title && line) break;
  }
  return { title: title || fallback, line };
}

function shareRow(node: IconNode, label: string, detail = "", onClick?: () => void) {
  const row = el(onClick ? "button" : "div", "share-row");
  const text = el("span", "share-row-label");
  text.textContent = label;
  row.append(icon(node), text);
  if (detail) {
    const extra = el("span", "share-row-detail");
    extra.textContent = detail;
    row.append(extra);
  }
  if (onClick && row instanceof HTMLButtonElement) {
    row.disabled = Boolean(shareBusy);
    row.addEventListener("click", onClick);
  }
  return row;
}

function shareButton(label: string, className: string, onClick: () => void) {
  const button = el("button", className);
  button.textContent = label;
  button.disabled = Boolean(shareBusy);
  button.addEventListener("click", onClick);
  return button;
}

async function renderShareMenu(error = "") {
  const doc = shareDoc;
  if (!doc) return;
  const input = shareInput(doc);
  const record = input && shareRecord(input.path);
  const changed = Boolean(input && record && (await fingerprint(input)) !== record.fingerprint);
  // The menu may have moved on to another note while that was worked out.
  if (shareDoc !== doc) return;

  const head = el("div", "share-head");
  const title = el("span", "share-title");
  title.textContent = "Share to web";
  head.append(title);
  if (record) {
    const live = el("span", "share-live");
    live.textContent = "Live";
    head.append(live);
  }
  const children: HTMLElement[] = [head];

  if (!inTauri || !input) {
    const note = el("p", "share-intro");
    note.textContent = inTauri ? "Save this note to a file to share it as a web page." : "Sharing works in the Grimm app.";
    children.push(note);
  } else if (!record) {
    const intro = el("p", "share-intro");
    intro.textContent = "Turn this note into a web page anyone with the link can read.";

    // A small browser window showing the note as the page will open.
    const { title: pageTitle, line } = sharePreview(input.markdown, input.title);
    const preview = el("div", "share-preview");
    const chrome = el("div", "share-preview-bar");
    chrome.append(el("i"), el("i"), el("i"));
    const address = el("span");
    address.textContent = shareHost();
    chrome.append(address);
    const page = el("div", "share-preview-page");
    const heading = el("strong");
    heading.textContent = pageTitle;
    page.append(heading);
    if (line) {
      const first = el("p");
      first.textContent = line;
      page.append(first);
    }
    preview.append(chrome, page);

    const info = el("p", "share-fine");
    info.append(icon(Info));
    info.append("Links stop working after 30 days and aren’t listed by search engines.");

    children.push(
      intro,
      preview,
      shareButton(shareBusy === "publish" ? "Sharing…" : "Share", "share-primary share-wide", () => runShare(doc, "publish")),
      info,
    );
  } else {
    const url = new URL(record.url);
    const link = el("div", "share-link");
    const host = el("span", "share-link-host");
    host.textContent = url.host;
    const path = el("span", "share-link-path");
    path.textContent = url.pathname;
    const copy = iconButton(Copy, "Copy link", async () => {
      if (!(await copyLink(record.url))) return;
      copy.replaceChildren(icon(Check));
      window.setTimeout(() => copy.replaceChildren(icon(Copy)), 1400);
    }, "icon-btn share-copy");
    link.append(host, path, copy);

    const update = shareRow(
      RefreshCw,
      shareBusy === "publish" ? "Updating…" : changed ? "Update page" : "Page is up to date",
      changed ? "Has new changes" : `Shared ${shareDate(record.sharedAt)}`,
      () => runShare(doc, "publish"),
    );
    update.classList.toggle("pending", changed);
    const rows = el("div", "share-rows");
    rows.append(update);
    if (record.expiresAt) rows.append(shareRow(Clock, "Link expires", shareDate(record.expiresAt)));
    rows.append(
      shareRow(FileText, "View Markdown", "", () => openUrl(`${record.url}.md`).catch(() => {})),
    );

    const actions = el("div", "share-actions");
    actions.append(
      shareButton(shareBusy === "unshare" ? "Stopping…" : "Stop sharing", "share-secondary", () => stopSharing(doc)),
      shareButton("View page", "share-primary", () => openUrl(record.url).catch(() => {})),
    );
    children.push(link, rows, actions);
  }

  if (error) {
    const message = el("p", "share-error");
    message.textContent = error;
    children.push(message);
  }
  if (inTauri && sharedPages().length) {
    const all = el("button", "share-all");
    all.textContent = "All shared pages";
    all.addEventListener("click", openSharedPages);
    children.push(all);
  }
  shareMenu.replaceChildren(...children);
}

async function stopSharing(doc: Doc) {
  const confirmed = await ask("The link will stop working for anyone who has it.", {
    title: "Stop sharing this note?",
    kind: "warning",
    okLabel: "Stop Sharing",
    cancelLabel: "Cancel",
  });
  if (confirmed) await runShare(doc, "unshare");
}

async function runShare(doc: Doc, action: "publish" | "unshare") {
  const input = shareInput(doc);
  if (!input || shareBusy) return;
  shareBusy = action;
  await renderShareMenu();
  let error = "";
  try {
    if (action === "unshare") {
      await unshare(input.path);
      toast("Sharing stopped");
    } else {
      const { record, skippedImages } = await publish(input);
      const copied = await copyLink(record.url);
      const note = skippedImages ? ` ${skippedImages === 1 ? "One image" : `${skippedImages} images`} couldn’t be included.` : "";
      toast(`${copied ? "Link copied." : "Page is live."}${note}`, note ? 5000 : 2600);
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  shareBusy = null;
  renderBar(doc.pane);
  renderSidebar();
  if (shareDoc === doc && !shareMenu.hidden) await renderShareMenu(error);
}

async function toggleShare(doc: Doc, anchor?: HTMLElement) {
  if (!shareMenu.hidden && shareDoc === doc) return void (shareMenu.hidden = true);
  appearanceMenu.hidden = true;
  closePageMenu();
  shareDoc = doc;
  await renderShareMenu();
  shareMenu.hidden = false;
  const target = anchor ?? doc.pane.headEl.querySelector<HTMLElement>(".share-btn");
  const rect = target?.getBoundingClientRect() ?? new DOMRect(window.innerWidth - 16, 40, 0, 0);
  shareMenu.style.top = `${rect.bottom + 6}px`;
  shareMenu.style.left = `${Math.max(8, rect.right - shareMenu.offsetWidth)}px`;
}

// ---------- shared pages ----------

/** Lists every page shared from this Mac, with what can be done to each. */
function openSharedPages() {
  shareMenu.hidden = appearanceMenu.hidden = true;
  if (!inTauri) return;
  renderSharedPages();
  sharedPagesEl.hidden = false;
}

function closeSharedPages() {
  sharedPagesEl.hidden = true;
}

function renderSharedPages(notice = "") {
  const panel = el("div", "sp-panel");
  const head = el("div", "sp-head");
  const title = el("span", "share-title");
  title.textContent = "Shared pages";
  head.append(title, iconButton(X, "Close", closeSharedPages, "icon-btn small"));
  const intro = el("p", "share-intro");
  intro.textContent = "Notes shared from this Mac. Each link stops working 30 days after it was first shared.";
  panel.append(head, intro);

  const pages = sharedPages();
  const list = el("div", "sp-list");
  for (const { path, record } of pages) {
    const row = el("div", "sp-row");
    const main = el("button", "sp-main");
    main.title = `Open ${basename(path)}`;
    const name = el("span", "sp-title");
    name.textContent = basename(path).replace(/\.[^.]+$/, "");
    const meta = el("span", "sp-meta");
    const expiry = record.expiresAt ? `Expires ${shareDate(record.expiresAt)}` : "Doesn’t expire";
    meta.textContent = `${tildify(path)} · ${expiry}`;
    main.append(name, meta);
    main.addEventListener("click", async () => {
      closeSharedPages();
      await openPath(path);
    });

    const actions = el("div", "sp-actions");
    const copy = iconButton(Copy, "Copy link", async () => {
      if (!(await copyLink(record.url))) return;
      copy.replaceChildren(icon(Check));
      window.setTimeout(() => copy.replaceChildren(icon(Copy)), 1400);
    });
    actions.append(
      copy,
      iconButton(ExternalLink, "View page", () => openUrl(record.url).catch(() => {})),
      iconButton(Trash2, "Stop sharing", async () => {
        const confirmed = await ask("The link will stop working for anyone who has it.", {
          title: `Stop sharing “${name.textContent}”?`,
          kind: "warning",
          okLabel: "Stop Sharing",
          cancelLabel: "Cancel",
        });
        if (!confirmed) return;
        try {
          await unshare(path);
          for (const pane of panes) renderBar(pane);
          renderSidebar();
          renderSharedPages();
        } catch (e) {
          renderSharedPages(e instanceof Error ? e.message : String(e));
        }
      }),
    );
    row.append(main, actions);
    list.append(row);

    // Fill in what only the server and the disk know: the page's title, and whether the note is still there.
    invoke<boolean>("file_exists", { path }).then((exists) => {
      if (exists) return;
      main.disabled = true;
      main.title = "The note was moved or deleted";
      meta.textContent = `File not found · ${expiry}`;
    });
    shareStatus(path).then((status) => {
      if (!status || !row.isConnected) return;
      if (status.status !== "live") {
        row.remove();
        if (!list.children.length) renderSharedPages();
        return;
      }
      if (status.title) name.textContent = status.title;
    });
  }

  if (pages.length) panel.append(list);
  else {
    const empty = el("p", "sp-empty");
    empty.textContent = "Nothing is shared right now. Use Share on a note to publish it as a web page.";
    panel.append(empty);
  }
  if (notice) {
    const message = el("p", "share-error");
    message.textContent = notice;
    panel.append(message);
  }
  sharedPagesEl.replaceChildren(panel);
}

sharedPagesEl.addEventListener("mousedown", (e) => {
  if (e.target === sharedPagesEl) closeSharedPages();
});

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

// Undo and redo are routed by hand: a block move can leave the caret outside
// the editor, and the menu bar's own items only know about typed text.
let lastHistoryAt = 0;

function runHistory(action: "undo" | "redo") {
  const now = performance.now();
  // The same press can arrive as a keydown and again as a menu event.
  if (now - lastHistoryAt < 100) return;
  lastHistoryAt = now;
  const target = document.activeElement;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
    return void document.execCommand(action);
  }
  if (target instanceof HTMLElement && target.closest(".cm-editor")) {
    // Code blocks keep their own history, bound to this key.
    const mac = /Mac|iPhone|iPad/.test(navigator.platform);
    const init = { key: "z", code: "KeyZ", keyCode: 90, metaKey: mac, ctrlKey: !mac, shiftKey: action === "redo" };
    return void target.dispatchEvent(new KeyboardEvent("keydown", { ...init, bubbles: true, cancelable: true }));
  }
  const doc = focused.active;
  if (doc?.mode !== "rich" || !doc.crepe) return;
  doc.crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    (action === "undo" ? undo : redo)(view.state, view.dispatch);
    view.focus();
  });
}

window.addEventListener("keydown", (e) => {
  if (!e.isTrusted || e.code !== "KeyZ" || !(e.metaKey || e.ctrlKey) || e.altKey) return;
  const field = e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement;
  // An editor or text field that had the caret has already dealt with it.
  if (e.defaultPrevented || field) return void (lastHistoryAt = performance.now());
  e.preventDefault();
  runHistory(e.shiftKey ? "redo" : "undo");
});

const commands: Record<string, () => unknown> = {
  undo: () => runHistory("undo"),
  redo: () => runHistory("redo"),
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
  welcome: () => openGuide("welcome"),
  onboarding: showWelcomeScreen,
  features: () => openGuide("features"),
  help: () => openGuide("help"),
  examples: () => openGuide("examples"),
  share: () => focused.active && toggleShare(focused.active),
  "shared-pages": openSharedPages,
  search: focusSearch,
  history: () => (historyOpen() ? closeHistory() : showHistory(focused.active)),
  commit: () => focused.active && toggleCommit(focused.active),
};

// A shortcut can arrive both as a keydown and as a native menu event; the
// short window keeps it from running twice.
let lastCommand = "";
let lastCommandAt = 0;
function run(id: string) {
  const now = performance.now();
  const repeatable = id === "undo" || id === "redo";
  if (!repeatable && id === lastCommand && now - lastCommandAt < 250) return;
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
    case "KeyK":
      return e.shiftKey ? null : "search";
    case "BracketRight":
      return e.shiftKey ? "next-tab" : null;
    case "BracketLeft":
      return e.shiftKey ? "prev-tab" : null;
    default:
      return null;
  }
}

// ---------- wiring ----------

$("search-empty").insertAdjacentHTML("afterbegin", emptySearchScene());

createIcons({
  icons: { ChevronDown, CircleQuestionMark, Ellipsis, FileText, FolderOpen, Palette, PanelLeft, Search, SquarePen, X },
  attrs: ICON_ATTRS,
});

$("btn-sidebar").addEventListener("click", toggleSidebar);
$("btn-compose").addEventListener("click", () => newDocument());
$("btn-open").addEventListener("click", openDialog);
$("btn-folder").addEventListener("click", openFolderDialog);
$("btn-help").addEventListener("click", () => openGuide("help"));
$("btn-theme").addEventListener("click", (e) => {
  e.stopPropagation();
  toggleAppearance(e.currentTarget as HTMLElement);
});
sidebarEl.addEventListener("mouseenter", () => peekSidebar(true));
sidebarEl.addEventListener("mouseleave", () => peekSidebar(false));

/** ⌘K: into the sidebar's search, peeking at the sidebar if it is closed. */
function focusSearch() {
  peekSidebar(true);
  sideSearch.focus();
  sideSearch.select();
}

sideSearch.addEventListener("input", renderSidebar);
sideSearch.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    e.stopPropagation();
    sideSearch.value = "";
    renderSidebar();
    sideSearch.blur();
    peekSidebar(false);
  } else if (e.key === "Enter") {
    sidebarEl.querySelector<HTMLElement>(".file-list li:not(.empty)")?.click();
    sideSearch.value = "";
    renderSidebar();
    sideSearch.blur();
    peekSidebar(false, true);
  }
});
sideSearch.addEventListener("blur", () => peekSidebar(false));

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    appearanceMenu.hidden = shareMenu.hidden = commitMenu.hidden = sharedPagesEl.hidden = rowMenu.hidden = true;
    closePageMenu();
  }
  const id = shortcut(e);
  if (!id) return;
  e.preventDefault();
  run(id);
});

window.addEventListener("mousedown", (e) => {
  if (!appearanceMenu.hidden && !appearanceMenu.contains(e.target as Node)) appearanceMenu.hidden = true;
  if (!shareMenu.hidden && !shareMenu.contains(e.target as Node)) shareMenu.hidden = true;
  if (!commitMenu.hidden && !commitMenu.contains(e.target as Node)) commitMenu.hidden = true;
  const target = e.target as Node;
  if (!pageMenu.hidden && !pageMenu.contains(target)) closePageMenu();
  if (!rowMenu.hidden && !rowMenu.contains(target)) rowMenu.hidden = true;
});

window.addEventListener("resize", () => {
  appearanceMenu.hidden = shareMenu.hidden = commitMenu.hidden = true;
  closePageMenu();
  for (const pane of panes) if (pane.active?.mode === "source") autosizeSource(pane.active);
});

async function restoreSession(saved: Session | null) {
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
  installTableDrag();
  // Keeps "Edited 5m ago" current.
  setInterval(() => panes.forEach(renderHead), 60_000);
  if (localStorage.getItem("sidebarCollapsed") === "true") app.classList.add("sidebar-collapsed");
  setSidebarWidth(Number(localStorage.getItem("sidebarWidth")) || SIDEBAR_DEFAULT);
  setSplitRatio(Number(localStorage.getItem("splitRatio")) || 0.5);
  draggable($("sidebar-resizer"), setSidebarWidth, () => setSidebarWidth(SIDEBAR_DEFAULT));
  if (inTauri && navigator.userAgent.includes("Mac")) app.classList.add("overlay-titlebar");

  // Read before the first document exists: creating it saves the (empty) session over this one.
  const saved: Session | null = JSON.parse(localStorage.getItem("session") ?? "null");
  focused = createPane();
  showActive(focused);

  if (!inTauri) return;

  await restoreSession(saved);

  await listen<string>("menu", ({ payload }) => run(payload));
  await listen<{ path: string; contents: string; hash: string }>("file-changed", ({ payload }) => outsideChange(payload));
  await listen<{ from: string; to: string }>("file-renamed", ({ payload }) => outsideRename(payload));

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
    // Write what can be written first; only notes that have never been given a
    // file can still be unsaved after that. Nothing is awaited unless there is
    // something to write, so an ordinary quit is not held up.
    const pendingSaves = allDocs().filter((d) => d.dirty && d.path);
    if (pendingSaves.length) {
      event.preventDefault();
      await Promise.all(pendingSaves.map(autosave));
    }
    const unsaved = allDocs().filter((d) => d.dirty).length;
    if (unsaved) {
      const text =
        unsaved === 1
          ? "A document has unsaved changes. Quit anyway?"
          : `${unsaved} documents have unsaved changes. Quit anyway?`;
      if (!(await confirmDiscard(text, "Quit"))) return event.preventDefault();
    }
    // The close was held back for the saves above, so finish it by hand.
    if (pendingSaves.length) await getCurrentWindow().destroy();
  });

  const pending = await invoke<string | null>("take_pending_file");
  if (pending) await openPath(pending);
  await refreshFolders();
  checkForUpdates();
}

init();
