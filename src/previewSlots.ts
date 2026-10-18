/**
 * Live previews for code blocks, such as HTML embeds and diagrams.
 *
 * The editor sanitizes whatever a preview returns, which strips iframes and
 * scripts, and it rebuilds the preview whenever the returned HTML changes. So a
 * preview is only an empty slot, and each kind of block fills its slots from
 * here. The block being typed in keeps its slot, so the editor sees an
 * unchanged preview and leaves it alone while its renderer updates it in place.
 */

export interface SlotRenderer {
  /** Fills a slot that has just appeared. */
  fill(slot: HTMLElement, content: string): void;
  /** Shows new content in a slot that is already filled, as it is typed. */
  update(slot: HTMLElement, content: string): void;
}

const SLOT_CLASS = "preview-slot";
const MAX_SLOTS = 300;

const renderers = new Map<string, SlotRenderer>();
const slots = new Map<string, { kind: string; content: string }>();
let nextSlot = 0;

export function registerSlots(kind: string, renderer: SlotRenderer) {
  renderers.set(kind, renderer);
}

/** The preview for a block of this kind, to return from the editor's renderPreview. */
export function slotFor(kind: string, content: string): string {
  const block = document.activeElement?.closest<HTMLElement>(".milkdown-code-block");
  const editing = block?.querySelector<HTMLElement>(`.${SLOT_CLASS}`);
  const current = editing?.dataset.slot;
  if (editing && current !== undefined && slots.get(current)?.kind === kind) {
    slots.set(current, { kind, content });
    renderers.get(kind)?.update(editing, content);
    return slotHtml(kind, current);
  }
  const id = String(nextSlot++);
  slots.set(id, { kind, content });
  if (slots.size > MAX_SLOTS) slots.delete(slots.keys().next().value!);
  if (block) queueMicrotask(() => keepEditing(block));
  return slotHtml(kind, id);
}

const slotHtml = (kind: string, id: string) => `<div class="${SLOT_CLASS} ${kind}-slot" data-slot="${id}"></div>`;

function fillSlots() {
  for (const slot of document.querySelectorAll<HTMLElement>(`.${SLOT_CLASS}:empty`)) {
    const entry = slots.get(slot.dataset.slot ?? "");
    if (entry) renderers.get(entry.kind)?.fill(slot, entry.content);
  }
}

new MutationObserver(fillSlots).observe(document.body, { childList: true, subtree: true });

/**
 * Previews show only their result by default, which is right for a note being
 * read. But a block gets its first preview on the first character typed into
 * it, and hiding the code at that moment would take the editor away mid-word.
 */
function keepEditing(block: HTMLElement) {
  if (!block.querySelector(".codemirror-host.hidden")) return;
  block.querySelector<HTMLButtonElement>(".preview-toggle-button")?.click();
  queueMicrotask(() => block.querySelector<HTMLElement>(".cm-content")?.focus());
}
