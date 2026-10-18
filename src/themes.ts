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
  {
    id: "lilac",
    name: "Lilac",
    scheme: "light",
    bg: "#F8F6FC",
    sidebar: "#EEEAF7",
    surface: "#FFFFFF",
    text: "#2A2440",
    accent: "#8B6FD1",
    button: "#7A5FC4",
    onButton: "#FFFFFF",
  },
  // Bordeaux ink on a neutral, low-glare page.
  {
    id: "paper",
    name: "Paper",
    scheme: "light",
    bg: "#FAF8F4",
    sidebar: "#F0EDE6",
    surface: "#FFFFFF",
    text: "#5B0015",
    accent: "#4F86D0",
    button: "#5B0015",
    onButton: "#FAF8F4",
  },
  // Warm and easy on the eyes for long reading.
  {
    id: "sepia",
    name: "Sepia",
    scheme: "light",
    bg: "#F3EAD8",
    sidebar: "#E9DDC5",
    surface: "#FBF5E9",
    text: "#2E2116",
    accent: "#AE4F24",
    button: "#2E2116",
    onButton: "#F3EAD8",
  },
  // Low saturation, nothing competes with the words.
  {
    id: "fog",
    name: "Fog",
    scheme: "light",
    bg: "#ECEEEF",
    sidebar: "#E0E3E5",
    surface: "#F7F8F9",
    text: "#1E2327",
    accent: "#4F7185",
    button: "#33424C",
    onButton: "#F7F8F9",
  },
  // Maximum legibility: bright rooms, low vision.
  {
    id: "contrast",
    name: "Contrast",
    scheme: "light",
    bg: "#FFFFFF",
    sidebar: "#EFEFEF",
    surface: "#FFFFFF",
    text: "#000000",
    accent: "#0040E0",
    button: "#000000",
    onButton: "#FFFFFF",
  },
  // Risograph print: blue ink, fluorescent pink headings.
  {
    id: "riso",
    name: "Riso",
    scheme: "light",
    bg: "#FBF3EA",
    sidebar: "#F3E6D6",
    surface: "#FFFAF4",
    text: "#1E2A78",
    heading: "#D3204F",
    accent: "#E8365F",
    button: "#1E2A78",
    onButton: "#FBF3EA",
  },
  // Pink page, magenta headings, violet accent.
  {
    id: "bubblegum",
    name: "Bubblegum",
    scheme: "light",
    bg: "#FFE9F1",
    sidebar: "#FFD6E5",
    surface: "#FFF5F9",
    text: "#3A0D2E",
    heading: "#C2185B",
    accent: "#6A4CFF",
    button: "#3A0D2E",
    onButton: "#FFE9F1",
  },
  // Pale teal with a coral accent.
  {
    id: "lagoon",
    name: "Lagoon",
    scheme: "light",
    bg: "#DFF5F1",
    sidebar: "#C8EBE5",
    surface: "#F0FBF9",
    text: "#08343A",
    heading: "#0B6E69",
    accent: "#E8553A",
    button: "#08343A",
    onButton: "#DFF5F1",
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
  {
    id: "merlot",
    name: "Merlot",
    scheme: "dark",
    bg: "#2A0A12",
    sidebar: "#3A0D18",
    surface: "#4A1522",
    text: "#F7F2E0",
    accent: "#80AEE8",
    button: "#F7F2E0",
    onButton: "#5B0015",
  },
  {
    id: "iron",
    name: "Iron",
    scheme: "dark",
    bg: "#222A2A",
    sidebar: "#1A2121",
    surface: "#2E3838",
    text: "#E2DAC2",
    accent: "#4FBBBC",
    button: "#F39120",
    onButton: "#222A2A",
  },
  {
    id: "midnight",
    name: "Midnight",
    scheme: "dark",
    bg: "#0B1026",
    sidebar: "#111836",
    surface: "#1B2450",
    text: "#E3E8FA",
    accent: "#F5D06F",
    button: "#8FA8FF",
    onButton: "#0B1026",
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
  // Maximum legibility in the dark.
  {
    id: "contrast-dark",
    name: "Contrast Dark",
    scheme: "dark",
    bg: "#000000",
    sidebar: "#0E0E0E",
    surface: "#171717",
    text: "#FFFFFF",
    accent: "#FFD400",
    button: "#FFFFFF",
    onButton: "#000000",
  },
  // Deep green, peach headings, marigold accent.
  {
    id: "jungle",
    name: "Jungle",
    scheme: "dark",
    bg: "#0F3D2E",
    sidebar: "#0A3024",
    surface: "#174A39",
    text: "#F2EDDC",
    heading: "#FFB4A2",
    accent: "#F9C74F",
    button: "#F9C74F",
    onButton: "#0F3D2E",
  },
  // Deep violet, mint headings, hot pink accent.
  {
    id: "ultraviolet",
    name: "Ultraviolet",
    scheme: "dark",
    bg: "#2B1055",
    sidebar: "#220C45",
    surface: "#38176A",
    text: "#F3EAFF",
    heading: "#7CFFCB",
    accent: "#FF7AC6",
    button: "#7CFFCB",
    onButton: "#2B1055",
  },
];

// Themes that were removed, mapped to the closest one still offered, so saved
// settings and shared pages keep a similar look.
const RETIRED: Record<string, string> = {
  bordeaux: "paper",
  crimson: "paper",
  lime: "meadow",
  mint: "meadow",
  plum: "midnight",
  ember: "graphite",
  bloom: "nightshift",
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
