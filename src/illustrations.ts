// Grimm's hand-drawn illustrations: flat shapes with brush-roughened edges, a
// lavender offset like a misregistered print, and the brand palette. Each
// drawing is a self-contained SVG string, so the same art serves the app, the
// share pages and the brand assets (scripts/brand.mjs). Kept free of imports
// and non-erasable TypeScript so Node can run it directly.

export const PALETTE = {
  orange: "#E8502A",
  navy: "#22385A",
  green: "#1F9446",
  yellow: "#F6A821",
  lavender: "#8B8FD9",
  sky: "#BEE4E9",
  cream: "#F6EFDF",
  ink: "#0B0C10",
} as const;

const P = PALETTE;

let drawings = 0;

export interface DrawingOptions {
  /** Read out by screen readers; without one the drawing is decorative. */
  title?: string;
  className?: string;
  /** How the drawing fits its box; the SVG default centres it. */
  fit?: string;
  /** Edge roughness; 0 for small sizes where it would only blur. */
  rough?: number;
}

/**
 * Wraps shapes in an SVG with the brush filter. Every drawing gets its own
 * filter id, since a filter inside a hidden element stops working for every
 * other element that shares its id.
 */
export function drawing(viewBox: string, body: string, options: DrawingOptions = {}): string {
  const id = `grimm-rough-${++drawings}`;
  const rough = options.rough ?? 3.5;
  const label = options.title ? `role="img" aria-label="${options.title}"` : `aria-hidden="true"`;
  const cls = options.className ? ` class="${options.className}"` : "";
  const fit = options.fit ? ` preserveAspectRatio="${options.fit}"` : "";
  const filter = rough
    ? `<defs><filter id="${id}" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="2" seed="3"/><feDisplacementMap in="SourceGraphic" scale="${rough}"/></filter></defs>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"${fit}${cls} ${label}>${filter}<g${rough ? ` filter="url(#${id})"` : ""}>${body}</g></svg>`;
}

// ---------- shapes ----------

const LEAF = "M0,-14 C 9,-7 9,7 0,14 C -9,7 -9,-7 0,-14 Z";

/** A leaf, optionally with the lavender offset behind it. */
export const leaf = (x: number, y: number, rot: number, fill: string = P.green, scale = 1, offset = false) =>
  `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${scale})">${
    offset ? `<path d="${LEAF}" fill="${P.lavender}" transform="translate(-3 3)"/>` : ""
  }<path d="${LEAF}" fill="${fill}"/><path d="M0,-10 L0,10" stroke="${P.ink}" stroke-opacity="0.18" stroke-width="1.4"/></g>`;

/** Five round petals around a centre. */
export const flower = (x: number, y: number, petals: string, centre: string, scale = 1, outline = false) => {
  const ring = [0, 72, 144, 216, 288]
    .map((a) => `<ellipse cx="0" cy="-7" rx="4.4" ry="7" transform="rotate(${a})"/>`)
    .join("");
  const paint = outline ? `fill="none" stroke="${petals}" stroke-width="2"` : `fill="${petals}"`;
  return `<g transform="translate(${x} ${y}) scale(${scale})"><g ${paint}>${ring}</g><circle r="3.6" fill="${centre}"/></g>`;
};

/** A stem with leaves up both sides. */
export const sprig = (x: number, y: number, height: number, rot = 0, fill: string = P.green, scale = 1) => {
  const leaves: string[] = [];
  for (let i = 1; i * 16 < height - 6; i++) {
    const side = i % 2 ? -1 : 1;
    leaves.push(leaf(side * 9, -i * 16, side * 52, fill, 0.8));
  }
  leaves.push(leaf(0, -height - 8, 0, fill, 0.85));
  return `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${scale})"><path d="M0,0 L0,${-height}" stroke="${fill}" stroke-width="3.2" stroke-linecap="round"/>${leaves.join("")}</g>`;
};

const FOLDER = "M0,10 Q0,0 10,0 L38,0 L48,12 L100,12 Q110,12 110,22 L110,70 Q110,80 100,80 L10,80 Q0,80 0,70 Z";
export const folder = (x: number, y: number, rot: number, fill: string, scale = 1, offset = false) =>
  `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${scale})">${
    offset ? `<path d="${FOLDER}" fill="${P.lavender}" transform="translate(-4 4)"/>` : ""
  }<path d="${FOLDER}" fill="${fill}"/></g>`;

