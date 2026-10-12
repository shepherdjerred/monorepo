/**
 * Original 64x64 Steve-model skins drawn procedurally from a palette and a few
 * body, shirt and headwear patterns, then encoded as PNG without any
 * dependency. Each archetype has an outfit motif (a shirt colour family,
 * patterns and headwear) so a lobby of bots reads at a glance: rushers in red
 * with racing stripes, snipers in camo with hoods, bomb divers in hazard
 * stripes and goggles. Every pixel comes from the seed, so the same
 * personality always gets the same skin, and nothing here is copied from a
 * real player.
 */
import { SIZE } from "./png.ts";
import type { Rng } from "./random.ts";
import type { Archetype } from "./schema.ts";

type Rgb = readonly [number, number, number];
/** x, y, width, height in texture pixels. */
type Rect = readonly [number, number, number, number];

const SKIN_TONES: readonly Rgb[] = [
  [247, 219, 195],
  [233, 196, 164],
  [210, 161, 122],
  [181, 128, 92],
  [141, 92, 61],
  [96, 61, 40],
];

const HAIR_COLORS: readonly Rgb[] = [
  [38, 26, 20],
  [70, 46, 30],
  [120, 80, 44],
  [196, 150, 80],
  [232, 206, 128],
  [150, 50, 30],
  [60, 60, 70],
  [240, 240, 240],
];

const IRIS_COLORS: readonly Rgb[] = [
  [58, 96, 168],
  [64, 128, 72],
  [96, 64, 32],
  [40, 40, 40],
  [120, 90, 160],
];

const PANTS_COLORS: readonly Rgb[] = [
  [48, 66, 110],
  [36, 36, 44],
  [90, 70, 50],
  [60, 90, 70],
  [110, 40, 40],
  [80, 80, 90],
];

const SHOE_COLORS: readonly Rgb[] = [
  [30, 30, 30],
  [70, 45, 30],
  [200, 200, 200],
  [120, 30, 30],
];

/** Whether the accent colour lands on a pixel of a shirt face. */
type Pattern = (row: number, col: number, offset: number) => boolean;

const PATTERNS = {
  plain: () => false,
  stripes: (row, _col, offset) => (row + offset) % 4 < 2,
  checker: (row, col, offset) => (row + col + offset) % 2 === 0,
  band: (row) => row >= 4 && row < 7,
  vertical: (_row, col, offset) => (col + offset) % 3 === 0,
  racing: (_row, col) => col === 3 || col === 4,
  hazard: (row, col, offset) => (row + col + offset) % 4 < 2,
  camo: (row, col, offset) =>
    ((row * 7 + col * 13 + offset * 5) % 11) % 3 === 0,
  sash: (row, col) => Math.abs(row - col) <= 1,
  cross: (row, col) =>
    (row >= 2 && row <= 6 && (col === 3 || col === 4)) ||
    ((row === 3 || row === 4) && col >= 1 && col <= 6),
  plates: (row, col) => row % 4 === 0 || col === 0 || col === 7,
  epaulettes: (row, col) => row <= 1 && (col <= 1 || col >= 6),
} as const satisfies Record<string, Pattern>;
type PatternName = keyof typeof PATTERNS;

type Headwear =
  "none" | "hood" | "cap" | "bandana" | "goggles" | "helmet" | "headphones";

/** An archetype's outfit: what makes it recognisable across a lobby. */
type Motif = {
  /** Shirt hue range in degrees. */
  hue: readonly [number, number];
  saturation: readonly [number, number];
  lightness: readonly [number, number];
  /** Degrees from the shirt hue to the accent hue. */
  accentShift: readonly number[];
  patterns: readonly PatternName[];
  headwear: readonly Headwear[];
};

