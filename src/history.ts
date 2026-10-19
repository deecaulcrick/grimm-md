import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { diffArrays } from "diff";
import { micromark } from "micromark";
import { gfm, gfmHtml } from "micromark-extension-gfm";
import { RotateCcw, X, createElement, type IconNode } from "lucide";

import { imageUrl } from "./images";

/** Why a version was kept; the backend's `Reason`. */
export type Reason = "opened" | "edited" | "before-restore" | "restored" | "outside" | "replaced";

export interface Version {
  hash: string;
  time: number;
  reason: Reason;
}

export interface HistoryTarget {
  name: string;
  path: string;
  /** What is in the editor now, which may not be a stored version yet. */
  current: string;
  /** Puts a version back into the note; resolves once it is there. */
  restore: (hash: string, text: string, time: number) => Promise<boolean>;
}

const REASONS: Record<Reason, string> = {
  opened: "Opened",
  edited: "Edited",
  "before-restore": "Before restoring",
  restored: "Restored",
  outside: "Changed outside Grimm",
  replaced: "Edits replaced by a newer file",
};

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/;
// Characters from the Private Use Area mark where changes start and end in the
// Markdown, so the marks travel through rendering and become <ins> and <del>.
const INS = "";
const INS_END = "";
const DEL = "";
const DEL_END = "";
const MARKS = /[-]|%EE%80%8[0-3]/gi;
// What starts a heading, list item or quote. A mark placed before it would
// stop the line being one, so a change at the start of a line opens after it.
const LINE_SYNTAX =
  /^[ \t]*(?:>[ \t]?|#{1,6}[ \t]+|[-*+][ \t]+(?:\[[ xX]\][ \t]+)?|\d{1,9}[.)][ \t]+(?:\[[ xX]\][ \t]+)?)*/;
// Lines that are only syntax (code fences, rules, a table's divider) are never marked.
const STRUCTURE = /^\s*(?:```|~~~|(?:[-*_][ \t]*){3,}$|\|?(?:\s*:?-+:?\s*\|)+\s*:?-*:?\s*$)/;
const TABLE_ROW = /^\s*\|/;
// Lines with less than this share of their words in common count as unrelated.
const SIMILAR = 0.5;
// A diff that takes longer than this is skipped rather than waited for.
const DIFF_TIMEOUT = 800;

const tokens = (text: string) => text.match(/\s+|[\p{L}\p{N}_'’]+|[^\s\p{L}\p{N}_'’]/gu) ?? [];
const prefix = (line: string) => line.match(LINE_SYNTAX)?.[0] ?? "";

/** A table row with each cell's text marked, so the row keeps its cells. */
const markCells = (row: string, open: string, close: string) =>
  row.replace(/(^|\|)([^|]*)/g, (whole, bar: string, cell: string) =>
    cell.trim() ? bar + cell.replace(/^(\s*)(.*?)(\s*)$/, `$1${open}$2${close}$3`) : whole,
  );

/** Marks a whole line as added or removed. */
function markLine(line: string, open: string, close: string): string {
  if (!line.trim() || STRUCTURE.test(line)) return line;
  if (TABLE_ROW.test(line)) return markCells(line, open, close);
  const start = prefix(line);
  return line.slice(start.length).trim() ? `${start}${open}${line.slice(start.length)}${close}` : line;
}

/** Marks the words that differ between two versions of the same piece of a line. */
function markWords(before: string, after: string): string {
  const parts = diffArrays(tokens(before), tokens(after), { timeout: DIFF_TIMEOUT });
  if (!parts) return `${DEL}${before}${DEL_END}${INS}${after}${INS_END}`;
  return parts
    .map(({ added, removed, value }) => {
      const text = value.join("");
      if (!text.trim() || (!added && !removed)) return text;
      return added ? `${INS}${text}${INS_END}` : `${DEL}${text}${DEL_END}`;
    })
    .join("");
}

/** Whether two lines are versions of one another rather than unrelated. */
function similar(a: string, b: string): boolean {
  if (!a.trim() || !b.trim()) return !a.trim() && !b.trim();
  const words = (line: string) => tokens(line).filter((t) => t.trim());
  const [x, y] = [words(a), words(b)];
  const parts = diffArrays(x, y, { timeout: DIFF_TIMEOUT });
  const common = parts?.reduce((n, p) => (p.added || p.removed ? n : n + p.value.length), 0) ?? 0;
  return (2 * common) / (x.length + y.length) >= SIMILAR;
}

/** One line edited into another: its own syntax kept, the words compared. */
function mergeLine(before: string, after: string): string {
  if (TABLE_ROW.test(before) && TABLE_ROW.test(after)) {
    const [a, b] = [before.split("|"), after.split("|")];
    if (a.length !== b.length) return `${markLine(before, DEL, DEL_END)}\n${markLine(after, INS, INS_END)}`;
    return b.map((cell, i) => (cell === a[i] ? cell : markWords(a[i], cell))).join("|");
  }
  const start = prefix(after);
  return start + markWords(before.slice(prefix(before).length), after.slice(start.length));
}

/** Lines replaced by others: those that were edited are paired up, the rest shown whole. */
function mergeRun(removed: string[], added: string[]): string[] {
  const lines: string[] = [];
  let i = 0;
  let j = 0;
  while (i < removed.length || j < added.length) {
    const [r, a] = [removed[i], added[j]];
    if (r !== undefined && a !== undefined && similar(r, a)) {
      lines.push(r === a ? a : mergeLine(r, a));
      i++;
      j++;
    } else if (r !== undefined && (a === undefined || !added.slice(j + 1).some((later) => similar(r, later)))) {
      lines.push(markLine(r, DEL, DEL_END));
      i++;
    } else {
      lines.push(markLine(a, INS, INS_END));
      j++;
    }
  }
  return lines;
}

/**
 * The newer text with changes from the older one marked: lines are compared
 * first, then the words of lines that were edited. Added words are where they
 * are, and removed ones are put back where they were.
 */
export function markChanges(before: string, after: string): string {
  const parts = diffArrays(before.split("\n"), after.split("\n"), { timeout: DIFF_TIMEOUT });
  if (!parts) return after;
  const out: string[] = [];
  let removed: string[] = [];
  for (const part of parts) {
    if (part.removed) {
      removed.push(...part.value);
      continue;
    }
    out.push(...mergeRun(removed, part.added ? part.value : []));
    removed = [];
    if (!part.added) out.push(...part.value);
  }
  out.push(...mergeRun(removed, []));
  return out.join("\n");
}

/** Turns the marks left in rendered text into <ins> and <del>, across element boundaries. */
function applyMarks(root: HTMLElement) {
  for (const node of root.querySelectorAll("*")) {
    for (const attr of [...node.attributes]) {
      if (MARKS.test(attr.value)) node.setAttribute(attr.name, attr.value.replace(MARKS, ""));
      MARKS.lastIndex = 0;
    }
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  while (walker.nextNode()) texts.push(walker.currentNode as Text);
  let open: "ins" | "del" | null = null;
  for (const text of texts) {
    if (!open && !/[-]/.test(text.data)) continue;
    const pieces = document.createDocumentFragment();
    for (const piece of text.data.split(/([-])/)) {
      if (piece === INS || piece === DEL) open = piece === INS ? "ins" : "del";
      else if (piece === INS_END || piece === DEL_END) open = null;
      else if (piece && open) {
        const mark = document.createElement(open);
        mark.textContent = piece;
        pieces.append(mark);
      } else if (piece) pieces.append(piece);
    }
    text.replaceWith(pieces);
  }
}

/** Renders a note's Markdown the way the editor shows it, without being editable. */
export function renderMarkdown(markdown: string, notePath: string): HTMLElement {
  const root = document.createElement("div");
  root.className = "ProseMirror";
  // Raw HTML in the note is shown as text, never run.
  root.innerHTML = micromark(markdown, { extensions: [gfm()], htmlExtensions: [gfmHtml()] });
  applyMarks(root);
  for (const img of root.querySelectorAll("img")) {
    const src = img.getAttribute("src") ?? "";
    img.removeAttribute("src");
    Promise.resolve(imageUrl(src, notePath)).then((url) => (img.src = url));
  }
  return root;
}

const icon = (node: IconNode) => createElement(node, { "stroke-width": 1.5, class: "lucide" });

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function dayLabel(time: number): string {
  const day = new Date(time);
  const today = new Date();
  const days = Math.round(
    (new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() -
      new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime()) /
      86_400_000,
  );
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return day.toLocaleDateString(undefined, {
    weekday: days < 7 ? "long" : undefined,
    day: "numeric",
    month: "long",
    year: day.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

const timeLabel = (time: number) => new Date(time).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

// ---------- panel ----------

const panel = document.getElementById("history") as HTMLElement;
// Texts already read from the backend, by hash. Versions never change.
const texts = new Map<string, string>();

interface Entry {
  /** Null for the note as it is now. */
  version: Version | null;
  time: number;
}

let target: HistoryTarget | null = null;
let entries: Entry[] = [];
let selected = 0;
let highlight = localStorage.getItem("historyHighlight") !== "false";
let busy = false;
let listEl: HTMLElement;
let viewEl: HTMLElement;
let restoreButton: HTMLButtonElement;

const entryText = async (entry: Entry): Promise<string> => {
  if (!entry.version) return target?.current ?? "";
  const { hash } = entry.version;
  let text = texts.get(hash);
  if (text === undefined) {
    text = await invoke<string>("read_version", { hash });
    texts.set(hash, text);
  }
  return text;
};

const body = (markdown: string) => markdown.replace(FRONTMATTER, "");

async function showSelected() {
  const entry = entries[selected];
  for (const [i, item] of [...listEl.querySelectorAll(".history-item")].entries()) {
    item.classList.toggle("selected", i === selected);
    item.setAttribute("aria-selected", String(i === selected));
  }
  listEl.querySelector(".history-item.selected")?.scrollIntoView({ block: "nearest" });
  restoreButton.disabled = busy || !entry.version;
  const shown = selected;
  let markdown: string;
  try {
    const text = body(await entryText(entry));
    // Compared with the version before it, so what it shows is what changed then.
    const older = entries[selected + 1];
    markdown = highlight && older ? markChanges(body(await entryText(older)), text) : text;
  } catch (err) {
    markdown = `*Couldn't read this version: ${err}*`;
  }
  // Another version was picked while this one was loading.
  if (shown !== selected || !target) return;
  const page = el("div", "page");
  const editor = el("div", "editor");
  const milkdown = el("div", "milkdown");
  milkdown.append(renderMarkdown(markdown, target.path));
  editor.append(milkdown);
  page.append(editor);
  viewEl.replaceChildren(page);
  viewEl.scrollTop = 0;
}