/** A page with a turned corner, a heading mark and a few lines of text. */
export const page = (x: number, y: number, rot = 0, scale = 1) =>
  `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${scale})">
  <path d="M0,0 L38,0 L56,18 L56,94 L0,94 Z" fill="${P.navy}" transform="translate(-5 5)"/>
  <path d="M0,0 L38,0 L56,18 L56,94 L0,94 Z" fill="${P.cream}"/>
  <path d="M38,0 L38,18 L56,18 Z" fill="${P.sky}"/>
  <path d="M12,24 L10,42 M22,24 L20,42 M8,29 L26,29 M7,37 L25,37" stroke="${P.orange}" stroke-width="3" stroke-linecap="round"/>
  <path d="M10,56 L46,56 M10,66 L40,66 M10,76 L44,76" stroke="${P.green}" stroke-width="3" stroke-linecap="round"/></g>`;

export const pencil = (x: number, y: number, rot: number, scale = 1) =>
  `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${scale})">
  <rect x="0" y="-8" width="50" height="16" rx="2" fill="${P.orange}"/>
  <rect x="44" y="-8" width="10" height="16" rx="2" fill="${P.lavender}"/>
  <path d="M0,-8 L-14,0 L0,8 Z" fill="${P.cream}"/>
  <path d="M-9,-3 L-14,0 L-9,3 Z" fill="${P.navy}"/></g>`;

/** An open book; x and y are the foot of its spine. */
export const book = (x: number, y: number, scale = 1) =>
  `<g transform="translate(${x} ${y}) scale(${scale})">
  <path d="M-58,-6 Q-30,-16 0,0 L0,46 Q-30,30 -58,40 Z" fill="${P.lavender}" transform="translate(-4 4)"/>
  <path d="M-58,-6 Q-30,-16 0,0 L0,46 Q-30,30 -58,40 Z" fill="${P.sky}"/>
  <path d="M58,-6 Q30,-16 0,0 L0,46 Q30,30 58,40 Z" fill="${P.cream}"/>
  <path d="M-48,6 Q-30,0 -10,8 M-48,16 Q-30,10 -10,18 M10,8 Q30,0 48,6 M10,18 Q30,10 48,16"
    stroke="${P.navy}" stroke-width="2.5" stroke-linecap="round" fill="none"/></g>`;

export const sun = (x: number, y: number, r: number, fill: string = P.yellow) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/>`;

/** A loose line drawn by hand. */
export const squiggle = (d: string, stroke: string = P.navy, width = 4) =>
  `<path d="${d}" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" fill="none"/>`;

// ---------- scenes ----------

/** An open book with a sprig growing from its spine. */
export const tourScene = (options?: DrawingOptions) =>
  drawing(
    "0 0 220 120",
    `${sun(178, 34, 20)}${sprig(150, 92, 58)}${book(150, 88)}`,
    { fit: "xMaxYMax meet", ...options },
  );

/** A fan of folders. */
export const folderScene = (options?: DrawingOptions) =>
  drawing(
    "0 0 220 110",
    `${folder(86, 44, -12, P.yellow)}${folder(110, 40, -2, P.sky)}${folder(134, 46, 8, P.orange, 1, true)}${sun(196, 24, 6)}`,
    { fit: "xMaxYMax meet", ...options },
  );

/** A Markdown page. */
export const fileScene = (options?: DrawingOptions) =>
  drawing("0 0 120 100", page(54, 10), { fit: "xMaxYMax meet", ...options });

/** A pencil leaving a wavy line behind it. */
export const writeScene = (options?: DrawingOptions) =>
  drawing(
    "0 0 120 100",
    `${squiggle("M24,82 C 36,66 46,94 58,78 S 76,68 82,74")}${pencil(86, 66, -50)}${leaf(40, 34, 30)}${leaf(56, 26, 70)}`,
    { fit: "xMaxYMax meet", ...options },
  );

/** For an empty folder list: an open folder with a sprig peeking out. */
export const emptyFolderScene = (options?: DrawingOptions) =>
  drawing(
    "0 0 160 100",
    `${folder(30, 22, 0, P.yellow, 0.9, true)}${sprig(78, 50, 34, 8, P.green, 0.9)}${folder(24, 40, 0, P.orange, 1.0)}${flower(130, 30, P.sky, P.yellow, 0.9)}`,
    options,
  );

