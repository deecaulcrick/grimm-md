import { LanguageDescription } from "@codemirror/language";
import { registerSlots } from "./previewSlots";

/** Fence language whose contents are rendered as live HTML: ```embed */
export const EMBED_LANGUAGE = "embed";
const MAX_HEIGHT = 900;

export const embedLanguage = LanguageDescription.of({
  name: EMBED_LANGUAGE,
  load: async () => (await import("@codemirror/lang-html")).html(),
});

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
  // The body, not the page: a page is never shorter than its frame, so short embeds could never shrink.
  const report = () => parent.postMessage({ grimmEmbedHeight: Math.ceil(document.body.getBoundingClientRect().height) }, "*");
  new ResizeObserver(report).observe(document.body);
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
    body { display: flow-root; margin: 0; font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: ${root.getPropertyValue("--text")}; }
    iframe, img, video { max-width: 100%; }
  </style></head><body>${content}${REPORT_HEIGHT}</body></html>`;
  return frame;
}

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
const refreshTimers = new WeakMap<HTMLElement, number>();

function refresh(slot: HTMLElement, content: string) {
  if (!slot.isConnected) return;
  for (const stale of slot.querySelectorAll("iframe.pending")) stale.remove();
  const frame = buildFrame(content);
  frame.classList.add("pending");
  slot.append(frame);
  // If the page never reports in, show it anyway.
  window.setTimeout(() => frame.isConnected && frame.classList.contains("pending") && settle(frame), 1500);
}

registerSlots(EMBED_LANGUAGE, {
  fill: (slot, content) => slot.append(buildFrame(content)),
  update: (slot, content) => {
    window.clearTimeout(refreshTimers.get(slot));
    refreshTimers.set(slot, window.setTimeout(() => refresh(slot, content), REFRESH_DELAY));
  },
});
