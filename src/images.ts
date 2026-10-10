import { $remark } from "@milkdown/kit/utils";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";

const inTauri = "__TAURI_INTERNALS__" in window;
// Two letters at least, so a Windows drive ("C:\pics\a.png") is not taken for a scheme.
const SCHEME = /^[a-z][a-z\d+.-]+:/i;
const ABSOLUTE = /^([\\/]|[a-z]:[\\/])/i;

// Local images the backend has already let the webview load, by absolute path.
const allowed = new Map<string, string>();

/** Resolves "." and ".." segments, the way the file system would. */
function normalize(path: string): string {
  const parts: string[] = [];
  for (const part of path.split(/[\\/]/)) {
    if (part === "..") parts.pop();
    else if (part !== "." && (part || !parts.length)) parts.push(part);
  }
  return parts.join("/") || "/";
}

/** The file on disk a Markdown image address points at, or null for one on the web. */
function localPath(src: string, notePath: string | null): string | null {
  let path = src.trim();
  if (/^file:\/\//i.test(path)) path = path.replace(/^file:\/\/(localhost)?/i, "");
  else if (SCHEME.test(path) || path.startsWith("//")) return null;
  try {
    // Markdown addresses carry spaces and the like as %20.
    path = decodeURIComponent(path);
  } catch {
    // A stray "%" in a file name: the address is already the literal path.
  }
  if (ABSOLUTE.test(path)) return normalize(path);
  // A relative address means nothing until the note has a folder.
  if (!path || !notePath) return null;
  return normalize(`${notePath.replace(/[\\/][^\\/]*$/, "")}/${path}`);
}

/**
 * Maps an image address from the Markdown to one the webview can load. Local
 * files, relative to the note or absolute, go through Tauri's asset protocol;
 * everything else is returned as it is. The Markdown itself is never changed.
 */
export function imageUrl(src: string, notePath: string | null): string | Promise<string> {
  if (!inTauri) return src;
  const path = localPath(src, notePath);
  if (!path) return src;
  const known = allowed.get(path);
  if (known) return known;
  return invoke("allow_image", { path }).then(
    () => {
      const url = convertFileSrc(path);
      allowed.set(path, url);
      return url;
    },
    // Missing or not an image: left alone, so it shows as any broken image does.
    () => src,
  );
}

/** Writes an image into the `assets` folder beside the note; returns its path relative to the note. */
export async function saveImage(file: File, notePath: string): Promise<string> {
  return invoke<string>("save_image", new Uint8Array(await file.arrayBuffer()), {
    headers: { note: encodeURIComponent(notePath), name: encodeURIComponent(file.name) },
  });
}

interface MarkdownNode {
  type: string;
  alt?: string | null;
  title?: string | null;
  children?: MarkdownNode[];
}

function fillImageText(node: MarkdownNode) {
  if (node.type === "image" || node.type === "image-block") {
    node.alt ??= "";
    node.title ??= "";
  }
  node.children?.forEach(fillImageText);
}

/**
 * Markdown gives an image without a title (`![](a.png)`, the usual way to write
 * one) a null title. The editor only accepts text there and silently drops the
 * whole image otherwise, so a missing title or alt text is read as an empty one.
 */
export const imageTitles = $remark("imageTitles", () => () => fillImageText);
