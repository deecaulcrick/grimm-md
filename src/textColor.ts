import { commandsCtx, editorViewCtx, remarkStringifyOptionsCtx } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import { $command, $markSchema, $remark } from "@milkdown/kit/utils";

import { gatherColorSpans, isColor, type ColorNode } from "./colorSpans";

/**
 * Text colour and highlight, two marks that can sit on the same text. In the
 * file they are inline HTML (see colorSpans.ts), so a note stays ordinary
 * Markdown: `<span data-color>` for the colour, `<mark data-color>` for the
 * highlight.
 */
export { COLORS } from "./colorSpans";

export type ColorKind = "textColor" | "highlight";
const TAG: Record<ColorKind, string> = { textColor: "span", highlight: "mark" };

export const colorRemark = $remark("colorSpans", () => () => (tree: unknown) => gatherColorSpans(tree as ColorNode));

const colorMark = (kind: ColorKind) =>
  $markSchema(kind, () => ({
    attrs: { color: { default: "amber" } },
    parseDOM: [
      {
        tag: `${TAG[kind]}[data-color]`,
        getAttrs: (dom) => {
          const color = (dom as HTMLElement).dataset.color ?? "";
          return isColor(color) ? { color } : false;
        },
      },
    ],
    toDOM: (mark) => [TAG[kind], { "data-color": mark.attrs.color }, 0],
    parseMarkdown: {
      match: (node) => node.type === kind,
      runner: (state, node, markType) => {
        state.openMark(markType, { color: node.color as string });
        state.next(node.children);
        state.closeMark(markType);
      },
    },
    toMarkdown: {
      match: (mark) => mark.type.name === kind,
      runner: (state, mark) => {
        state.withMark(mark, kind, undefined, { color: mark.attrs.color });
      },
    },
  }));

export const textColorSchema = colorMark("textColor");
export const highlightSchema = colorMark("highlight");
const schemas = { textColor: textColorSchema, highlight: highlightSchema };

/** Sets the selection's colour or highlight; an empty colour takes it off. */
export const setColorCommand = $command(
  "SetColor",
  (ctx) =>
    ({ kind, color }: { kind: ColorKind; color: string } = { kind: "textColor", color: "" }) =>
    (state, dispatch) => {
      const { from, to, empty } = state.selection;
      if (empty) return false;
      const type = schemas[kind].type(ctx);
      const tr = state.tr.removeMark(from, to, type);
      if (color && isColor(color)) tr.addMark(from, to, type.create({ color }));
      dispatch?.(tr.scrollIntoView());
      return true;
    },
);

/** Writes the gathered nodes back out as the inline HTML they came from. */
export function configureTextColor(ctx: Ctx) {
  const write = (kind: ColorKind) => (node: ColorNode, _parent: unknown, state: any, info: any) =>
    `<${TAG[kind]} data-color="${node.color}">${state.containerPhrasing(node, info)}</${TAG[kind]}>`;
  ctx.update(remarkStringifyOptionsCtx, (options) => ({
    ...options,
    handlers: { ...options.handlers, textColor: write("textColor"), highlight: write("highlight") },
  }));
}

export const textColor = [colorRemark, textColorSchema, highlightSchema, setColorCommand].flat();

/** The colour of one kind on the whole selection, or "" when there is none or it is mixed. */
export function selectionColor(ctx: Ctx, kind: ColorKind): string {
  const view = ctx.get(editorViewCtx);
  const type = schemas[kind].type(ctx);
  const { from, to } = view.state.selection;
  let color: string | null = null;
  let mixed = false;
  view.state.doc.nodesBetween(from, to, (node) => {
    if (!node.isText) return;
    const found = type.isInSet(node.marks)?.attrs.color ?? "";
    if (color === null) color = found;
    else if (color !== found) mixed = true;
  });
  return mixed ? "" : (color ?? "");
}

export const applyColor = (ctx: Ctx, kind: ColorKind, color: string) =>
  ctx.get(commandsCtx).call(setColorCommand.key, { kind, color });
