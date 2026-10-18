import { LanguageDescription, LanguageSupport, StreamLanguage } from "@codemirror/language";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Mounted, MountOptions } from "pele/lazy";
import { registerSlots } from "./previewSlots";

/** Fence language whose contents are drawn as a diagram: ```mermaid */
export const DIAGRAM_LANGUAGE = "mermaid";

const KEYWORDS = new Set(
  ("subgraph end direction participant actor as note over of left right loop alt else opt par and rect critical break " +
    "activate deactivate autonumber title section class classDef style linkStyle click state accTitle accDescr").split(" "),
);

// Enough of Mermaid to colour the source: diagram type, keywords, arrows, labels and comments.
const mermaid = StreamLanguage.define<{ lineStart: boolean }>({
  name: DIAGRAM_LANGUAGE,
  startState: () => ({ lineStart: true }),
  token(stream, state) {
    if (stream.sol()) state.lineStart = true;
    if (stream.eatSpace()) return null;
    const first = state.lineStart;
    state.lineStart = false;
    if (stream.match("%%")) {
      stream.skipToEnd();
      return "comment";
    }
    if (stream.match(/^"[^"]*"?/)) return "string";
    if (stream.match(/^(?:[<xo]?(?:-{2,}|={2,}|-\.+-)[->xo]?|--?>>?|-[x)]|:::)/)) return "operator";
    if (stream.match(/^\d+(\.\d+)?/)) return "number";
    if (stream.match(/^[A-Za-z_]\w*(?:-(?![-.>=])\w+)*/)) {
      const word = stream.current();
      if (first && /^(graph|flowchart|[a-zA-Z]+(Diagram|Chart|-beta|-v2)|pie|gantt|journey|mindmap|timeline|kanban|sankey|packet|radar|treemap|block|architecture|requirement|gitGraph|C4\w+)$/.test(word)) return "keyword";
      return KEYWORDS.has(word) ? "keyword" : null;
    }
    if (stream.match(/^[[\](){}|]/)) return "bracket";
    stream.next();
    return null;
  },
  languageData: { commentTokens: { line: "%%" } },
});

export const diagramLanguage = LanguageDescription.of({
  name: DIAGRAM_LANGUAGE,
  load: async () => new LanguageSupport(mermaid),
});

// Pele is only loaded once a note has a diagram, and each kind of diagram on first use.
let pele: Promise<typeof import("pele/lazy")> | undefined;
const loadPele = () => (pele ??= import("pele/lazy"));

const OPTIONS: MountOptions = {
  fontSize: 14,
  // A note's diagrams should not reach the network on their own.
  images: false,
  linkSchemes: ["http", "https", "mailto"],
};

const diagrams = new WeakMap<HTMLElement, Mounted>();
const latest = new WeakMap<HTMLElement, string>();

/** Draws the slot's latest source. Drawing takes no time, but a new kind of diagram loads first. */
async function draw(slot: HTMLElement) {
  const { detectType, load, mount } = await loadPele();
  const content = latest.get(slot);
  if (content === undefined) return;
  let type = null;
  try {
    type = detectType(content);
  } catch {}
  await load(type).catch(() => false);
  // Typing went on while that loaded: the draw for the newer text takes over.
  if (latest.get(slot) !== content || !slot.isConnected) return;
  const diagram = diagrams.get(slot);
  if (diagram) diagram.update(content);
  else diagrams.set(slot, mount(slot, content, OPTIONS));
}

/** Diagram links open in the browser, never inside the app's own window. */
function openLink(e: MouseEvent) {
  const link = (e.target as Element).closest("a");
  if (!link) return;
  e.preventDefault();
  const href = link.getAttribute("href") ?? link.getAttribute("xlink:href") ?? "";
  if (!/^(https?|mailto):/i.test(href)) return;
  if ("__TAURI_INTERNALS__" in window) openUrl(href).catch(() => {});
  else window.open(href, "_blank", "noopener");
}

registerSlots(DIAGRAM_LANGUAGE, {
  fill(slot, content) {
    // The slot stays empty until the first draw, so it is offered again meanwhile.
    if (latest.has(slot)) return;
    latest.set(slot, content);
    slot.addEventListener("click", openLink);
    void draw(slot);
  },
  update(slot, content) {
    latest.set(slot, content);
    void draw(slot);
  },
});
