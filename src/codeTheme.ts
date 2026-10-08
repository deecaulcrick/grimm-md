import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

// Every colour is a CSS variable, so code blocks follow the active app theme
// instead of carrying a fixed light or dark palette.
const highlight = HighlightStyle.define([
  { tag: [t.comment, t.meta], color: "var(--text-3)", fontStyle: "italic" },
  { tag: [t.keyword, t.modifier, t.operatorKeyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword], color: "var(--syn-keyword)" },
  { tag: [t.string, t.special(t.string), t.regexp, t.escape], color: "var(--syn-string)" },
  { tag: [t.number, t.bool, t.null, t.atom, t.unit], color: "var(--syn-literal)" },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.className, t.typeName, t.tagName, t.namespace], color: "var(--syn-name)" },
  { tag: [t.propertyName, t.attributeName, t.labelName], color: "var(--text)" },
  { tag: [t.punctuation, t.bracket, t.operator, t.separator], color: "var(--text-2)" },
  { tag: t.heading, fontWeight: "600" },
  { tag: t.strong, fontWeight: "600" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: [t.link, t.url], color: "var(--link)", textDecoration: "underline" },
  { tag: t.invalid, color: "var(--crepe-color-error)" },
]);

export const codeTheme = [
  EditorView.theme({
    "&": { color: "var(--text)", backgroundColor: "transparent" },
    ".cm-content": { caretColor: "var(--accent)" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--accent)" },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
      { backgroundColor: "var(--selection)" },
    ".cm-activeLine": { backgroundColor: "transparent" },
    ".cm-gutters": { backgroundColor: "transparent", color: "var(--text-3)", border: "none" },
    ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--text-2)" },
    ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": { backgroundColor: "var(--active)", outline: "none" },
    ".cm-selectionMatch": { backgroundColor: "var(--hover)" },
  }),
  syntaxHighlighting(highlight),
];
