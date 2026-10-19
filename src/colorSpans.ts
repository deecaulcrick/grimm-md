/**
 * Coloured text and highlights are plain inline HTML in the Markdown:
 * `<span data-color="rose">…</span>` for a text colour and
 * `<mark data-color="amber">…</mark>` for a highlight (other Markdown apps
 * show the mark as an ordinary highlight). To remark the tags are separate
 * HTML nodes around the text; this gathers each pair and what it wraps into
 * one `textColor` or `highlight` node. No dependencies, so the share server
 * can use it too.
 */
export const COLORS = ["rose", "coral", "amber", "olive", "teal", "sky", "iris", "plum", "slate"] as const;
export type ColorName = (typeof COLORS)[number];

const VALID = new Set<string>(COLORS);
export const isColor = (value: string) => VALID.has(value);

const OPEN = /^<(span|mark) data-color="([a-z]+)">$/;
const KIND = { span: "textColor", mark: "highlight" } as const;

export interface ColorNode {
  type: string;
  value?: string;
  color?: string;
  children?: ColorNode[];
  data?: Record<string, unknown>;
}

export function gatherColorSpans(node: ColorNode) {
  const children = node.children;
  if (!children) return;
  for (const child of children) gatherColorSpans(child);
  // Tags pair up only among siblings, so a colour wrapping a highlight (or the
  // reverse) is gathered again inside, once the outer pair is a node.
  for (let i = 0; i < children.length; i++) {
    const open = children[i].type === "html" ? children[i].value?.match(OPEN) : null;
    if (!open || !VALID.has(open[2])) continue;
    const tag = open[1] as keyof typeof KIND;
    let depth = 0;
    let end = -1;
    for (let j = i + 1; j < children.length; j++) {
      const value = children[j].type === "html" ? (children[j].value ?? "") : "";
      if (value.startsWith(`<${tag}`)) depth++;
      else if (value === `</${tag}>` && depth-- === 0) {
        end = j;
        break;
      }
    }
    if (end < 0) continue;
    const gathered: ColorNode = { type: KIND[tag], color: open[2], children: children.slice(i + 1, end) };
    gatherColorSpans(gathered);
    children.splice(i, end - i + 1, gathered);
  }
}