/** For a search with no results: a magnifying glass over bare ground. */
export const emptySearchScene = (options?: DrawingOptions) =>
  drawing(
    "0 0 160 100",
    `${squiggle("M18,84 C 50,78 110,90 142,82", P.green, 3)}${leaf(36, 74, -30, P.green, 0.7)}${leaf(122, 76, 40, P.yellow, 0.7)}
    <circle cx="74" cy="44" r="22" fill="${P.sky}" stroke="${P.navy}" stroke-width="6"/>
    <path d="M90,60 L112,82" stroke="${P.orange}" stroke-width="10" stroke-linecap="round"/>`,
    options,
  );

/** For a missing page: a page blown off on the wind, leaves following it. */
export const lostScene = (options?: DrawingOptions) =>
  drawing(
    "0 0 240 150",
    `${squiggle("M16,108 C 50,92 70,124 108,104 S 160,78 180,90", P.lavender, 3)}${page(150, 20, 18, 0.95)}
    ${leaf(46, 70, -40, P.green, 1, true)}${leaf(86, 50, 30, P.yellow, 0.9)}${leaf(118, 80, 70, P.orange, 0.8)}
    ${squiggle("M10,140 C 70,132 170,146 232,136", P.green, 3)}${flower(38, 128, P.orange, P.yellow, 0.9)}${sprig(208, 138, 30, -6)}`,
    options,
  );

/** Leaves and a flower reaching in from a page's top-left corner. */
export const cornerLeftScene = (options?: DrawingOptions) =>
  drawing(
    "0 0 260 180",
    `${leaf(30, 22, -50, P.green, 2.4, true)}${leaf(92, 14, 20, P.yellow, 1.6)}${leaf(22, 92, -100, P.orange, 1.7, true)}
    ${flower(132, 40, P.lavender, P.yellow, 1.3, true)}${leaf(78, 66, -20, P.green, 1.2)}${flower(60, 128, P.sky, P.orange, 1)}`,
    { fit: "xMinYMin meet", ...options },
  );

/** Leaves and a flower reaching in from a page's top-right corner. */
export const cornerRightScene = (options?: DrawingOptions) =>
  drawing(
    "0 0 260 180",
    `${leaf(232, 24, 50, P.orange, 2.3, true)}${leaf(170, 12, -20, P.green, 1.6)}${leaf(240, 96, 100, P.yellow, 1.6, true)}
    ${flower(126, 34, P.orange, P.yellow, 1.2, true)}${leaf(188, 70, 24, P.green, 1.2)}${flower(206, 132, P.lavender, P.yellow, 1)}`,
    { fit: "xMaxYMin meet", ...options },
  );

/** A strip of sprigs, leaves and flowers growing along the ground, for footers. */
export const meadowScene = (options?: DrawingOptions) => {
  // A fixed seed, so the meadow is irregular but the same on every page.
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const pick = <T,>(list: readonly T[]) => list[Math.floor(rand() * list.length)];
  const plants: string[] = [];
  for (let x = 14; x < 630; x += 22 + rand() * 34) {
    const roll = rand();
    if (roll < 0.4) plants.push(sprig(x, 58, 16 + rand() * 24, rand() * 16 - 8, P.green, 0.8 + rand() * 0.3));
    else if (roll < 0.7)
      plants.push(
        `<path d="M${x},58 L${x},${40 - rand() * 8}" stroke="${P.green}" stroke-width="2.6"/>` +
          flower(x, 34 - rand() * 8, pick([P.orange, P.lavender, P.yellow, P.sky]), pick([P.yellow, P.orange]), 0.7 + rand() * 0.4),
      );
    else plants.push(leaf(x, 48 - rand() * 6, rand() * 70 - 35, pick([P.green, P.yellow, P.orange]), 0.8 + rand() * 0.4, rand() < 0.5));
  }
  return drawing("0 0 640 64", `${plants.join("")}${squiggle("M0,58 C 160,52 480,64 640,56", P.green, 3)}`, {
    fit: "xMidYMax slice",
    ...options,
  });
};

/** A small leaf for swatches and bullets; no brush filter at this size. */
export const tinyLeaf = (fill: string, options?: DrawingOptions) =>
  drawing("-12 -16 24 32", `<path d="${LEAF}" fill="${fill}"/>`, { rough: 0, ...options });
