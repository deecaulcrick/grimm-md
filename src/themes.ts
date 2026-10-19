export interface Theme {
  id: string;
  name: string;
  scheme: "light" | "dark";
  bg: string;
  sidebar: string;
  surface: string;
  text: string;
  accent: string;
  button: string;
  onButton: string;
  /** Heading colour; defaults to the text colour. */
  heading?: string;
}

export const THEMES: Theme[] = [
  // The light side of Graphite: neutral greys, soft graphite ink, a blue accent.
  {
    id: "paper",
    name: "Paper",
    scheme: "light",
    bg: "#F6F6F5",
    sidebar: "#ECECEA",
    surface: "#FFFFFF",
    text: "#232427",
    accent: "#2F66D0",
    button: "#232427",
    onButton: "#F6F6F5",
  },
  {
    id: "meadow",
    name: "Meadow",
    scheme: "light",
    bg: "#F4FAFF",
    sidebar: "#CFE7FB",
    surface: "#FFFFFF",
    text: "#12385C",
    accent: "#3FA034",
    button: "#2B8AE6",
    onButton: "#FFFFFF",
  },
  // Bear-style: a white page, soft charcoal text and a warm red accent.
  {
    id: "fog",
    name: "Fog",
    scheme: "light",
    bg: "#FFFFFF",
    sidebar: "#F3F3F2",
    surface: "#FFFFFF",
    text: "#363636",
    heading: "#262626",
    accent: "#DD4C4F",
    button: "#CF3337",
    onButton: "#FFFFFF",
  },
  {
    id: "grimm",
    name: "Grimm",
    scheme: "dark",
    bg: "#002428",
    sidebar: "#083830",
    surface: "#17604F",
    text: "#F4EFD6",
    accent: "#F8E347",
    button: "#F8E347",
    onButton: "#002428",
  },
  // Neutral dark; softened text avoids halation.
  {
    id: "graphite",
    name: "Graphite",
    scheme: "dark",
    bg: "#1C1D1F",
    sidebar: "#151618",
    surface: "#27292C",
    text: "#DDDAD3",
    accent: "#7AA7FF",
    button: "#DDDAD3",
    onButton: "#1C1D1F",
  },
  // Warm near-black with folk-art orange and blue, for late-night writing.
  {
    id: "nightshift",
    name: "Nightshift",
    scheme: "dark",
    bg: "#1A1410",
    sidebar: "#130E0B",
    surface: "#261D17",
    text: "#E6D3B3",
    accent: "#F06438",
    button: "#4A72B8",
    onButton: "#FFFFFF",
  },
];

// Themes that were removed, mapped to the closest one still offered, so saved
// settings and shared pages keep a similar look.
const RETIRED: Record<string, string> = {
  bordeaux: "paper",
  crimson: "paper",
  sepia: "paper",
  contrast: "fog",
  lilac: "meadow",
  lime: "meadow",
  mint: "meadow",
  riso: "meadow",
  bubblegum: "meadow",
  lagoon: "meadow",
  iron: "graphite",
  ember: "nightshift",
  "contrast-dark": "graphite",
  merlot: "grimm",
  midnight: "grimm",
  plum: "grimm",
  bloom: "nightshift",
  jungle: "grimm",
  ultraviolet: "grimm",
};

export function findTheme(id: string | null): Theme | undefined {
  const resolved = id && (RETIRED[id] ?? id);
  return THEMES.find((t) => t.id === resolved);
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.dataset.scheme = theme.scheme;
  root.style.setProperty("--bg", theme.bg);
  root.style.setProperty("--sidebar", theme.sidebar);
  root.style.setProperty("--surface", theme.surface);
  root.style.setProperty("--text", theme.text);
  root.style.setProperty("--accent", theme.accent);
  root.style.setProperty("--button", theme.button);
  root.style.setProperty("--on-button", theme.onButton);
  if (theme.heading) root.style.setProperty("--heading", theme.heading);
  else root.style.removeProperty("--heading");
}
