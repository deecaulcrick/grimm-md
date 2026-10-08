import { Plugin, TextSelection } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet, type EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Pencil, X, createElement, type IconNode } from "lucide";

interface Preview {
  title: string;
  description: string;
  image: string;
  site: string;
  icon: string;
}

const inTauri = "__TAURI_INTERNALS__" in window;
const BARE_URL = /^https?:\/\/\S+$/;
const STORAGE_KEY = "linkPreviews";
const MAX_STORED = 150;

const stored: Record<string, Preview> = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
const pending = new Map<string, Promise<Preview>>();

function fallback(url: string): Preview {
  const { hostname, origin } = new URL(url);
  return { title: url, description: "", image: "", site: hostname.replace(/^www\./, ""), icon: `${origin}/favicon.ico` };
}

function parsePreview(html: string, pageUrl: string, requested: string): Preview {
  const base = fallback(pageUrl);
  // DOMParser documents are inert: nothing in the fetched page runs or loads.
  const page = new DOMParser().parseFromString(html, "text/html");
  const meta = (...names: string[]) => {
    for (const name of names) {
      const content = page
        .querySelector(`meta[property="${name}"], meta[name="${name}"]`)
        ?.getAttribute("content")
        ?.trim();
      if (content) return content;
    }
    return "";
  };
  const resolve = (value: string | null | undefined) => {
    if (!value) return "";
    try {
      const resolved = new URL(value, pageUrl);
      return /^https?:$/.test(resolved.protocol) ? resolved.href : "";
    } catch {
      return "";
    }
  };
  return {
    title: meta("og:title", "twitter:title") || page.title.trim() || requested,
    description: meta("og:description", "twitter:description", "description"),
    image: resolve(meta("og:image", "twitter:image")),
    site: meta("og:site_name") || base.site,
    icon: resolve(page.querySelector('link[rel~="icon"]')?.getAttribute("href")) || base.icon,
  };
}

function loadPreview(url: string): Promise<Preview> {
  if (stored[url]) return Promise.resolve(stored[url]);
  let request = pending.get(url);
  if (!request) {
    request = (async () => {
      if (!inTauri) return fallback(url);
      try {
        const page = await invoke<{ url: string; html: string }>("fetch_page", { url });
        const preview = parsePreview(page.html, page.url, url);
        stored[url] = preview;
        const keys = Object.keys(stored);
        for (const key of keys.slice(0, Math.max(0, keys.length - MAX_STORED))) delete stored[key];
        localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
        return preview;
      } catch {
        return fallback(url);
      }
    })();
    pending.set(url, request);
  }
  return request;
}

function open(url: string) {
  if (inTauri) openUrl(url).catch(() => {});
  else window.open(url, "_blank", "noopener");
}

function actionButton(node: IconNode, title: string, onClick: () => void) {
  const button = document.createElement("button");
  button.title = title;
  button.append(createElement(node, { "stroke-width": 1.5, class: "lucide" }));
  button.addEventListener("mousedown", (e) => e.preventDefault());
  button.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick();
  });
  return button;
}

function buildCard(url: string, view: EditorView, getPos: () => number | undefined): HTMLElement {
  const card = document.createElement("div");
  card.className = "link-card";
  card.contentEditable = "false";
  card.title = url;

  const body = document.createElement("div");
  body.className = "lc-body";
  const title = document.createElement("div");
  title.className = "lc-title";
  title.textContent = url;
  const description = document.createElement("div");
  description.className = "lc-desc";
  const site = document.createElement("div");
  site.className = "lc-site";
  const icon = document.createElement("img");
  icon.alt = "";
  icon.addEventListener("error", () => icon.remove());
  const siteName = document.createElement("span");
  siteName.textContent = fallback(url).site;
  site.append(icon, siteName);
  body.append(title, description, site);

  // The link itself stays a plain line of markdown; these reach the hidden line.
  const sourceEnd = () => {
    const pos = getPos();
    return pos === undefined ? null : pos - 1;
  };
  const actions = document.createElement("div");
  actions.className = "lc-actions";
  actions.append(
    actionButton(Pencil, "Edit link", () => {
      const pos = sourceEnd();
      if (pos === null) return;
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)));
      view.focus();
    }),
    actionButton(X, "Remove", () => {
      const pos = sourceEnd();
      if (pos === null) return;
      const $pos = view.state.doc.resolve(pos);
      view.dispatch(view.state.tr.delete($pos.before(), $pos.after()));
      view.focus();
    }),
  );

  card.append(body, actions);
  card.addEventListener("click", () => open(url));

  loadPreview(url).then((preview) => {
    title.textContent = preview.title;
    description.textContent = preview.description;
    description.hidden = !preview.description;
    siteName.textContent = preview.site;
    icon.src = preview.icon;
    if (preview.image) {
      const image = document.createElement("img");
      image.className = "lc-image";
      image.alt = "";
      image.addEventListener("error", () => image.remove());
      image.src = preview.image;
      card.insertBefore(image, actions);
    }
  });
  return card;
}

/**
 * Shows a preview card in place of any top-level paragraph that is nothing
 * but a URL. The document is untouched, so the markdown stays a plain link;
 * the raw line reappears whenever the cursor is inside it.
 */
export const linkCards = $prose(
  () =>
    new Plugin({
      props: {
        decorations(state) {
          const decorations: Decoration[] = [];
          const { from, to } = state.selection;
          state.doc.forEach((node, offset) => {
            if (node.type.name !== "paragraph") return;
            const url = node.textContent.trim();
            if (!BARE_URL.test(url) || !URL.canParse(url)) return;
            const end = offset + node.nodeSize;
            if (from <= end && to >= offset) return;
            decorations.push(
              Decoration.node(offset, end, { class: "link-card-source" }),
              Decoration.widget(end, (view, getPos) => buildCard(url, view, getPos), {
                key: `link-card:${url}`,
                side: -1,
                ignoreSelection: true,
                stopEvent: () => true,
              }),
            );
          });
          return DecorationSet.create(state.doc, decorations);
        },
      },
    }),
);
