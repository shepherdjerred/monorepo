/**
 * Original 64x64 Steve-model skins drawn procedurally from a palette and a few
 * body, shirt and hair patterns, then encoded as PNG without any dependency.
 * Every pixel comes from the seed, so the same personality always gets the
 * same skin, and nothing here is copied from a real player.
 */
import type { Rng } from "./random.ts";
import type { Archetype } from "./traits.ts";

export const SIZE = 64;

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

/** Archetypes pull the shirt hue toward a family so teams of bots read at a glance. */
const SHIRT_HUES: Record<Archetype, readonly [number, number]> = {
  rusher: [350, 30],
  anchor: [200, 250],
  support: [80, 160],
  lurker: [260, 320],
  flex: [20, 60],
};

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

/** Fills every face of a box; `sides` receives each side face. */
function paintBox(
  canvas: Canvas,
  box: Box,
  color: Rgb,
  sides: (face: Rect) => void,
): void {
  const { u, v, w, h, d } = box;
  canvas.fill([u + d, v, w, d], color); // top
  canvas.fill([u + d + w, v, w, d], darken(color, 0.25)); // bottom
  const faces: readonly Rect[] = [
    [u, v + d, d, h],
    [u + d, v + d, w, h],
    [u + d + w, v + d, d, h],
    [u + d + w + d, v + d, w, h],
  ];
  for (const face of faces) {
    canvas.fill(face, color);
    sides(face);
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

function palette(rng: Rng, archetype: Archetype): Palette {
  const [low, high] = SHIRT_HUES[archetype];
  const hue = rng.float(low, high);
  return {
    skin: rng.pick(SKIN_TONES),
    hair: rng.pick(HAIR_COLORS),
    iris: rng.pick(IRIS_COLORS),
    shirt: hsl(hue, rng.float(0.45, 0.8), rng.float(0.35, 0.55)),
    accent: hsl(hue + rng.pick([150, 180, 210]), 0.6, rng.float(0.5, 0.7)),
    pants: rng.pick(PANTS_COLORS),
    shoes: rng.pick(SHOE_COLORS),
  };
}

/** Whether the accent colour lands on a pixel of a shirt face, by pattern. */
const SHIRT_PATTERNS: readonly ((
  row: number,
  col: number,
  offset: number,
) => boolean)[] = [
  () => false, // plain
  (row, _col, offset) => (row + offset) % 4 < 2, // stripes
  (row, col, offset) => (row + col + offset) % 2 === 0, // checker
  (row) => row >= 4 && row < 7, // band
  (_row, col, offset) => (col + offset) % 3 === 0, // vertical
];

function paintHead(rng: Rng, canvas: Canvas, colors: Palette): void {
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
}

function paintTorso(rng: Rng, canvas: Canvas, colors: Palette): void {
  const pattern = rng.pick(SHIRT_PATTERNS);
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
  paintHead(rng, canvas, colors);
  paintTorso(rng, canvas, colors);
  paintLimbs(rng, canvas, colors);
  return canvas.pixels;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) === 1 ? 0xed_b8_83_20 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xff_ff_ff_ff;
  for (const byte of bytes) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xff_ff_ff_ff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65_521;
    b = (b + a) % 65_521;
  }
  return ((b << 16) | a) >>> 0;
}

function u32(value: number): Uint8Array {
  return new Uint8Array([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]);
}

function concat(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const body = concat([new TextEncoder().encode(type), data]);
  return concat([u32(data.length), body, u32(crc32(body))]);
}

/** A 64x64 RGBA PNG (8-bit, colour type 6, filter 0 on every scanline). */
export function encodePng(rgba: Uint8Array): Uint8Array<ArrayBuffer> {
  if (rgba.length !== SIZE * SIZE * 4) {
    throw new Error(
      `expected ${String(SIZE * SIZE * 4)} bytes, got ${String(rgba.length)}`,
    );
  }
  const stride = SIZE * 4 + 1;
  const raw = new Uint8Array(SIZE * stride);
  for (let y = 0; y < SIZE; y++) {
    raw[y * stride] = 0;
    raw.set(rgba.subarray(y * SIZE * 4, (y + 1) * SIZE * 4), y * stride + 1);
  }
  const deflated = Bun.deflateSync(raw, { level: 9 });
  const zlib = concat([
    new Uint8Array([0x78, 0xda]),
    deflated,
    u32(adler32(raw)),
  ]);
  const header = concat([
    u32(SIZE),
    u32(SIZE),
    new Uint8Array([8, 6, 0, 0, 0]),
  ]);
  return concat([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

export function sha256Hex(bytes: Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}
