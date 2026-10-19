// Draws Grimm's brand assets from the shared illustrations (src/illustrations.ts)
// and the traced g (brand/g.path): the app icon and every size Tauri needs, the
// mark used in the app, the share server's link preview, a social card, the DMG
// background, the README banner and a sticker.
//
//   npm run brand
//
// Writes into this repo, and into ../grimm-share when it is checked out beside it.
import { Resvg } from "@resvg/resvg-js";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";
import * as art from "../src/illustrations.ts";

const root = resolve(import.meta.dirname, "..");
const out = (path) => resolve(root, path);
const P = art.PALETTE;
const G = readFileSync(out("brand/g.path"), "utf8").trim();

const render = (svg, width) =>
  new Resvg(svg, { fitTo: { mode: "width", value: width }, font: { loadSystemFonts: true, defaultFontFamily: "Georgia" } })
    .render()
    .asPng();

// ---------- pieces ----------

const ROUGH = `<filter id="rough" x="-5%" y="-5%" width="110%" height="110%">
  <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="4"/>
  <feDisplacementMap in="SourceGraphic" scale="6"/>
</filter>`;
/** Sparse paint flecks in a colour, kept inside whatever they are applied to. */
const speckle = (id, [r, g, b], seed, density) => `<filter id="${id}" x="0" y="0" width="100%" height="100%">
  <feTurbulence type="fractalNoise" baseFrequency="0.05 0.012" numOctaves="3" seed="${seed}"/>
  <feColorMatrix type="matrix" values="0 0 0 0 ${r}  0 0 0 0 ${g}  0 0 0 0 ${b}  16 0 0 0 ${-density}"/>
  <feComposite in2="SourceGraphic" operator="in"/>
</filter>`;
const FILTERS = `${ROUGH}${speckle("speckle-y", [0.965, 0.66, 0.13], 11, 11.4)}${speckle("speckle-o", [0.91, 0.31, 0.16], 7, 10.6)}`;

const gPath = (fill, dx = 0, dy = 0, extra = "") =>
  `<path d="${G}" fill="${fill}" fill-rule="evenodd" transform="translate(${dx} ${dy})" ${extra}/>`;

/** The g: orange, with a lavender offset and yellow flecks, in the 1024 icon grid. */
const MARK = `<g filter="url(#rough)">${gPath(P.lavender, -14, 12)}${gPath(P.orange)}</g>
<g filter="url(#rough)">${gPath("#000", 0, 0, 'filter="url(#speckle-y)"')}</g>`;

const BIG_LEAF = "M0,-130 C 78,-70 84,60 0,130 C -84,60 -78,-70 0,-130 Z";
const bigLeaf = (x, y, rot, scale) => `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${scale})" filter="url(#rough)">
  <path d="${BIG_LEAF}" fill="${P.lavender}" transform="translate(-10 8)"/>
  <path d="${BIG_LEAF}" fill="${P.yellow}"/>
  <path d="${BIG_LEAF}" fill="#000" filter="url(#speckle-o)"/>
</g>`;
const ICON_LEAVES = bigLeaf(180, 190, -40, 1.05) + bigLeaf(300, 130, 12, 0.7) + bigLeaf(870, 845, 140, 1.1) + bigLeaf(745, 930, 100, 0.75);

// Flat blacks, no gradients: the base, and a darker black for things that sit on it.
const BASE = "#2F2F2F";
const DEEP = "#242424";

/** Places one of the shared drawings inside a larger SVG. */
const place = (svg, x, y, width, height) =>
  svg.replace("<svg ", `<svg x="${x}" y="${y}" width="${width}" height="${height}" `);

// ---------- the icon ----------

async function icon() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
<defs>${FILTERS}
  <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#000" flood-opacity="0.28"/></filter>
  <clipPath id="squircle"><rect x="100" y="100" width="824" height="824" rx="185"/></clipPath>
</defs>
<g filter="url(#shadow)"><rect x="100" y="100" width="824" height="824" rx="185" fill="#000"/></g>
<g clip-path="url(#squircle)">
  <rect x="100" y="100" width="824" height="824" fill="${BASE}"/>
  ${ICON_LEAVES}${MARK}
</g></svg>`;
  writeFileSync(out("app-icon.png"), render(svg, 1024));
  execSync("npx tauri icon app-icon.png", { cwd: root, stdio: "ignore" });
  // Tauri also writes phone icons, which this desktop app does not use.
  for (const dir of ["android", "ios"]) rmSync(out(`src-tauri/icons/${dir}`), { recursive: true, force: true });
  if (existsSync(out("promo/public"))) writeFileSync(out("promo/public/icon.png"), render(svg, 1024));

  // The same art cropped to a full square with no transparency, so chat apps
  // show no corners around the link preview.
  const share = resolve(root, "../grimm-share/assets");
  if (existsSync(share)) {
    const full = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="100 100 824 824"><defs>${FILTERS}</defs>
<rect x="100" y="100" width="824" height="824" fill="${BASE}"/>${ICON_LEAVES}${MARK}</svg>`;
    await sharp(render(full, 256)).flatten({ background: "#000" }).jpeg({ quality: 88 }).toFile(`${share}/preview.jpg`);
  }
}

