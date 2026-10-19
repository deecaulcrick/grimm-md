import { languages } from "@codemirror/language-data";
import type { Ctx } from "@milkdown/kit/ctx";
import { commandsCtx } from "@milkdown/kit/core";
import {
  addBlockTypeCommand,
  clearTextInCurrentBlockCommand,
  codeBlockSchema,
} from "@milkdown/kit/preset/commonmark";
import { DIAGRAM_LANGUAGE, diagramLanguage } from "./diagrams";
import { copiedIcon } from "./editorIcons";
import { EMBED_LANGUAGE, embedLanguage } from "./htmlEmbed";
import { slotFor } from "./previewSlots";

/** Fence languages whose blocks show a live result in place of their code. */
const PREVIEWED = new Set([EMBED_LANGUAGE, DIAGRAM_LANGUAGE]);

export const codeLanguages = [...languages, embedLanguage, diagramLanguage];

export function renderPreview(language: string, content: string): string | null {
  const kind = language.toLowerCase();
  if (!PREVIEWED.has(kind) || !content.trim()) return null;
  return slotFor(kind, content);
}

/** Turns the current block into an empty code block of this language. */
export const insertCodeBlock = (language: string) => (ctx: Ctx) => {
  const commands = ctx.get(commandsCtx);
  commands.call(clearTextInCurrentBlockCommand.key);
  commands.call(addBlockTypeCommand.key, {
    nodeType: codeBlockSchema.type(ctx),
    attrs: { language },
  });
};

// The copy button says nothing once it has copied, so it briefly shows a tick
// and "Copied". Its icon and label are swapped in place and put back after.
const COPIED_FOR = 1400;
const copied = new WeakMap<HTMLElement, { timer: number; restore: () => void }>();

document.addEventListener("click", (event) => {
  const button = (event.target as Element | null)?.closest<HTMLElement>(".milkdown-code-block .copy-button");
  const icon = button?.querySelector<HTMLElement>(".milkdown-icon");
  const label = button && [...button.childNodes].find((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
  if (!button || !icon || !label) return;
  let state = copied.get(button);
  if (state) {
    window.clearTimeout(state.timer);
  } else {
    const [iconHtml, text] = [icon.innerHTML, label.textContent];
    state = {
      timer: 0,
      restore: () => {
        icon.innerHTML = iconHtml;
        label.textContent = text;
        button.classList.remove("copied");
        copied.delete(button);
      },
    };
    copied.set(button, state);
    icon.innerHTML = copiedIcon;
    label.textContent = "Copied";
    button.classList.add("copied");
  }
  state.timer = window.setTimeout(state.restore, COPIED_FOR);
});
