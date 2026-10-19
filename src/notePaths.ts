/**
 * The pure part of renaming and moving notes: checking names, working out new
 * paths, and finding and rewriting the images a note links to. Nothing here
 * touches the disk, so it can be tested on its own (notePaths.test.ts).
 */

export const MARKDOWN_EXTENSION = /\.(md|markdown|mdx|mdown)$/i;

export const dirOf = (path: string) => path.replace(/[\\/][^\\/]*$/, "");
export const baseOf = (path: string) => path.split(/[\\/]/).pop() ?? path;

/** Why a note can't have this name, or null when it can. */
export function nameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "A note needs a name";
  if (/[\\/:]/.test(trimmed)) return "Names can’t contain / \\ or :";
  if (trimmed.startsWith(".")) return "Names can’t start with a dot";
  if (trimmed.length > 200) return "That name is too long";
  return null;
}

/** The file name for a typed name: the note keeps its extension unless one was typed. */
export function fileNameFor(name: string, oldPath: string): string {
  const trimmed = name.trim();
  if (MARKDOWN_EXTENSION.test(trimmed)) return trimmed;
  const extension = baseOf(oldPath).match(MARKDOWN_EXTENSION)?.[0] ?? ".md";
  return `${trimmed}${extension}`;
}

export const renamedPath = (path: string, name: string) => `${dirOf(path)}/${fileNameFor(name, path)}`;
export const movedPath = (path: string, dir: string) => `${dir.replace(/[\\/]+$/, "")}/${baseOf(path)}`;

/** A list of paths with one path swapped for another, keeping its place. */
export const remapList = (paths: string[], from: string, to: string) => paths.map((p) => (p === from ? to : p));

/** A record keyed by path, with one key moved to another. */
export function remapKey<T>(record: Record<string, T>, from: string, to: string): Record<string, T> {
  if (!(from in record)) return record;
  const { [from]: value, ...rest } = record;
  return { ...rest, [to]: value };
}

// ---------- images ----------

const SCHEME = /^[a-z][a-z\d+.-]+:/i;

/** Whether an image address points at a file relative to the note. */
export const isLocalRelative = (src: string) => {
  const path = src.trim();
  return Boolean(path) && !SCHEME.test(path) && !path.startsWith("/") && !path.startsWith("//") && !path.startsWith("#");
};

/** The absolute path a relative image address means for a note in `dir`. */
export function resolveRelative(dir: string, src: string): string {
  let path = src.trim();
  try {
    path = decodeURIComponent(path);
  } catch {
    // A stray "%" in a file name: the address is already the literal path.
  }
  const parts: string[] = [];
  for (const part of `${dir}/${path}`.split(/[\\/]/)) {
    if (part === "..") parts.pop();
    else if (part !== "." && (part || !parts.length)) parts.push(part);
  }
  return parts.join("/") || "/";
}

/**
 * Runs `edit` over the Markdown outside code: fenced blocks and inline code
 * spans are left exactly as they are, so an image written as an example in
 * code is never touched.
 */
function outsideCode(markdown: string, edit: (text: string) => string): string {
  const out: string[] = [];
  let fence: string | null = null;
  let prose: string[] = [];
  const flush = () => {
    if (!prose.length) return;
    const text = prose.join("");
    // Inline code spans: a run of backticks up to the same run.
    out.push(text.split(/(`+[^`]*?`+)/).map((piece, i) => (i % 2 ? piece : edit(piece))).join(""));
    prose = [];
  };
  for (const line of markdown.split(/(?<=\n)/)) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/)?.[1];
    if (fence) {
      out.push(line);
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null;
    } else if (marker) {
      flush();
      fence = marker;
      out.push(line);
    } else {
      prose.push(line);
    }
  }
  flush();
  return out.join("");
}

const MARKDOWN_IMAGE = /(!\[(?:[^\]\\]|\\.)*\]\(\s*)(<[^>\n]*>|[^\s)]+)((?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\))/g;
const HTML_IMAGE = /(<img\b[^>]*?\bsrc\s*=\s*)(["'])([^"']*)\2/gi;
const unwrap = (src: string) => (src.startsWith("<") && src.endsWith(">") ? src.slice(1, -1) : src);

/** Every relative image address in the note, once each, in order. */
export function localImageRefs(markdown: string): string[] {
  const found = new Set<string>();
  outsideCode(markdown, (text) => {
    for (const m of text.matchAll(MARKDOWN_IMAGE)) found.add(unwrap(m[2]));
    for (const m of text.matchAll(HTML_IMAGE)) found.add(m[3]);
    return text;
  });
  return [...found].filter(isLocalRelative);
}

/** The note with image addresses swapped by `map` (old address to new); others are left alone. */
export function rewriteImageRefs(markdown: string, map: Record<string, string>): string {
  return outsideCode(markdown, (text) =>
    text
      .replace(MARKDOWN_IMAGE, (whole, start: string, src: string, end: string) => {
        const next = map[unwrap(src)];
        if (next === undefined) return whole;
        return `${start}${/[\s()]/.test(next) ? `<${next}>` : next}${end}`;
      })
      .replace(HTML_IMAGE, (whole, start: string, quote: string, src: string) => {
        const next = map[src];
        return next === undefined ? whole : `${start}${quote}${next}${quote}`;
      }),
  );
}