/** The g alone, as used on the onboarding screen. */
function mark() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="270 205 500 615"><defs>${FILTERS}</defs>${MARK}</svg>`;
  writeFileSync(out("src/assets/grimm-mark.svg"), svg);
  return svg;
}

// ---------- wide pieces ----------

const SERIF = `font-family="New York, Iowan Old Style, Georgia, serif"`;
const SANS = `font-family="SF Pro Text, Helvetica Neue, Helvetica, Arial, sans-serif"`;

/** The g and the name side by side, as a lockup. */
const lockup = (x, y, size, colour = P.cream) => `<svg x="${x}" y="${y - size * 0.82}" width="${size * 0.81}" height="${size}" viewBox="270 205 500 615">${MARK}</svg>
<text x="${x + size * 0.98}" y="${y}" ${SERIF} font-size="${size * 0.78}" font-weight="600" fill="${colour}" letter-spacing="-1">Grimm</text>`;

/** A 1200×630 card for link previews and the repository's social image. */
async function socialCard() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><defs>${FILTERS}</defs>
<rect width="1200" height="630" fill="${BASE}"/>
${place(art.cornerRightScene(), 820, 0, 380, 263)}
${place(art.tourScene(), 760, 300, 420, 229)}
${place(art.meadowScene(), 0, 560, 1200, 70)}
${lockup(96, 300, 132)}
<text x="100" y="390" ${SANS} font-size="34" fill="${P.cream}" fill-opacity="0.78">A quiet Markdown editor for macOS.</text>
<text x="100" y="440" ${SANS} font-size="26" fill="${P.cream}" fill-opacity="0.5">Plain .md files on your own disk.</text>
</svg>`;
  await sharp(render(svg, 1200)).jpeg({ quality: 90 }).toFile(out("brand/social-card.jpg"));
}

/** The README's banner. */
async function banner() {
  const tile = (scene, x, fill, label, ink = "#fff") =>
    `<rect x="${x}" y="226" width="250" height="132" rx="18" fill="${fill}"/>${place(scene, x + 70, 230, 176, 116)}<text x="${x + 18}" y="${226 + 34}" ${SANS} font-size="17" font-weight="600" fill="${ink}">${label}</text>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="420" viewBox="0 0 1280 420"><defs>${FILTERS}</defs>
<rect width="1280" height="420" fill="${BASE}"/>
${lockup(96, 150, 104)}
<text x="100" y="196" ${SANS} font-size="26" fill="${P.cream}" fill-opacity="0.72">A quiet Markdown editor for macOS.</text>
<rect x="84" y="214" width="1084" height="156" rx="26" fill="${DEEP}"/>${tile(art.tourScene(), 96, P.orange, "Live formatting")}${tile(art.folderScene(), 366, P.navy, "Your folders")}${tile(art.fileScene(), 636, P.green, "Plain Markdown")}${tile(art.writeScene(), 906, P.yellow, "Just write", P.navy)}
${place(art.cornerRightScene(), 1000, 0, 280, 194)}
</svg>`;
  await sharp(render(svg, 2560)).jpeg({ quality: 88 }).toFile(out("brand/readme-banner.jpg"));
}

/**
 * The window behind the disk image: the app on the left, Applications on the
 * right, a painted arrow between them. Finder draws its own labels in black,
 * so the page is light.
 */
function dmgBackground() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="660" height="400" viewBox="0 0 660 400"><defs>${FILTERS}</defs>
<rect width="660" height="400" fill="${P.cream}"/>
${place(art.cornerLeftScene(), -20, -10, 180, 125)}
${place(art.cornerRightScene(), 500, -10, 180, 125)}
<g filter="url(#rough)">
  <path d="M262,176 C 300,150 360,150 398,172" stroke="${P.orange}" stroke-width="9" stroke-linecap="round" fill="none"/>
  <path d="M384,150 L404,176 L374,186" stroke="${P.orange}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
</g>
<text x="330" y="300" text-anchor="middle" ${SANS} font-size="14" fill="${P.navy}" fill-opacity="0.7">Drag Grimm into Applications</text>
${place(art.meadowScene(), 0, 334, 660, 66)}
</svg>`;
  writeFileSync(out("brand/dmg-background.png"), render(svg, 660));
  writeFileSync(out("brand/dmg-background@2x.png"), render(svg, 1320));
}

/** The g with a white die-cut border, for printing. */
async function sticker(markSvg) {
  const inner = markSvg.replace("<svg ", `<svg x="80" y="80" width="840" height="1033" `);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1193" viewBox="0 0 1000 1193"><defs>
  <filter id="cut" x="-10%" y="-10%" width="120%" height="120%">
    <feMorphology in="SourceAlpha" operator="dilate" radius="34" result="grown"/>
    <feGaussianBlur in="grown" stdDeviation="6" result="soft"/>
    <feComponentTransfer in="soft" result="edge"><feFuncA type="discrete" tableValues="0 1"/></feComponentTransfer>
    <feFlood flood-color="#fff"/><feComposite in2="edge" operator="in" result="white"/>
    <feMerge><feMergeNode in="white"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
</defs><g filter="url(#cut)">${inner}</g></svg>`;
  writeFileSync(out("brand/sticker.png"), render(svg, 1000));
}

await icon();
const markSvg = mark();
await socialCard();
await banner();
dmgBackground();
await sticker(markSvg);
console.log("Brand assets written.");