const MOTIFS: Record<Archetype, Motif> = {
  rusher: {
    hue: [350, 15],
    saturation: [0.7, 0.9],
    lightness: [0.4, 0.5],
    accentShift: [0, 180],
    patterns: ["racing", "stripes"],
    headwear: ["bandana", "none"],
  },
  lurker: {
    hue: [260, 300],
    saturation: [0.25, 0.45],
    lightness: [0.12, 0.24],
    accentShift: [30, 330],
    patterns: ["plain", "band"],
    headwear: ["hood"],
  },
  sniper: {
    hue: [75, 120],
    saturation: [0.3, 0.5],
    lightness: [0.25, 0.38],
    accentShift: [-30, 20],
    patterns: ["camo"],
    headwear: ["hood", "cap"],
  },
  bomb_diver: {
    hue: [30, 50],
    saturation: [0.85, 1],
    lightness: [0.48, 0.56],
    accentShift: [0],
    patterns: ["hazard"],
    headwear: ["goggles"],
  },
  anchor: {
    hue: [200, 225],
    saturation: [0.15, 0.3],
    lightness: [0.4, 0.52],
    accentShift: [0, 10],
    patterns: ["plates"],
    headwear: ["helmet"],
  },
  flanker: {
    hue: [165, 190],
    saturation: [0.5, 0.7],
    lightness: [0.32, 0.42],
    accentShift: [150, 180],
    patterns: ["sash", "vertical"],
    headwear: ["cap", "none"],
  },
  support: {
    hue: [0, 360],
    saturation: [0.05, 0.12],
    lightness: [0.82, 0.9],
    accentShift: [0],
    patterns: ["cross"],
    headwear: ["none", "headphones"],
  },
  duelist: {
    hue: [330, 350],
    saturation: [0.55, 0.75],
    lightness: [0.22, 0.32],
    accentShift: [60, 180],
    patterns: ["sash"],
    headwear: ["none", "bandana"],
  },
  hunter: {
    hue: [20, 35],
    saturation: [0.35, 0.5],
    lightness: [0.25, 0.35],
    accentShift: [180, 200],
    patterns: ["band", "plain"],
    headwear: ["bandana", "hood"],
  },
  turtle: {
    hue: [65, 100],
    saturation: [0.45, 0.6],
    lightness: [0.28, 0.38],
    accentShift: [0, 20],
    patterns: ["checker"],
    headwear: ["helmet"],
  },
  troll: {
    hue: [0, 360],
    saturation: [0.85, 1],
    lightness: [0.5, 0.6],
    accentShift: [90, 150, 180, 270],
    patterns: ["checker", "stripes", "vertical"],
    headwear: ["headphones", "cap"],
  },
  tactician: {
    hue: [215, 235],
    saturation: [0.45, 0.6],
    lightness: [0.18, 0.26],
    accentShift: [190, 200],
    patterns: ["epaulettes", "band"],
    headwear: ["cap", "none"],
  },
};

/** Fixed accents the motifs that need them use instead of a shifted hue. */
const HAZARD_BLACK: Rgb = [28, 28, 28];
const MEDIC_GREEN: Rgb = [40, 150, 70];
const GOLD: Rgb = [214, 176, 64];
const METAL: Rgb = [150, 156, 164];

const HUE_SECTORS: readonly ((c: number, x: number) => Rgb)[] = [
  (c, x) => [c, x, 0],
  (c, x) => [x, c, 0],
  (c, x) => [0, c, x],
  (c, x) => [0, x, c],
  (c, x) => [x, 0, c],
  (c, x) => [c, 0, x],
];

function hsl(h: number, s: number, l: number): Rgb {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  const sector = HUE_SECTORS[Math.floor(hue / 60)] ?? HUE_SECTORS[0];
  if (sector === undefined) {
    throw new Error("no hue sectors");
  }
  const [r, g, b] = sector(c, x);
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

function darken(color: Rgb, amount: number): Rgb {
  return [
    Math.round(color[0] * (1 - amount)),
    Math.round(color[1] * (1 - amount)),
    Math.round(color[2] * (1 - amount)),
  ];
}

class Canvas {
  readonly pixels = new Uint8Array(SIZE * SIZE * 4);

  set(x: number, y: number, color: Rgb): void {
    const at = (y * SIZE + x) * 4;
    this.pixels[at] = color[0];
    this.pixels[at + 1] = color[1];
    this.pixels[at + 2] = color[2];
    this.pixels[at + 3] = 255;
  }

  fill(rect: Rect, color: Rgb): void {
    const [x0, y0, w, h] = rect;
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        this.set(x, y, color);
      }
    }
  }
}

/** The six faces of a box in the standard skin layout. */
type Box = { u: number; v: number; w: number; h: number; d: number };

const HEAD: Box = { u: 0, v: 0, w: 8, h: 8, d: 8 };
const BODY: Box = { u: 16, v: 16, w: 8, h: 12, d: 4 };
const RIGHT_ARM: Box = { u: 40, v: 16, w: 4, h: 12, d: 4 };
const LEFT_ARM: Box = { u: 32, v: 48, w: 4, h: 12, d: 4 };
const RIGHT_LEG: Box = { u: 0, v: 16, w: 4, h: 12, d: 4 };
const LEFT_LEG: Box = { u: 16, v: 48, w: 4, h: 12, d: 4 };

