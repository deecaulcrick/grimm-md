const HANDLE = ".milkdown-table-block .cell-handle";
const DRAG_THRESHOLD = 4;
// The table's own drag-over handling is throttled; give its last update time to land.
const SETTLE_MS = 40;

const dragEvent = (type: string, at: PointerEvent) =>
  new DragEvent(type, { clientX: at.clientX, clientY: at.clientY, bubbles: true, cancelable: true });

/**
 * Makes the row and column handles of tables draggable. The editor moves rows
 * and columns in response to native drag events, which never fire here because
 * the app window keeps native drag and drop for files dropped from outside. So
 * a pointer drag on a handle is replayed to the table as those drag events.
 */
export function installTableDrag() {
  // A real drag must not start: it would be swallowed half way through.
  document.addEventListener(
    "dragstart",
    (e) => {
      if (!e.isTrusted || !(e.target instanceof Element) || !e.target.closest(HANDLE)) return;
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );

  document.addEventListener(
    "pointerdown",
    (down) => {
      if (down.button !== 0 || !(down.target instanceof Element)) return;
      const handle = down.target.closest<HTMLElement>(HANDLE);
      if (!handle || down.target.closest(".button-group")) return;
      let dragging = false;
      let last = down;

      const move = (e: PointerEvent) => {
        last = e;
        if (!dragging) {
          if (Math.hypot(e.clientX - down.clientX, e.clientY - down.clientY) < DRAG_THRESHOLD) return;
          dragging = true;
          document.body.classList.add("dragging-block");
          handle.dispatchEvent(dragEvent("dragstart", down));
        }
        window.dispatchEvent(dragEvent("dragover", e));
      };
      const stop = (drop: boolean) => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", cancel);
        window.removeEventListener("keydown", key, true);
        if (!dragging) return;
        // The click that ends the drag would otherwise re-select the old row or column.
        const swallow = (e: MouseEvent) => e.stopPropagation();
        window.addEventListener("click", swallow, true);
        // A quick flick can end before the table has registered where it went.
        requestAnimationFrame(() => {
          if (drop) window.dispatchEvent(dragEvent("dragover", last));
          window.setTimeout(() => {
            window.removeEventListener("click", swallow, true);
            if (drop) window.dispatchEvent(dragEvent("drop", last));
            window.dispatchEvent(dragEvent("dragend", last));
            document.body.classList.remove("dragging-block");
          }, SETTLE_MS);
        });
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
    },
    true,
  );
}
