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
import { openUrl } from "@tauri-apps/plugin-opener";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import {
  ArrowRightLeft,
  Check,
  CircleQuestionMark,
  Clock,
  Code,
  Copy,
  Columns2,
  FileText,
  FolderOpen,
  Globe,
  History as HistoryIcon,
  Info,
  Palette,
  PanelLeft,
  Plus,
  RefreshCw,
  Share,
  X,
  createElement,
  createIcons,
  type IconNode,
} from "lucide";

import { blockDrag } from "./blockDrag";
import { codeTheme } from "./codeTheme";
import { blockEditIcons, diagramIcon, embedIcon, imageBlockConfig, tableIcons, toolbarIcons } from "./editorIcons";
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
import { Outline } from "./outline";
import { installTableDrag } from "./tableDrag";
import { fingerprint, publish, shareHost, shareRecord, unshare, type ShareInput } from "./share";
import { taskShortcut } from "./taskShortcut";
import { THEMES, applyTheme, findTheme, type Theme } from "./themes";

type Mode = "rich" | "source";
type DocFont = "serif" | "sans" | "mono";
type PageWidth = "centered" | "full";
type DocSize = "small" | "normal" | "large";

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
  pane: Pane;
  el: HTMLElement;
  noticeEl: HTMLElement;
  editorEl: HTMLElement;
  sourceEl: HTMLTextAreaElement;
}

interface Pane {
  docs: Doc[];
  active: Doc | null;
  el: HTMLElement;
  barEl: HTMLElement;
  bodyEl: HTMLElement;
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
const toastEl = $("toast");

const panes: Pane[] = [];
let focused: Pane;
let folder: string | null = localStorage.getItem("folder");
let folderFiles: string[] = [];
let recents: string[] = JSON.parse(localStorage.getItem("recents") ?? "[]");
let theme: Theme =
  findTheme(localStorage.getItem("theme")) ??
  THEMES.find((t) => t.scheme === (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"))!;

const DOC_FONTS: DocFont[] = ["serif", "sans", "mono"];
let docFont: DocFont = DOC_FONTS.find((f) => f === localStorage.getItem("font")) ?? "serif";
const DOC_SIZES: DocSize[] = ["small", "normal", "large"];
let docSize: DocSize = DOC_SIZES.find((size) => size === localStorage.getItem("fontSize")) ?? "normal";
let pageWidth: PageWidth = localStorage.getItem("pageWidth") === "full" ? "full" : "centered";

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
    tab.addEventListener("click", () => tabDragged || activate(doc));
    tab.addEventListener("pointerdown", (e) => startTabDrag(e, doc, tab));
    tab.addEventListener("auxclick", (e) => e.button === 1 && closeDoc(doc));
    tabs.append(tab);
  }
  tabs.append(iconButton(Plus, "New document (⌘N)", () => newDocument(pane), "icon-btn tab-new"));
  children.push(tabs);

  const actions = el("div", "pane-actions");
  const doc = pane.active;
  if (doc) {
    const shared = Boolean(doc.path && shareRecord(doc.path));
    const share = iconButton(shared ? Globe : Share, shared ? "Shared to web" : "Share to web", (e) => {
      e.stopPropagation();
      toggleShare(doc, e.currentTarget as HTMLElement);
    }, "icon-btn share-btn");
    share.classList.toggle("on", shared);
    actions.append(share);
    if (doc.path) actions.append(iconButton(HistoryIcon, "Version history (⌥⌘Y)", () => showHistory(doc)));
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
  const outline = new Outline();
  bodyEl.append(outline.el);
  const pane: Pane = { docs: [], active: null, el: paneEl, barEl, bodyEl, outline };
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

/** Makes sure a pane that just lost a tab still shows something, or goes away. */
async function settlePane(pane: Pane) {
  if (pane.active) showActive(pane);
  else if (panes.length > 1) removePane(pane);
  else await createDoc(pane, null, "");
}

function showActive(pane: Pane) {
  for (const doc of pane.docs) doc.el.hidden = doc !== pane.active;
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
        renderPreview,
        previewOnlyByDefault: true,
        previewToggleText: (previewOnly) => (previewOnly ? "Edit source" : "Hide source"),
      },
      [Crepe.Feature.Toolbar]: toolbarIcons,
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
  });
  instance.editor.use(linkCards).use(taskShortcut).use(blockDrag).use(imageTitles);
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
    pane,
    el: docEl,
    noticeEl,
    editorEl,
    sourceEl,
  };

  docEl.addEventListener("scroll", () => doc.pane.active === doc && doc.pane.outline.sync(), { passive: true });
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