function select(index: number) {
  if (index < 0 || index >= entries.length || index === selected) return;
  selected = index;
  showSelected();
}

function renderList() {
  listEl.replaceChildren();
  let day = "";
  for (const [i, entry] of entries.entries()) {
    const label = dayLabel(entry.time);
    if (label !== day) {
      day = label;
      listEl.append(el("div", "history-day", label));
    }
    const item = el("button", "history-item");
    item.setAttribute("role", "option");
    item.append(
      el("span", "history-time", entry.version ? timeLabel(entry.time) : "Current version"),
      el("span", "history-reason", entry.version ? REASONS[entry.version.reason] : "What's in the editor now"),
    );
    item.addEventListener("click", () => select(i));
    listEl.append(item);
  }
  if (entries.length === 1) {
    listEl.append(el("p", "history-empty", "Earlier versions appear here as you write. Grimm keeps one every few minutes."));
  }
}

async function restoreSelected() {
  const entry = entries[selected];
  if (!target || !entry.version || busy) return;
  busy = true;
  restoreButton.disabled = true;
  restoreButton.lastChild!.textContent = "Restoring…";
  const text = await entryText(entry);
  const done = await target.restore(entry.version.hash, text, entry.time);
  busy = false;
  restoreButton.lastChild!.textContent = "Restore this version";
  if (done) closeHistory();
  else restoreButton.disabled = false;
}

