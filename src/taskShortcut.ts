import { InputRule } from "@milkdown/kit/prose/inputrules";
import { findWrapping } from "@milkdown/kit/prose/transform";
import { $inputRule } from "@milkdown/kit/utils";

/**
 * Typing `[] `, `[ ] ` or `[x] ` at the start of a line makes it a checkbox.
 * The editor's own rule only fires inside an existing list item and insists
 * on the space between the brackets.
 */
export const taskShortcut = $inputRule(
  () =>
    new InputRule(/^\[( ?|x|X)\]\s$/, (state, match, start, end) => {
      const { bullet_list: list, list_item: item } = state.schema.nodes;
      const $start = state.doc.resolve(start);
      if ($start.parent.type.name !== "paragraph") return null;
      const checked = match[1].toLowerCase() === "x";
      const tr = state.tr.delete(start, end);

      const outer = $start.node($start.depth - 1);
      if (outer.type === item) {
        // Only the item's first line can turn the item into a task.
        if (outer.attrs.checked != null || $start.index($start.depth - 1) !== 0) return null;
        return tr.setNodeMarkup($start.before($start.depth - 1), undefined, { ...outer.attrs, checked });
      }

      const range = tr.doc.resolve(start).blockRange();
      const wrapping = range && findWrapping(range, list);
      if (!range || !wrapping) return null;
      tr.wrap(range, wrapping);
      const itemNode = tr.doc.nodeAt(range.start + 1);
      if (itemNode?.type !== item) return null;
      return tr.setNodeMarkup(range.start + 1, undefined, { ...itemNode.attrs, checked });
    }),
);
