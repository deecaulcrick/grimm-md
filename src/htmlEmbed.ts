import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import type { Ctx } from "@milkdown/kit/ctx";
import { commandsCtx } from "@milkdown/kit/core";
import {
  addBlockTypeCommand,
  clearTextInCurrentBlockCommand,
  codeBlockSchema,
} from "@milkdown/kit/preset/commonmark";

/** Fence language whose contents are rendered as live HTML: ```embed */
export const EMBED_LANGUAGE = "embed";
const MAX_HEIGHT = 900;

export const codeLanguages = [
  ...languages,
  LanguageDescription.of({
    name: EMBED_LANGUAGE,
    load: async () => (await import("@codemirror/lang-html")).html(),
  }),
];

// Embedded pages report their own height, since a sandboxed frame cannot be measured from outside.
window.addEventListener("message", (event) => {
  const height = Number(event.data?.grimmEmbedHeight);
  if (!Number.isFinite(height)) return;
  for (const frame of document.querySelectorAll<HTMLIFrameElement>("iframe.html-embed")) {
    if (frame.contentWindow !== event.source) continue;
    frame.style.height = `${Math.min(Math.max(height, 24), MAX_HEIGHT)}px`;
    // A replacement frame has now laid itself out: it can take over from the one it replaces.
    if (frame.classList.contains("pending")) settle(frame);
  }
});

const REPORT_HEIGHT = `<script>
  const report = () => parent.postMessage({ grimmEmbedHeight: document.documentElement.scrollHeight }, "*");
  new ResizeObserver(report).observe(document.documentElement);
  addEventListener("load", report);
</script>`;

function buildFrame(content: string): HTMLIFrameElement {
  const root = getComputedStyle(document.documentElement);
  const frame = document.createElement("iframe");
  frame.className = "html-embed";
  // No allow-same-origin: the embedded code runs in an isolated origin and
  // cannot reach the app, its storage or the file commands.
  frame.sandbox.add("allow-scripts", "allow-forms", "allow-popups", "allow-presentation");
  frame.setAttribute("allowfullscreen", "");
  frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>
    html { color-scheme: ${document.documentElement.dataset.scheme ?? "light"}; }
    body { margin: 0; font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: ${root.getPropertyValue("--text")}; }
    iframe, img, video { max-width: 100%; }
  </style></head><body>${content}${REPORT_HEIGHT}</body></html>`;
  return frame;
}

// The editor sanitizes whatever a preview returns, which strips iframes. So
// the preview is only an empty slot, and the frame is put into it from here.
const SLOT_CLASS = "html-embed-slot";
const MAX_SLOTS = 300;
const slots = new Map<string, string>();
let nextSlot = 0;

function fillSlots() {
  for (const slot of document.querySelectorAll<HTMLElement>(`.${SLOT_CLASS}:empty`)) {
    const content = slots.get(slot.dataset.embed ?? "");
    if (content !== undefined) slot.append(buildFrame(content));
  }
}

new MutationObserver(fillSlots).observe(document.body, { childList: true, subtree: true });

/** Shows a frame that was loading behind the one on screen, and drops the old one. */
function settle(frame: HTMLIFrameElement) {
  frame.classList.remove("pending");
  for (const other of frame.parentElement?.querySelectorAll("iframe.html-embed") ?? []) {
    if (other !== frame) other.remove();
  }
}

// While an embed's HTML is being typed, its preview is refreshed in place: the
// new page loads out of sight and is swapped in once it is ready, so the
// preview neither blanks nor jumps in height on every keystroke.
const REFRESH_DELAY = 280;
const refreshTimers = new Map<string, number>();

function refresh(id: string) {
  const slot = document.querySelector<HTMLElement>(`.${SLOT_CLASS}[data-embed="${id}"]`);
  const content = slots.get(id);
  if (!slot || content === undefined) return;
  for (const stale of slot.querySelectorAll("iframe.pending")) stale.remove();
  const frame = buildFrame(content);
  frame.classList.add("pending");
  slot.append(frame);
  // If the page never reports in, show it anyway.
  window.setTimeout(() => frame.isConnected && frame.classList.contains("pending") && settle(frame), 1500);
}

export function renderEmbed(language: string, content: string): string | null {
  if (language.toLowerCase() !== EMBED_LANGUAGE || !content.trim()) return null;
  // The block being typed in keeps its slot, so the editor sees an unchanged preview and leaves it alone.
  const editing = document.activeElement?.closest(".milkdown-code-block")?.querySelector<HTMLElement>(`.${SLOT_CLASS}`);
  const current = editing?.dataset.embed;
  if (current !== undefined && slots.has(current)) {
    slots.set(current, content);
    window.clearTimeout(refreshTimers.get(current));
    refreshTimers.set(current, window.setTimeout(() => refresh(current), REFRESH_DELAY));
    return `<div class="${SLOT_CLASS}" data-embed="${current}"></div>`;
  }
  const id = String(nextSlot++);
  slots.set(id, content);
  if (slots.size > MAX_SLOTS) slots.delete(slots.keys().next().value!);
  const typing = document.activeElement?.closest<HTMLElement>(".milkdown-code-block");
  if (typing) queueMicrotask(() => keepEditing(typing));
  return `<div class="${SLOT_CLASS}" data-embed="${id}"></div>`;
}

/**
 * Embeds show only their result by default, which is right for a note being
 * read. But an embed gets its first preview on the first character typed into
 * it, and hiding the code at that moment would take the editor away mid-word.
 */
function keepEditing(block: HTMLElement) {
  if (!block.querySelector(".codemirror-host.hidden")) return;
  block.querySelector<HTMLButtonElement>(".preview-toggle-button")?.click();
  queueMicrotask(() => block.querySelector<HTMLElement>(".cm-content")?.focus());
}

export function insertEmbed(ctx: Ctx) {
  const commands = ctx.get(commandsCtx);
  commands.call(clearTextInCurrentBlockCommand.key);
  commands.call(addBlockTypeCommand.key, {
    nodeType: codeBlockSchema.type(ctx),
    attrs: { language: EMBED_LANGUAGE },
  });
}
