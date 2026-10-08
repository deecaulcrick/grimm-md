# Folio

A clean markdown editor for macOS, built with Tauri and Milkdown.

- `npm run tauri dev` — run in development
- `npm run tauri build` — build `src-tauri/target/release/bundle/macos/Folio.app`

| Shortcut | Action |
| --- | --- |
| ⌘N | New tab |
| ⌘W | Close tab |
| ⇧⌘] / ⇧⌘[ | Next / previous tab |
| ⇧⌘\ | Toggle split view |
| ⌘O / ⇧⌘O | Open file / folder |
| ⌘S / ⇧⌘S | Save / Save as |
| ⌘/ | Toggle Document ↔ Markdown source |
| ⌘\ | Toggle sidebar |

⌘-click a file in the sidebar to open it in the other pane. Themes live in `src/themes.ts`.

## Embeds

- **Link cards** — a URL alone on its own line is shown as a preview card. The file still contains just the link.
- **HTML embeds** — a fenced code block with the language `embed` is rendered as live HTML (including `<iframe>`s) in a sandboxed frame. Insert one with `/` → HTML embed.
