import { imageUrl } from "./images";
import { storedPreview } from "./linkCards";

// The test address until the real share domain is set up. Setting "shareOrigin"
// in localStorage points the app at another server, such as a local one.
const DEFAULT_ORIGIN = "https://grimm-test.thekynelab.com";
const origin = () => localStorage.getItem("shareOrigin") ?? DEFAULT_ORIGIN;

/** Where shared pages live, as shown to the user. */
export const shareHost = () => new URL(origin()).host;

const STORAGE_KEY = "shares";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const BARE_URL = /^https?:\/\/\S+$/;
// The address of each image in the Markdown, with or without angle brackets.
const IMAGE = /!\[[^\]]*\]\(\s*(?:<([^>]+)>|([^)\s]+))/g;

export interface Appearance {
  theme: string;
  font: string;
  size: string;
  width: string;
  /** Grimm's drawings at the top of the page. */
  illustrations: boolean;
}

export interface ShareInput {
  path: string;
  markdown: string;
  title: string;
  appearance: Appearance;
}

/**
 * What the app remembers about a shared note. The token is the only way to
 * update or remove the link, so it is kept here and never in the note itself,
 * where it could leak through a synced folder or a git repository.
 */
export interface ShareRecord {
  id: string;
  url: string;
  token: string;
  expiresAt: number | null;
  sharedAt: number;
  /** Fingerprint of what was shared, to tell when the note has changed since. */
  fingerprint: string;
}

export interface PublishResult {
  record: ShareRecord;
  /** Local images left out because they were missing, too large or unreadable. */
  skippedImages: number;
}

const records: Record<string, ShareRecord> = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
const persist = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(records));

export const shareRecord = (path: string): ShareRecord | null => {
  const record = records[path];
  return record && (record.expiresAt === null || record.expiresAt > Date.now()) ? record : null;
};

/** Keeps a note's link when the note is renamed or moved: the record follows its path. */
export function moveShare(from: string, to: string) {
  if (!records[from]) return;
  records[to] = records[from];
  delete records[from];
  persist();
}

async function sha256(data: string | ArrayBuffer): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface SharedPage {
  path: string;
  record: ShareRecord;
}

/** Every note this Mac has shared whose link has not expired, newest first. */
export function sharedPages(): SharedPage[] {
  return Object.keys(records)
    .flatMap((path) => {
      const record = shareRecord(path);
      return record ? [{ path, record }] : [];
    })
    .sort((a, b) => b.record.sharedAt - a.record.sharedAt);
}

export interface ShareStatus {
  status: "live" | "expired" | "removed" | "missing";
  title: string;
  updatedAt: number;
  expiresAt: number | null;
}

/**
 * Asks the server about a shared note. A link that no longer works is
 * forgotten here too. Null means the server could not be reached.
 */
export async function shareStatus(path: string): Promise<ShareStatus | null> {
  const record = records[path];
  if (!record) return null;
  let status: ShareStatus;
  try {
    status = await request<ShareStatus>("GET", `/api/shares/${record.id}`, undefined, record.token);
  } catch (error) {
    if (!(error instanceof ShareError && error.status === 404)) return null;
    status = { status: "missing", title: "", updatedAt: 0, expiresAt: null };
  }
  if (status.status !== "live") {
    delete records[path];
    persist();
  }
  return status;
}

export const fingerprint = (input: ShareInput) => {
  // Drawings on is how pages were published before the setting existed, so
  // leaving it out then keeps those pages from looking out of date.
  const { illustrations, ...look } = input.appearance;
  return sha256(JSON.stringify([input.markdown, illustrations ? look : input.appearance]));
};

class ShareError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: BodyInit, token?: string, contentType = "application/json"): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${origin()}${path}`, {
      method,
      body,
      headers: { ...(body ? { "Content-Type": contentType } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
  } catch {
    throw new ShareError("Couldn’t reach the share server. Check your connection and try again.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ShareError(data.error ?? `The share server answered with an error (${response.status}).`, response.status);
  return data as T;
}

interface LocalImage {
  hash: string;
  blob: Blob;
}

/** Reads every local image the note shows, keyed by the address written in the Markdown. */
async function collectImages(markdown: string, notePath: string) {
  const images = new Map<string, LocalImage>();
  let skipped = 0;
  const sources = new Set([...markdown.matchAll(IMAGE)].map((m) => (m[1] ?? m[2]).trim()));
  for (const src of sources) {
    if (/^(https?:|data:)/i.test(src)) continue;
    const url = await imageUrl(src, notePath);
    // Unchanged means the file could not be found or is not an image.
    if (url === src) {
      skipped++;
      continue;
    }
    try {
      const blob = await (await fetch(url)).blob();
      if (blob.size === 0 || blob.size > MAX_IMAGE_BYTES) {
        skipped++;
        continue;
      }
      images.set(src, { hash: await sha256(await blob.arrayBuffer()), blob });
    } catch {
      skipped++;
    }
  }
  return { images, skipped };
}

/** The link-card previews already fetched for URLs that sit on a line of their own. */
function collectPreviews(markdown: string) {
  const previews: Record<string, unknown> = {};
  for (const line of markdown.split("\n")) {
    const url = line.trim();
    const preview = BARE_URL.test(url) ? storedPreview(url) : undefined;
    if (preview) previews[url] = preview;
  }
  return previews;
}

interface ShareResponse {
  id: string;
  url: string;
  version: number;
  expiresAt: number | null;
  token?: string;
  uploads: { hash: string; url: string }[];
}

/** Creates a link for the note, or updates the one it already has. */
export async function publish(input: ShareInput): Promise<PublishResult> {
  const { images, skipped } = await collectImages(input.markdown, input.path);
  const body = JSON.stringify({
    markdown: input.markdown,
    title: input.title,
    appearance: input.appearance,
    previews: collectPreviews(input.markdown),
    images: Object.fromEntries([...images].map(([src, image]) => [src, { hash: image.hash, bytes: image.blob.size }])),
  });

  const existing = shareRecord(input.path);
  let response: ShareResponse | null = null;
  let token = existing?.token ?? "";
  if (existing) {
    try {
      response = await request<ShareResponse>("PUT", `/api/shares/${existing.id}`, body, token);
    } catch (error) {
      // The old link expired or was removed: share the note afresh.
      if (!(error instanceof ShareError && (error.status === 403 || error.status === 404))) throw error;
    }
  }
  if (!response) {
    response = await request<ShareResponse>("POST", "/api/shares", body);
    token = response.token ?? "";
  }

  const blobs = new Map([...images.values()].map((image) => [image.hash, image.blob]));
  for (const upload of response.uploads) {
    const blob = blobs.get(upload.hash);
    if (blob) await request("PUT", new URL(upload.url).pathname, blob, token, blob.type || "application/octet-stream");
  }

  const record: ShareRecord = {
    id: response.id,
    url: response.url,
    token,
    expiresAt: response.expiresAt,
    sharedAt: Date.now(),
    fingerprint: await fingerprint(input),
  };
  records[input.path] = record;
  persist();
  return { record, skippedImages: skipped };
}

/** Takes the note's link down. */
export async function unshare(path: string) {
  const record = records[path];
  if (!record) return;
  try {
    await request("DELETE", `/api/shares/${record.id}`, undefined, record.token);
  } catch (error) {
    // Already gone from the server: forgetting it here is all that is left to do.
    if (!(error instanceof ShareError && (error.status === 403 || error.status === 404))) throw error;
  }
  delete records[path];
  persist();
}
