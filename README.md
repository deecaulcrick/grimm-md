# Grimm

A clean markdown editor for macOS, built with Tauri and Milkdown.

- `npm run tauri dev` — run in development
- `npm run tauri build -- --bundles app` — build `src-tauri/target/release/bundle/macos/Grimm.app`

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

## Releasing an update

Installed copies of Grimm check `latest.json` on the newest GitHub release at launch (and from **Grimm → Check for Updates…**), then download, verify and install it.

One-time setup:

1. Push this repo to `github.com/deecaulcrick/grimm` (public — the update endpoint in `src-tauri/tauri.conf.json` points there).
2. Add the update signing key as repository secrets. The key lives outside the repo at `~/.tauri/grimm.key`; it has no password.
   - `gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/grimm.key`
   - `gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --body ""`

For each release:

1. Bump `version` in `src-tauri/tauri.conf.json` (and `package.json`, `src-tauri/Cargo.toml`).
2. Commit, then tag and push: `git tag v0.2.0 && git push origin main --tags`.

The Release workflow builds a universal macOS app, signs the update and publishes the release. Keep `~/.tauri/grimm.key` backed up: updates signed with a different key are rejected by installed copies.