/** The front face of a box: where a face or a shirt logo goes. */
function front(box: Box): Rect {
  return [box.u + box.d, box.v + box.d, box.w, box.h];
}

/** The four side faces of a box (right, front, left, back). */
function sides(box: Box): readonly Rect[] {
  const { u, v, w, h, d } = box;
  return [
    [u, v + d, d, h],
    [u + d, v + d, w, h],
    [u + d + w, v + d, d, h],
    [u + d + w + d, v + d, w, h],
  ];
}

/** Fills every face of a box; `paintSide` receives each side face. */
function paintBox(
  canvas: Canvas,
  box: Box,
  color: Rgb,
  paintSide: (face: Rect) => void,
): void {
  const { u, v, w, d } = box;
  canvas.fill([u + d, v, w, d], color); // top
  canvas.fill([u + d + w, v, w, d], darken(color, 0.25)); // bottom
  for (const face of sides(box)) {
    canvas.fill(face, color);
    paintSide(face);
  }
}

type Palette = {
  skin: Rgb;
  hair: Rgb;
  iris: Rgb;
  shirt: Rgb;
  accent: Rgb;
  pants: Rgb;
  shoes: Rgb;
};

function hueIn(rng: Rng, [low, high]: readonly [number, number]): number {
  // A range may wrap past 360, such as rusher red [350, 15].
  const span = high >= low ? high - low : high + 360 - low;
  return low + rng.float(0, span);
}

function palette(rng: Rng, archetype: Archetype): Palette {
  const motif = MOTIFS[archetype];
  const hue = hueIn(rng, motif.hue);
  const shirt = hsl(
    hue,
    rng.float(motif.saturation[0], motif.saturation[1]),
    rng.float(motif.lightness[0], motif.lightness[1]),
  );
  const shifted = hsl(
    hue + rng.pick(motif.accentShift),
    0.65,
    rng.float(0.5, 0.68),
  );
  const accent =
    archetype === "bomb_diver"
      ? HAZARD_BLACK
      : archetype === "support"
        ? MEDIC_GREEN
        : archetype === "tactician"
          ? GOLD
          : archetype === "anchor"
            ? darken(shirt, 0.35)
            : shifted;
  return {
    skin: rng.pick(SKIN_TONES),
    hair:
      archetype === "troll"
        ? hsl(rng.float(0, 360), 0.9, 0.55)
        : rng.pick(HAIR_COLORS),
    iris: rng.pick(IRIS_COLORS),
    shirt,
    accent,
    pants: rng.pick(PANTS_COLORS),
    shoes: rng.pick(SHOE_COLORS),
  };
}

const HEAD_TOP: Rect = [HEAD.u + HEAD.d, HEAD.v, HEAD.w, HEAD.d];
const LENS: Rgb = [120, 200, 230];

/** Paints `rows` rows from the top of every side face of the head. */
function headBand(
  canvas: Canvas,
  from: number,
  rows: number,
  color: Rgb,
): void {
  for (const [x, y, w] of sides(HEAD)) {
    canvas.fill([x, y + from, w, rows], color);
  }
}

/** Each headwear painted over the bare head; the face stays visible. */
const HEADWEAR: Record<
  Exclude<Headwear, "none">,
  (canvas: Canvas, colors: Palette) => void
