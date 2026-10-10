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
}

export const THEMES: Theme[] = [
  {
    id: "bordeaux",
    name: "Bordeaux",
    scheme: "light",
    bg: "#F7F2E0",
    sidebar: "#EFE8D0",
    surface: "#FFFBEE",
    text: "#5B0015",
    accent: "#80AEE8",
    button: "#5B0015",
    onButton: "#F7F2E0",
  },
  {
    id: "lime",
    name: "Lime",
    scheme: "light",
    bg: "#F8FBE8",
    sidebar: "#E6F1B8",
    surface: "#FDFFF3",
    text: "#17243F",
    accent: "#9CC700",
    button: "#D4F23B",
    onButton: "#17243F",
  },
  {
    id: "blossom",
    name: "Blossom",
    scheme: "light",
    bg: "#FFF5F7",
    sidebar: "#FBE8EC",
    surface: "#FFFFFF",
    text: "#4A1D2C",
    accent: "#D4517A",
    button: "#C9446E",
    onButton: "#FFFFFF",
  },
  {
    id: "glacier",
    name: "Glacier",
    scheme: "light",
    bg: "#F3F8FE",
    sidebar: "#E4EEFA",
    surface: "#FFFFFF",
    text: "#16294A",
    accent: "#3B7BDB",
    button: "#2F6BCB",
    onButton: "#FFFFFF",
  },
  {
    id: "mint",
    name: "Mint",
    scheme: "light",
    bg: "#F3FAF4",
    sidebar: "#E3F1E6",
    surface: "#FFFFFF",
    text: "#173524",
    accent: "#2E9460",
    button: "#257A4E",
    onButton: "#FFFFFF",
  },
  {
    id: "crimson",
    name: "Crimson",
    scheme: "light",
    bg: "#FFFFFF",
    sidebar: "#F6F5F4",
    surface: "#FFFFFF",
    text: "#1C1616",
    accent: "#f01a21",
    button: "#d60e15",
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
  {
    id: "plum",
    name: "Plum",
    scheme: "dark",
    bg: "#1F1629",
    sidebar: "#291D36",
    surface: "#362747",
    text: "#EFE6F5",
    accent: "#E58FB8",
    button: "#C9A7F5",
    onButton: "#1F1629",
  },
  {
    id: "ember",
    name: "Ember",
    scheme: "dark",
    bg: "#0C0C0C",
    sidebar: "#141414",
    surface: "#1E1E1E",
    text: "#F1ECE6",
    accent: "#ff6a00",
    button: "#ff6a00",
    onButton: "#0C0C0C",
  },
];

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
}
