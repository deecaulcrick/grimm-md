import { languages } from "@codemirror/language-data";
import type { Ctx } from "@milkdown/kit/ctx";
import { commandsCtx } from "@milkdown/kit/core";
import {
  addBlockTypeCommand,
  clearTextInCurrentBlockCommand,
  codeBlockSchema,
} from "@milkdown/kit/preset/commonmark";
import { DIAGRAM_LANGUAGE, diagramLanguage } from "./diagrams";
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
