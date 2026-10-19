/**
 * Holds the reading position still when a block above it changes height.
 *
 * Code blocks swap between their live form and a plain-text stand-in as they
 * scroll in and out of view, and diagrams, embeds and images settle their
 * height late. Browsers with scroll anchoring hide this, but WebKit has none,
 * so without this the page would jump on its own while being read.
 *
 * The anchor is the first block that starts inside the view. Whenever a block
 * changes size, the page is scrolled so that the anchor stays where it was.
 */
export function anchorScroll(scroller: HTMLElement, content: HTMLElement) {
  // Chromium's own anchoring would correct the same change a second time.
  scroller.style.overflowAnchor = "none";

  const editor = () => content.querySelector<HTMLElement>(".ProseMirror");
  let anchor: Element | null = null;
  let anchorTop = 0;
  // Where the last correction left the page. Its scroll event arrives later,
  // when another block may already have moved the anchor, so it must not pick a new one.
  let ownScroll: number | null = null;

  /**
   * Finds the first block whose top is in view. Hidden blocks, and overlays
   * such as the editor's cursor, do not move with the text, so they are passed over.
   */
  const pickAnchor = () => {
    anchor = null;
    const viewTop = scroller.getBoundingClientRect().top;
    for (const block of editor()?.children ?? []) {
      const box = block.getBoundingClientRect();
      if (box.top < viewTop || (box.height === 0 && box.width === 0)) continue;
      if (/absolute|fixed/.test(getComputedStyle(block).position)) continue;
      anchor = block;
      anchorTop = box.top;
      return;
    }
  };

  /** True when the caret is in this block, which is being typed in and should grow downward. */
  const holdsCaret = (block: Element) => {
    const focus = window.getSelection()?.focusNode;
    return block.contains(document.activeElement) || (focus != null && block.contains(focus));
  };

  const sizes = new ResizeObserver((entries) => {
    const caret = entries.some((entry) => entry.target !== anchor && holdsCaret(entry.target));
    if (anchor?.isConnected && !caret) {
      const shift = anchor.getBoundingClientRect().top - anchorTop;
      if (Math.abs(shift) >= 1) {
        scroller.scrollTop += shift;
        ownScroll = scroller.scrollTop;
      }
    }
    pickAnchor();
  });

  // Watches each top-level block of the editor, including ones it adds later.
  const observed = new Set<Element>();
  const track = () => {
    for (const block of observed) {
      if (block.isConnected) continue;
      sizes.unobserve(block);
      observed.delete(block);
    }
    for (const block of editor()?.children ?? []) {
      if (observed.has(block)) continue;
      observed.add(block);
      sizes.observe(block);
    }
  };

  new MutationObserver((records) => {
    if (records.some((r) => (r.target as Element).matches?.(".ProseMirror, .milkdown, .editor"))) track();
  }).observe(content, { childList: true, subtree: true });
  scroller.addEventListener(
    "scroll",
    () => {
      const own = ownScroll !== null && Math.abs(scroller.scrollTop - ownScroll) < 1;
      ownScroll = null;
      if (!own) pickAnchor();
    },
    { passive: true },
  );
  track();
}
