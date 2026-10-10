/**
 * A document outline shown as a stack of short lines at the edge of a pane,
 * one per heading. Hovering the stack opens the list of headings; clicking
 * one scrolls to it. The line (and list entry) for the section currently in
 * view is highlighted.
 */
const HEADINGS = "h1, h2, h3, h4, h5, h6";
const MIN_HEADINGS = 2;
// Only headings in the text itself: the editor's menus use heading tags for their group titles.
const isDocHeading = (h: HTMLElement) => !!h.closest(".ProseMirror") && !h.closest("pre, table");
// How far below the top of the view a heading can be and still count as "current".
const ACTIVE_OFFSET = 96;

export class Outline {
  readonly el = document.createElement("nav");
  private lines = document.createElement("div");
  private panel = document.createElement("div");
  private scroller: HTMLElement | null = null;
  private headings: HTMLElement[] = [];
  private active = -1;

  constructor() {
    this.el.className = "toc";
    this.el.hidden = true;
    this.lines.className = "toc-lines";
    this.panel.className = "toc-panel";
    this.el.append(this.lines, this.panel);
    this.el.addEventListener("mouseenter", () => {
      this.panel.children[this.active]?.scrollIntoView({ block: "nearest" });
    });
  }

  /** Rebuilds the outline for a document; pass null to hide it. */
  show(scroller: HTMLElement | null, content: HTMLElement | null) {
    this.scroller = scroller;
    this.headings = scroller && content ? [...content.querySelectorAll<HTMLElement>(HEADINGS)].filter(isDocHeading) : [];
    this.el.hidden = this.headings.length < MIN_HEADINGS;
    if (this.el.hidden) return void this.lines.replaceChildren();

    const levels = this.headings.map((h) => Number(h.tagName[1]));
    const top = Math.min(...levels);
    this.lines.replaceChildren(
      ...levels.map((level) => {
        const line = document.createElement("i");
        line.dataset.depth = String(Math.min(level - top, 3));
        return line;
      }),
    );
    this.panel.replaceChildren(
      ...this.headings.map((heading, i) => {
        const item = document.createElement("button");
        item.className = "toc-item";
        item.dataset.depth = String(Math.min(levels[i] - top, 3));
        item.textContent = heading.textContent?.trim() || "Untitled";
        item.addEventListener("click", () => this.scrollTo(heading));
        return item;
      }),
    );
    this.active = -1;
    this.sync();
  }

  /** Updates which heading is marked as current; call when the document scrolls. */
  sync() {
    if (!this.scroller || this.el.hidden) return;
    const edge = this.scroller.getBoundingClientRect().top + ACTIVE_OFFSET;
    let current = 0;
    this.headings.forEach((heading, i) => {
      if (heading.getBoundingClientRect().top <= edge) current = i;
    });
    const atEnd = this.scroller.scrollTop + this.scroller.clientHeight >= this.scroller.scrollHeight - 2;
    if (atEnd && this.scroller.scrollTop > 0) current = this.headings.length - 1;
    if (current === this.active) return;
    for (const list of [this.lines, this.panel]) {
      list.children[this.active]?.classList.remove("active");
      list.children[current]?.classList.add("active");
    }
    this.active = current;
  }

  private scrollTo(heading: HTMLElement) {
    if (!this.scroller) return;
    const offset = heading.getBoundingClientRect().top - this.scroller.getBoundingClientRect().top;
    this.scroller.scrollTo({ top: this.scroller.scrollTop + offset - 32, behavior: "smooth" });
  }
}