/** The first time Grimm runs, it opens on the welcome note with the feature list beside it. */
async function welcome() {
  if (localStorage.getItem("welcomed")) return;
  localStorage.setItem("welcomed", "1");
  if (allDocs().some((d) => !isPristine(d))) return;
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
  // More was typed while the file was being written: that needs its own save.
  if (getContent(doc) !== contents) return scheduleAutosave(doc);
  if (doc.mode === "rich" && doc.crepe) doc.baseline = doc.crepe.getMarkdown();
  setDirty(doc, false);
}

// Leaving the window is a good moment to make sure everything is on disk.
window.addEventListener("blur", () => allDocs().forEach(autosave));

async function saveDocument(doc: Doc | null, saveAs = false) {
  if (!doc) return;
  if (!inTauri) return toast("Saving needs the desktop app");
  let target = doc.path;
  if (!target || saveAs) {
    const picked = await save({
      defaultPath: doc.path ?? `${folder ? `${folder}/` : ""}${doc.title ?? "Untitled"}.md`,
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
  if (doc.mode === "rich" && doc.crepe) doc.baseline = doc.crepe.getMarkdown();
  rememberRecent(target);
  render();
  if (folder && target.startsWith(folder)) await refreshFolder();
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
  recents = recents.filter((r) => r !== from);
  rememberRecent(to);
  render();
  if (folder) refreshFolder();
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

  const mark = (pane: Pane | null) => {
    target = pane;
    for (const p of panes) p.el.classList.toggle("drop-target", p === pane);
  };
  const move = (e: PointerEvent) => {
    if (!fileDragged) {
      if (Math.hypot(e.clientX - down.clientX, e.clientY - down.clientY) < TAB_DRAG_THRESHOLD) return;
      fileDragged = true;
      document.body.classList.add("dragging-tab");
      document.body.append(ghost);
    }
    ghost.style.transform = `translate(${e.clientX + 12}px, ${e.clientY + 14}px)`;
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
    mark(null);
    document.body.classList.remove("dragging-tab");
    ghost.remove();
    if (drop && pane) openPath(path, { pane });
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

function setDocFont(next: DocFont) {
  docFont = next;
  document.documentElement.dataset.font = next;
  localStorage.setItem("font", next);
}

function setDocSize(next: DocSize) {
  docSize = next;
  document.documentElement.dataset.size = next;
  localStorage.setItem("fontSize", next);
  for (const pane of panes) {
    if (pane.active?.mode === "source") autosizeSource(pane.active);
    pane.outline.sync();
  }
}

function setPageWidth(next: PageWidth) {
  pageWidth = next;
  document.documentElement.dataset.width = next;
  localStorage.setItem("pageWidth", next);
  for (const pane of panes) {
    if (pane.active?.mode === "source") autosizeSource(pane.active);
    pane.outline.sync();
  }
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
  for (const [id, text] of [["serif", "Serif"], ["sans", "Sans"], ["mono", "Mono"]] as const) {
    const button = el("button", id);
    button.textContent = text;
    button.classList.toggle("selected", id === docFont);
    button.addEventListener("click", () => {
      setDocFont(id);
      renderAppearance();
    });
    fonts.append(button);
  }

  const sizes = el("div", "font-toggle");
  for (const [id, text] of [["small", "Small"], ["normal", "Normal"], ["large", "Large"]] as const) {
    const button = el("button");
    button.textContent = text;
    button.classList.toggle("selected", id === docSize);
    button.addEventListener("click", () => {
      setDocSize(id);
      renderAppearance();
    });
    sizes.append(button);
  }

  const widths = el("div", "font-toggle");
  for (const [id, text] of [["centered", "Centered"], ["full", "Full width"]] as const) {
    const button = el("button");
    button.textContent = text;
    button.classList.toggle("selected", id === pageWidth);
    button.addEventListener("click", () => {
      setPageWidth(id);
      renderAppearance();
    });
    widths.append(button);
  }

  appearanceMenu.replaceChildren(label("Theme"), grid, label("Font"), fonts, label("Text size"), sizes, label("Page width"), widths);
}

function toggleAppearance(anchor: HTMLElement) {
  if (!appearanceMenu.hidden) return void (appearanceMenu.hidden = true);
  shareMenu.hidden = true;
  renderAppearance();
  appearanceMenu.hidden = false;
  const rect = anchor.getBoundingClientRect();
  appearanceMenu.style.top = `${rect.bottom + 6}px`;
  appearanceMenu.style.left = `${Math.max(8, rect.right - appearanceMenu.offsetWidth)}px`;
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
    appearance: { theme: theme.id, font: docFont, size: docSize, width: pageWidth },
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
  if (shareDoc === doc && !shareMenu.hidden) await renderShareMenu(error);
}

async function toggleShare(doc: Doc, anchor?: HTMLElement) {
  if (!shareMenu.hidden && shareDoc === doc) return void (shareMenu.hidden = true);
  appearanceMenu.hidden = true;
  shareDoc = doc;
  await renderShareMenu();
  shareMenu.hidden = false;
  const target = anchor ?? doc.pane.barEl.querySelector<HTMLElement>(".share-btn");
  const rect = target?.getBoundingClientRect() ?? new DOMRect(window.innerWidth - 16, 40, 0, 0);
  shareMenu.style.top = `${rect.bottom + 6}px`;
  shareMenu.style.left = `${Math.max(8, rect.right - shareMenu.offsetWidth)}px`;
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
  features: () => openGuide("features"),
  help: () => openGuide("help"),
  examples: () => openGuide("examples"),
  share: () => focused.active && toggleShare(focused.active),
  history: () => (historyOpen() ? closeHistory() : showHistory(focused.active)),
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
  icons: { Plus, FileText, FolderOpen, X, CircleQuestionMark },
  attrs: ICON_ATTRS,
});

$("btn-new").addEventListener("click", () => newDocument());
$("btn-open").addEventListener("click", openDialog);
$("btn-folder").addEventListener("click", openFolderDialog);
$("btn-help").addEventListener("click", () => openGuide("help"));
$("btn-close-folder").addEventListener("click", () => {
  folder = null;
  folderFiles = [];
  localStorage.removeItem("folder");
  renderSidebar();
});

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") appearanceMenu.hidden = shareMenu.hidden = true;
  const id = shortcut(e);
  if (!id) return;
  e.preventDefault();
  run(id);
});

window.addEventListener("mousedown", (e) => {
  if (!appearanceMenu.hidden && !appearanceMenu.contains(e.target as Node)) appearanceMenu.hidden = true;
  if (!shareMenu.hidden && !shareMenu.contains(e.target as Node)) shareMenu.hidden = true;
});

window.addEventListener("resize", () => {
  appearanceMenu.hidden = shareMenu.hidden = true;
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
  document.documentElement.dataset.font = docFont;
  installTableDrag();
  document.documentElement.dataset.size = docSize;
  document.documentElement.dataset.width = pageWidth;
  if (localStorage.getItem("sidebarCollapsed") === "true") app.classList.add("sidebar-collapsed");
  setSidebarWidth(Number(localStorage.getItem("sidebarWidth")) || SIDEBAR_DEFAULT);
  setSplitRatio(Number(localStorage.getItem("splitRatio")) || 0.5);
  draggable($("sidebar-resizer"), setSidebarWidth, () => setSidebarWidth(SIDEBAR_DEFAULT));
  if (inTauri && navigator.userAgent.includes("Mac")) app.classList.add("overlay-titlebar");

  // Read before the first document exists: creating it saves the (empty) session over this one.
  const saved: Session | null = JSON.parse(localStorage.getItem("session") ?? "null");
  focused = createPane();
  await createDoc(focused, null, "");

  if (!inTauri) return void (await welcome());

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
  else await welcome();
  await refreshFolder();
  checkForUpdates();
}

init();
