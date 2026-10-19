import { toggleLinkCommand } from "@milkdown/kit/component/link-tooltip";
import { commandsCtx, editorViewCtx } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import {
  createCodeBlockCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleStrongCommand,
  turnIntoTextCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
} from "@milkdown/kit/preset/commonmark";
import { toggleStrikethroughCommand } from "@milkdown/kit/preset/gfm";
import { Plugin, TextSelection, type EditorState } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import {
  Bold,
  ChevronRight,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link,
  List,
  ListOrdered,
  ListTodo,
  RemoveFormatting,
  SquareCode,
  Strikethrough,
  TextQuote,
  Type,
  createElement,
  type IconNode,
} from "lucide";

import { COLORS, applyColor, selectionColor, type ColorKind } from "./textColor";

const icon = (node: IconNode) => createElement(node, { "stroke-width": 1.5, class: "lucide" });

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

interface BlockKind {
  label: string;
  icon: IconNode;
  is: (state: EditorState) => boolean;
  run: (ctx: Ctx) => void;
}

const call = (ctx: Ctx, key: any, payload?: unknown) => ctx.get(commandsCtx).call(key, payload);

/** The block around the selection's start, and the list item holding it, if any. */
function blockAt(state: EditorState) {
  const $from = state.selection.$from;
  const parent = $from.parent;
  const item = $from.depth > 1 ? $from.node($from.depth - 1) : null;
  const list = $from.depth > 2 ? $from.node($from.depth - 2) : null;
  return { parent, item: item?.type.name === "list_item" ? item : null, list, quote: $from.node(1)?.type.name === "blockquote" };
}

const heading = (level: number) => (state: EditorState) => {
  const { parent } = blockAt(state);
  return parent.type.name === "heading" && parent.attrs.level === level;
};

const BLOCKS: BlockKind[] = [
  {
    label: "Text",
    icon: Type,
    is: (s) => {
      const b = blockAt(s);
      return b.parent.type.name === "paragraph" && !b.item && !b.quote;
    },
    run: (ctx) => call(ctx, turnIntoTextCommand.key),
  },
  { label: "Heading 1", icon: Heading1, is: heading(1), run: (ctx) => call(ctx, wrapInHeadingCommand.key, 1) },
  { label: "Heading 2", icon: Heading2, is: heading(2), run: (ctx) => call(ctx, wrapInHeadingCommand.key, 2) },
  { label: "Heading 3", icon: Heading3, is: heading(3), run: (ctx) => call(ctx, wrapInHeadingCommand.key, 3) },
  {
    label: "Bulleted list",
    icon: List,
    is: (s) => {
      const b = blockAt(s);
      return b.list?.type.name === "bullet_list" && b.item?.attrs.checked == null;
    },
    run: (ctx) => call(ctx, wrapInBulletListCommand.key),
  },
  {
    label: "Numbered list",
    icon: ListOrdered,
    is: (s) => blockAt(s).list?.type.name === "ordered_list",
    run: (ctx) => call(ctx, wrapInOrderedListCommand.key),
  },
  {
    label: "To-do list",
    icon: ListTodo,
    is: (s) => blockAt(s).item?.attrs.checked != null,
    run: (ctx) => {
      call(ctx, wrapInBulletListCommand.key);
      const view = ctx.get(editorViewCtx);
      const { $from } = view.state.selection;
      for (let d = $from.depth; d > 0; d--) {
        const node = $from.node(d);
        if (node.type.name !== "list_item") continue;
        view.dispatch(view.state.tr.setNodeMarkup($from.before(d), undefined, { ...node.attrs, checked: false }));
        break;
      }
    },
  },
  { label: "Quote", icon: TextQuote, is: (s) => blockAt(s).quote, run: (ctx) => call(ctx, wrapInBlockquoteCommand.key) },
  {
    label: "Code",
    icon: SquareCode,
    is: (s) => blockAt(s).parent.type.name === "code_block",
    run: (ctx) => call(ctx, createCodeBlockCommand.key),
  },
];

