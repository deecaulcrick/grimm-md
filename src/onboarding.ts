import { ArrowRight, createElement } from "lucide";
import markUrl from "./assets/grimm-mark.svg?url";
import { fileScene, folderScene, tourScene, writeScene } from "./illustrations";

export interface OnboardingActions {
  /** Opens the welcome note and the feature list. */
  tour: () => Promise<void>;
  openFolder: () => Promise<void>;
  openFile: () => Promise<void>;
  /** Starts a blank note. */
  write: () => Promise<void>;
}

const arrow = () => createElement(ArrowRight, { class: "lucide", "stroke-width": 1.75, "aria-hidden": "true" });

const TOUR_ART = tourScene();
const FOLDER_ART = folderScene();
const FILE_ART = fileScene();
const WRITE_ART = writeScene();

function card(className: string, title: string, cta: string, illustration: string, action: () => Promise<void>) {
  const button = document.createElement("button");
  button.className = `ob-card ${className}`;
  const text = document.createElement("span");
  text.className = "ob-card-text";
  const strong = document.createElement("strong");
  strong.textContent = title;
  const link = document.createElement("span");
  link.className = "ob-cta";
  link.append(cta, arrow());
  text.append(strong, link);
  const artEl = document.createElement("span");
  artEl.className = "ob-art";
  artEl.innerHTML = illustration;
  button.append(text, artEl);
  button.addEventListener("click", () => void action());
  return button;
}

/** The four ways in, as painted cards. Shared by the welcome screen and an empty pane. */
export function startPanel(actions: OnboardingActions): HTMLElement {
  const row = document.createElement("div");
  row.className = "ob-row";
  row.append(
    card("ob-file", "Open a Markdown file", "Choose a file", FILE_ART, actions.openFile),
    card("ob-write", "Just start writing", "New note", WRITE_ART, actions.write),
  );
  const panel = document.createElement("div");
  panel.className = "ob-panel";
  panel.append(
    card("ob-tour", "Start with the welcome note", "Take the tour", TOUR_ART, actions.tour),
    card("ob-folder", "Open a folder of notes", "Browse", FOLDER_ART, actions.openFolder),
    row,
  );
  return panel;
}

/** The g, a heading and a line under it. */
export function startHead(title: string, text: string, id?: string): HTMLElement {
  const head = document.createElement("header");
  head.className = "ob-head";
  const mark = Object.assign(document.createElement("img"), { className: "ob-mark", src: markUrl, alt: "", width: 44, height: 54 });
  const h1 = Object.assign(document.createElement("h1"), { textContent: title });
  if (id) h1.id = id;
  const p = document.createElement("p");
  p.innerHTML = text;
  head.append(mark, h1, p);
  return head;
}

let root: HTMLElement | null = null;

/** The welcome screen over the whole window, from the Help menu. */
export function showOnboarding(actions: OnboardingActions) {
  if (root) return;
  const screen = document.createElement("div");
  root = screen;
  screen.id = "onboarding";
  screen.setAttribute("role", "dialog");
  screen.setAttribute("aria-modal", "true");
  screen.setAttribute("aria-labelledby", "ob-title");

  // Each card closes the screen first, so a cancelled dialog still lands in the app.
  const closing = (action: () => Promise<void>) => async () => {
    close();
    await action();
  };
  const panel = startPanel({
    tour: closing(actions.tour),
    openFolder: closing(actions.openFolder),
    openFile: closing(actions.openFile),
    write: closing(actions.write),
  });
  const head = startHead(
    "Welcome to Grimm",
    "A quiet place to write Markdown. Your notes stay plain <code>.md</code> files on your own disk.",
    "ob-title",
  );

  const column = document.createElement("div");
  column.className = "ob-column";
  column.append(head, panel);
  screen.append(column);
  document.body.append(screen);

  // Escape just closes it.
  screen.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    close();
  });

  requestAnimationFrame(() => screen.classList.add("in"));
  panel.querySelector<HTMLElement>(".ob-card")?.focus();
}

function close() {
  const el = root;
  root = null;
  if (!el) return;
  el.classList.remove("in");
  el.classList.add("out");
  // Removed after the fade, or straight away if animations are off.
  const done = () => el.remove();
  el.addEventListener("transitionend", done, { once: true });
  window.setTimeout(done, 400);
}