/** Copying from an old version leaves out the words it had removed. */
function copyWithoutRemovals(e: ClipboardEvent) {
  const selection = window.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed || !e.clipboardData) return;
  const holder = el("div", "history-copy");
  holder.append(selection.getRangeAt(0).cloneContents());
  holder.querySelectorAll("del").forEach((node) => node.remove());
  holder.querySelectorAll("ins").forEach((node) => node.replaceWith(...node.childNodes));
  // Attached for a moment so innerText keeps the line breaks between blocks.
  document.body.append(holder);
  e.clipboardData.setData("text/plain", holder.innerText);
  e.clipboardData.setData("text/html", holder.innerHTML);
  holder.remove();
  e.preventDefault();
}

function build(name: string) {
  const sheet = el("div", "history-sheet");
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-label", `Version history of ${name}`);

  const head = el("header", "history-head");
  const title = el("div", "history-title");
  title.append(el("span", "share-title", "Version history"), el("span", "history-name", name));
  const toggle = el("label", "history-toggle");
  const checkbox = el("input");
  checkbox.type = "checkbox";
  checkbox.checked = highlight;
  checkbox.addEventListener("change", () => {
    highlight = checkbox.checked;
    localStorage.setItem("historyHighlight", String(highlight));
    showSelected();
  });
  toggle.append(checkbox, document.createTextNode("Show changes"));
  restoreButton = el("button", "share-primary history-restore");
  restoreButton.append(icon(RotateCcw), el("span", "", "Restore this version"));
  restoreButton.addEventListener("click", restoreSelected);
  const close = el("button", "icon-btn");
  close.title = "Close (Esc)";
  close.append(icon(X));
  close.addEventListener("click", closeHistory);
  head.append(title, toggle, restoreButton, close);

  viewEl = el("div", "history-view");
  viewEl.addEventListener("copy", copyWithoutRemovals);
  viewEl.addEventListener("click", (e) => {
    const link = (e.target as HTMLElement).closest("a");
    if (!link) return;
    e.preventDefault();
    if (/^https?:/i.test(link.href)) openUrl(link.href).catch(() => {});
  });
  listEl = el("div", "history-list");
  listEl.setAttribute("role", "listbox");
  listEl.tabIndex = 0;

  const main = el("div", "history-body");
  main.append(viewEl, listEl);
  sheet.append(head, main);
  panel.replaceChildren(sheet);
}

export const historyOpen = () => !panel.hidden;

export async function openHistory(next: HistoryTarget) {
  let versions: Version[];
  try {
    versions = await invoke<Version[]>("list_versions", { path: next.path });
  } catch {
    versions = [];
  }
  target = next;
  entries = [{ version: null, time: Date.now() }, ...versions.map((version) => ({ version, time: version.time }))];
  // The newest version is usually what is in the editor; the one to look at is the one before.
  const latest = versions[0];
  if (latest && (texts.get(latest.hash) ?? (await entryText(entries[1]))) === next.current) entries.splice(1, 1);
  selected = entries.length > 1 ? 1 : 0;
  build(next.name);
  renderList();
  panel.hidden = false;
  listEl.focus();
  await showSelected();
}

export function closeHistory() {
  panel.hidden = true;
  panel.replaceChildren();
  target = null;
  entries = [];
}

panel.addEventListener("mousedown", (e) => e.target === panel && closeHistory());
panel.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    e.stopPropagation();
    closeHistory();
  } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && e.target === listEl) {
    e.preventDefault();
    select(selected + (e.key === "ArrowDown" ? 1 : -1));
  }
});