interface MarkButton {
  label: string;
  icon: IconNode;
  mark: string;
  run: (ctx: Ctx) => void;
}

const MARKS: MarkButton[] = [
  { label: "Bold ⌘B", icon: Bold, mark: "strong", run: (ctx) => call(ctx, toggleStrongCommand.key) },
  { label: "Italic ⌘I", icon: Italic, mark: "emphasis", run: (ctx) => call(ctx, toggleEmphasisCommand.key) },
  { label: "Strikethrough", icon: Strikethrough, mark: "strike_through", run: (ctx) => call(ctx, toggleStrikethroughCommand.key) },
  { label: "Inline code", icon: Code, mark: "inlineCode", run: (ctx) => call(ctx, toggleInlineCodeCommand.key) },
  { label: "Link", icon: Link, mark: "link", run: (ctx) => call(ctx, toggleLinkCommand.key) },
];

class SelectionToolbar {
  readonly dom = el("div", "sel-toolbar");
  #sub: HTMLElement | null = null;

  constructor(
    readonly ctx: Ctx,
    readonly view: EditorView,
  ) {
    // Keep the editor's selection and focus while the toolbar is used.
    this.dom.addEventListener("mousedown", (e) => e.preventDefault());
    this.dom.hidden = true;
    document.body.append(this.dom);
    view.dom.addEventListener("blur", this.#onBlur);
    this.update(view);
  }

  #onBlur = () => {
    // A click inside the toolbar keeps focus (see mousedown above), so a blur means elsewhere.
    setTimeout(() => !this.view.hasFocus() && this.hide(), 0);
  };

  hide() {
    this.dom.hidden = true;
    this.#closeSub();
  }

