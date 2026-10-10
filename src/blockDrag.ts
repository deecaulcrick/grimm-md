import type { Node, ResolvedPos } from "@milkdown/kit/prose/model";
import { NodeSelection, Plugin, Selection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";

const DRAG_THRESHOLD = 4;
const SCROLL_EDGE = 48;
const SCROLL_STEP = 14;

interface DropTarget {
  pos: number;
  rect: { left: number; width: number; y: number };
}

const isList = (node: Node) => node.type.name === "bullet_list" || node.type.name === "ordered_list";

/** A block may land beside siblings of the kind it came from, or at the top level. */
function accepts(container: Node, depth: number, sourceParent: Node) {
  return depth === 0 || container.type === sourceParent.type || (isList(container) && isList(sourceParent));
}

function findDrop(view: EditorView, y: number, node: Node, $from: ResolvedPos): DropTarget | null {
  const bounds = view.dom.getBoundingClientRect();
  const top = Math.min(bounds.bottom - 2, Math.max(bounds.top + 2, y));
  const found = view.posAtCoords({ left: bounds.left + bounds.width / 2, top });
  if (!found) return null;
  const $pos = view.state.doc.resolve(found.pos);

  for (let depth = $pos.depth; depth >= 0; depth--) {
    const container = $pos.node(depth);
    if (!accepts(container, depth, $from.parent)) continue;
    let pos: number;
    let index: number;
    let edge: { el: unknown; after: boolean };
    if (depth < $pos.depth) {
      const childPos = $pos.before(depth + 1);
      const child = $pos.node(depth + 1);
      const el = view.nodeDOM(childPos);
      if (!(el instanceof HTMLElement)) continue;
      const box = el.getBoundingClientRect();
      const after = y > box.top + box.height / 2;
      pos = after ? childPos + child.nodeSize : childPos;
      index = $pos.index(depth) + (after ? 1 : 0);
      edge = { el, after };
    } else {
      pos = $pos.pos;
      index = $pos.index(depth);
      edge = $pos.nodeAfter
        ? { el: view.nodeDOM(pos), after: false }
        : { el: $pos.nodeBefore && view.nodeDOM(pos - $pos.nodeBefore.nodeSize), after: true };
    }
    if (!(edge.el instanceof HTMLElement) || !container.canReplaceWith(index, index, node.type)) continue;
    const box = edge.el.getBoundingClientRect();
    return { pos, rect: { left: box.left, width: box.width, y: edge.after ? box.bottom : box.top } };
  }
  return null;
}

/**
 * Dragging a block by its grip. Done with pointer events rather than native
 * drag and drop, which the app window reserves for files dropped from outside.
 */
function attach(view: EditorView) {
  const root = view.dom.parentElement;
  if (!root) return () => {};
  const indicator = document.createElement("div");
  indicator.className = "block-drop";

  const isGrip = (target: EventTarget | null) =>
    target instanceof Element && !!target.closest(".milkdown-block-handle .operation-item:last-child");

  // Image blocks are natively draggable too, which would hijack a pull on their resize bar.
  const onDragStart = (e: DragEvent) => {
    if (!(e.target instanceof Element) || !e.target.closest(".milkdown-block-handle, .milkdown-image-block")) return;
    e.preventDefault();
    e.stopPropagation();
  };

  const onPointerDown = (down: PointerEvent) => {
    if (down.button !== 0 || !isGrip(down.target)) return;
    let dragging: { from: number; to: number; node: Node; el: HTMLElement | null } | null = null;
    let target: DropTarget | null = null;

    const move = (e: PointerEvent) => {
      if (!dragging) {
        if (Math.hypot(e.clientX - down.clientX, e.clientY - down.clientY) < DRAG_THRESHOLD) return;
        // The handle selects its block on mousedown; that selection is what gets moved.
        const selection = view.state.selection;
        if (!(selection instanceof NodeSelection)) return stop(false);
        const el = view.nodeDOM(selection.from);
        dragging = {
          from: selection.from,
          to: selection.to,
          node: selection.node,
          el: el instanceof HTMLElement ? el : null,
        };
        dragging.el?.classList.add("block-dragging");
        document.body.classList.add("dragging-block");
        document.body.append(indicator);
      }
      const scroller = view.dom.closest<HTMLElement>(".doc");
      if (scroller) {
        const box = scroller.getBoundingClientRect();
        if (e.clientY < box.top + SCROLL_EDGE) scroller.scrollTop -= SCROLL_STEP;
        else if (e.clientY > box.bottom - SCROLL_EDGE) scroller.scrollTop += SCROLL_STEP;
      }
      const { from, to, node } = dragging;
      target = findDrop(view, e.clientY, node, view.state.doc.resolve(from));
      // Dropping onto itself, or right where it already sits, moves nothing.
      if (target && target.pos >= from && target.pos <= to) target = null;
      indicator.hidden = !target;
      if (target) {
        indicator.style.left = `${target.rect.left}px`;
        indicator.style.width = `${target.rect.width}px`;
        indicator.style.top = `${target.rect.y - 1}px`;
      }
    };

    const stop = (drop: boolean) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key, true);
      if (!dragging) return;
      dragging.el?.classList.remove("block-dragging");
      document.body.classList.remove("dragging-block");
      indicator.remove();
      if (!drop || !target) return;
      try {
        const tr = view.state.tr.deleteRange(dragging.from, dragging.to);
        const pos = tr.mapping.map(target.pos);
        tr.insert(pos, dragging.node);
        tr.setSelection(Selection.near(tr.doc.resolve(pos + 1)));
        view.dispatch(tr.scrollIntoView());
        view.focus();
      } catch {
        // The block does not fit there after all; leave the document as it was.
      }
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
  };

  root.addEventListener("dragstart", onDragStart, true);
  root.addEventListener("pointerdown", onPointerDown);
  return () => {
    root.removeEventListener("dragstart", onDragStart, true);
    root.removeEventListener("pointerdown", onPointerDown);
    indicator.remove();
  };
}

export const blockDrag = $prose(
  () =>
    new Plugin({
      view: (view) => ({ destroy: attach(view) }),
    }),
);
