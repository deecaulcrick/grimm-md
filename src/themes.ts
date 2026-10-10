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
    bg: "#F7F3E6",
    sidebar: "#EEE9D8",
    surface: "#FFFDF5",
    text: "#17243F",
    accent: "#788CE3",
    button: "#DFF478",
    onButton: "#17243F",
  },
  {
    id: "cobalt",
    name: "Cobalt",
    scheme: "light",
    bg: "#F7F6F1",
    sidebar: "#EDEDE8",
    surface: "#FFFFFF",
    text: "#14264F",
    accent: "#2F62F0",
    button: "#2F62F0",
    onButton: "#FFFFFF",
  },
  {
    id: "grimm",
    name: "Grimm",
    scheme: "dark",
    bg: "#002428",
    sidebar: "#105243",
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