  #visible(state: EditorState) {
    const sel = state.selection;
    if (!(sel instanceof TextSelection) || sel.empty || !this.view.editable) return false;
    if (sel.$from.parent.type.spec.code || sel.$to.parent.type.spec.code) return false;
    return this.view.hasFocus();
  }

  update(view: EditorView, prev?: EditorState) {
    const state = view.state;
    if (!this.#visible(state)) return this.hide();
    if (prev && prev.doc.eq(state.doc) && prev.selection.eq(state.selection) && !this.dom.hidden) return;
    this.#render(state);
    this.dom.hidden = false;
    this.#place();
  }

  #place() {
    const { from, to } = this.view.state.selection;
    const start = this.view.coordsAtPos(from);
    const end = this.view.coordsAtPos(to);
    const width = this.dom.offsetWidth;
    const height = this.dom.offsetHeight;
    const left = Math.min(Math.max(8, start.left), window.innerWidth - width - 8);
    const above = start.top - height - 8;
    this.dom.style.left = `${left}px`;
    this.dom.style.top = `${above > 8 ? above : end.bottom + 8}px`;
  }

  #render(state: EditorState) {
    this.#closeSub();
    const current = BLOCKS.find((b) => b.is(state)) ?? BLOCKS[0];

    const kind = el("button", "sel-kind");
    kind.append(icon(current.icon), el("span", "", current.label), icon(ChevronRight));
    kind.addEventListener("click", () => this.#openBlocks(kind, state));

    const grid = el("div", "sel-grid");
    const color = selectionColor(this.ctx, "textColor");
    const highlight = selectionColor(this.ctx, "highlight");
    const colorBtn = el("button", "sel-btn sel-color");
    colorBtn.title = "Colour and highlight";
    // The letter takes the text colour and the bar under it the highlight.
    const glyph = el("span", "sel-color-glyph", "A");
    if (color) glyph.dataset.ink = color;
    const bar = el("i", "sel-color-bar");
    if (highlight) bar.dataset.tint = highlight;
    glyph.append(bar);
    colorBtn.append(glyph);
    colorBtn.addEventListener("click", () => this.#openColors(colorBtn, color, highlight));
    grid.append(colorBtn);

    const { from, to } = state.selection;
    for (const item of MARKS) {
      const button = el("button", "sel-btn");
      button.title = item.label;
      button.append(icon(item.icon));
      const type = state.schema.marks[item.mark];
      button.classList.toggle("on", Boolean(type && state.doc.rangeHasMark(from, to, type)));
      button.addEventListener("click", () => {
        item.run(this.ctx);
        if (item.mark === "link") this.hide();
      });
      grid.append(button);
    }

    const clear = el("button", "sel-btn");
    clear.title = "Clear formatting";
    clear.append(icon(RemoveFormatting));
    clear.addEventListener("click", () => {
      const { state, dispatch } = this.view;
      const tr = state.tr;
      for (const type of Object.values(state.schema.marks)) tr.removeMark(from, to, type);
      dispatch(tr);
    });
    grid.append(clear);

    this.dom.replaceChildren(kind, el("div", "sel-sep"), grid);
  }

  #closeSub() {
    this.#sub?.remove();
    this.#sub = null;
  }

  #openSub(anchor: HTMLElement, build: (menu: HTMLElement) => void) {
    const reopen = this.#sub?.dataset.for === anchor.className;
    this.#closeSub();
    if (reopen) return;
    const menu = el("div", "sel-sub");
    menu.dataset.for = anchor.className;
    menu.addEventListener("mousedown", (e) => e.preventDefault());
    build(menu);
    document.body.append(menu);
    this.#sub = menu;
    const box = this.dom.getBoundingClientRect();
    const rect = anchor.getBoundingClientRect();
    const right = box.right + 6;
    const left = right + menu.offsetWidth > window.innerWidth - 8 ? box.left - menu.offsetWidth - 6 : right;
    const top = Math.min(rect.top, window.innerHeight - menu.offsetHeight - 8);
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${Math.max(8, top)}px`;
  }

  #openBlocks(anchor: HTMLElement, state: EditorState) {
    this.#openSub(anchor, (menu) => {
      menu.append(el("div", "sel-label", "Turn into"));
      for (const kind of BLOCKS) {
        const row = el("button", "sel-row");
        row.append(icon(kind.icon), el("span", "", kind.label));
        row.classList.toggle("on", kind.is(state));
        row.addEventListener("click", () => {
          kind.run(this.ctx);
          this.#closeSub();
        });
        menu.append(row);
      }
    });
  }

  #openColors(anchor: HTMLElement, color: string, highlight: string) {
    const name = (c: string) => c[0].toUpperCase() + c.slice(1);
    const swatches = (kind: ColorKind, current: string) => {
      const grid = el("div", "swatches");
      for (const value of ["", ...COLORS]) {
        const button = el("button", `swatch ${kind === "textColor" ? "ink" : "tint"}`);
        button.title = value ? name(value) : kind === "textColor" ? "Default colour" : "No highlight";
        if (value) button.dataset[kind === "textColor" ? "ink" : "tint"] = value;
        else button.classList.add("none");
        if (kind === "textColor") button.textContent = "A";
        button.classList.toggle("on", current === value);
        button.addEventListener("click", () => {
          applyColor(this.ctx, kind, value);
          this.#closeSub();
        });
        grid.append(button);
      }
      return grid;
    };
    this.#openSub(anchor, (menu) => {
      menu.classList.add("sel-colors");
      menu.append(el("div", "sel-label", "Text"), swatches("textColor", color));
      menu.append(el("div", "sel-label", "Highlight"), swatches("highlight", highlight));
    });
  }

  destroy() {
    this.view.dom.removeEventListener("blur", this.#onBlur);
    this.#closeSub();
    this.dom.remove();
  }
}

/** A Notion-style menu over selected text: block type, colour and inline formatting. */
export const selectionToolbar = $prose((ctx) => new Plugin({ view: (view) => new SelectionToolbar(ctx, view) }));