> = {
  hood: (canvas, colors) => {
    const hood = darken(colors.shirt, 0.15);
    const [fx] = front(HEAD);
    canvas.fill(HEAD_TOP, hood);
    for (const [x, y, w, h] of sides(HEAD)) {
      if (x === fx) {
        // Frame the face: a brow and both cheeks.
        canvas.fill([x, y, w, 2], hood);
        canvas.fill([x, y, 1, h], hood);
        canvas.fill([x + w - 1, y, 1, h], hood);
      } else {
        canvas.fill([x, y, w, h], hood);
      }
    }
  },
  cap: (canvas, colors) => {
    const [fx, fy] = front(HEAD);
    canvas.fill(HEAD_TOP, colors.accent);
    headBand(canvas, 0, 2, colors.accent);
    canvas.fill([fx, fy + 2, HEAD.w, 1], darken(colors.accent, 0.35)); // brim
  },
  bandana: (canvas, colors) => {
    headBand(canvas, 2, 1, colors.accent);
  },
  goggles: (canvas) => {
    const [fx, fy] = front(HEAD);
    headBand(canvas, 2, 1, HAZARD_BLACK);
    canvas.fill([fx + 1, fy + 2, 2, 1], LENS);
    canvas.fill([fx + 5, fy + 2, 2, 1], LENS);
  },
  helmet: (canvas) => {
    canvas.fill(HEAD_TOP, METAL);
    headBand(canvas, 0, 2, METAL);
    headBand(canvas, 2, 1, darken(METAL, 0.3));
  },
  headphones: (canvas, colors) => {
    canvas.fill([HEAD.u + HEAD.d + 3, HEAD.v, 2, HEAD.d], HAZARD_BLACK);
    const [right, , left] = sides(HEAD);
    for (const face of [right, left]) {
      if (face !== undefined) {
        canvas.fill([face[0] + 2, face[1] + 3, 4, 3], colors.accent);
      }
    }
  },
};

function paintHead(
  rng: Rng,
  canvas: Canvas,
  colors: Palette,
  archetype: Archetype,
): void {
  const hairRows = 1 + rng.int(3);
  paintBox(canvas, HEAD, colors.skin, ([x, y, w]) => {
    canvas.fill([x, y, w, hairRows], colors.hair);
  });
  canvas.fill([HEAD.u + HEAD.d, HEAD.v, HEAD.w, HEAD.d], colors.hair); // top of head
  // Face: eyes on row 4, mouth on row 6.
  const [fx, fy] = front(HEAD);
  if (rng.chance(0.5)) {
    canvas.fill([fx, fy + hairRows, 2, 1], colors.hair); // fringe
  }
  const white: Rgb = [245, 245, 245];
  canvas.set(fx + 1, fy + 4, white);
  canvas.set(fx + 2, fy + 4, colors.iris);
  canvas.set(fx + 5, fy + 4, colors.iris);
  canvas.set(fx + 6, fy + 4, white);
  canvas.fill([fx + 3, fy + 6, 2, 1], darken(colors.skin, 0.35));
  if (rng.chance(0.3)) {
    canvas.fill([fx + 2, fy + 7, 4, 1], colors.hair); // beard
  }
  const headwear = rng.pick(MOTIFS[archetype].headwear);
  if (headwear !== "none") {
    HEADWEAR[headwear](canvas, colors);
  }
}

function paintTorso(
  rng: Rng,
  canvas: Canvas,
  colors: Palette,
  archetype: Archetype,
): void {
  const pattern: Pattern = PATTERNS[rng.pick(MOTIFS[archetype].patterns)];
  const offset = rng.int(2);
  paintBox(canvas, BODY, colors.shirt, ([x, y, w, h]) => {
    for (let row = 0; row < h; row++) {
      for (let col = 0; col < w; col++) {
        if (pattern(row, col, offset)) {
          canvas.set(x + col, y + row, colors.accent);
        }
      }
    }
  });
  const beltRow = BODY.v + BODY.d + BODY.h - 1;
  canvas.fill(
    [BODY.u, beltRow, 2 * (BODY.w + BODY.d), 1],
    darken(colors.pants, 0.4),
  );
}

function paintLimbs(rng: Rng, canvas: Canvas, colors: Palette): void {
  const sleeves = rng.int(5);
  for (const arm of [RIGHT_ARM, LEFT_ARM]) {
    paintBox(canvas, arm, colors.skin, ([x, y, w]) => {
      if (sleeves > 0) {
        canvas.fill([x, y, w, sleeves], colors.shirt);
      }
    });
  }
  const shoeRows = 1 + rng.int(2);
  for (const leg of [RIGHT_LEG, LEFT_LEG]) {
    paintBox(canvas, leg, colors.pants, ([x, y, w, h]) => {
      canvas.fill([x, y + h - shoeRows, w, shoeRows], colors.shoes);
    });
  }
}

/** The RGBA pixels of one skin. */
export function renderSkin(rng: Rng, archetype: Archetype): Uint8Array {
  const canvas = new Canvas();
  const colors = palette(rng, archetype);
  paintHead(rng, canvas, colors, archetype);
  paintTorso(rng, canvas, colors, archetype);
  paintLimbs(rng, canvas, colors);
  return canvas.pixels;
}
