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
  const height = Number(event.data?.folioEmbedHeight);
  if (!Number.isFinite(height)) return;
  for (const frame of document.querySelectorAll<HTMLIFrameElement>("iframe.html-embed")) {
    if (frame.contentWindow !== event.source) continue;
    frame.style.height = `${Math.min(Math.max(height, 24), MAX_HEIGHT)}px`;
  }
});

const REPORT_HEIGHT = `<script>
  const report = () => parent.postMessage({ folioEmbedHeight: document.documentElement.scrollHeight }, "*");
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

export function renderEmbed(language: string, content: string): string | null {
  if (language.toLowerCase() !== EMBED_LANGUAGE || !content.trim()) return null;
  const id = String(nextSlot++);
  slots.set(id, content);
  if (slots.size > MAX_SLOTS) slots.delete(slots.keys().next().value!);
  return `<div class="${SLOT_CLASS}" data-embed="${id}"></div>`;
}

export function insertEmbed(ctx: Ctx) {
  const commands = ctx.get(commandsCtx);
  commands.call(clearTextInCurrentBlockCommand.key);
  commands.call(addBlockTypeCommand.key, {
    nodeType: codeBlockSchema.type(ctx),
    attrs: { language: EMBED_LANGUAGE },
  });
}
