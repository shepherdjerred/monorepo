// Headless port of pokeemerald-wasm web/app.js software renderer.
// Reads VRAM/palette/OAM/registers straight out of wasm linear memory and
// rasterizes a 240x160 RGBA frame. No canvas/DOM: writes into a plain
// Uint8ClampedArray. Structured to mirror upstream's render path so future
// rendering fixes can be ported across with minimal diffing.
import { WIDTH, HEIGHT, REG, PAL, VRAM, OAM } from "./constants.ts";

type Color = [number, number, number];

// A single OAM sprite decoded into the values the rasterizer needs.
type Sprite = {
  tileBase: number;
  width: number;
  height: number;
  color256: number;
  palette: number;
  mapping1d: number;
  ox: number;
  oy: number;
  flipX: boolean;
  flipY: boolean;
  affineMode: number;
  pa: number;
  pb: number;
  pc: number;
  pd: number;
};

// ---- pure helpers (no memory/state) ----
function gbaColor(value: number): Color {
  const r = ((value & 31) * 255) / 31;
  const g = (((value >> 5) & 31) * 255) / 31;
  const b = (((value >> 10) & 31) * 255) / 31;
  return [Math.trunc(r), Math.trunc(g), Math.trunc(b)];
}

function inWindowRange(value: number, range: number): boolean {
  const start = range >> 8;
  const end = range & 0xff;
  return start <= end
    ? value >= start && value < end
    : value >= start || value < end;
}

function signed16(value: number): number {
  return (value << 16) >> 16;
}

function signed28(value: number): number {
  return (value << 4) >> 4;
}

function objTileOffset(sprite: Sprite, tileX: number, tileY: number): number {
  const { tileBase, width, color256, mapping1d } = sprite;
  return mapping1d
    ? tileBase +
        tileY * (color256 ? width >> 2 : width >> 3) +
        tileX * (color256 ? 2 : 1)
    : tileBase + tileY * 32 + tileX * (color256 ? 2 : 1);
}

const SPRITE_SIZES: number[][][] = [
  [
    [8, 8],
    [16, 16],
    [32, 32],
    [64, 64],
  ],
  [
    [16, 8],
    [32, 8],
    [32, 16],
    [64, 32],
  ],
  [
    [8, 16],
    [8, 32],
    [16, 32],
    [32, 64],
  ],
];

export type Renderer = {
  refresh: (memory: WebAssembly.Memory) => void;
  render: () => Uint8ClampedArray;
};

export function createRenderer(): Renderer {
  const image = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  const layerData = new Uint8Array(WIDTH * HEIGHT);
  let u8 = new Uint8Array(0);
  let u16 = new Uint16Array(0);

  // Live wasm-memory reads are always in-bounds for a well-formed frame; an
  // out-of-range index means memory wasn't refreshed or a register decoded
  // wrong, so fail fast rather than rasterizing from an undefined.
  function rd8(index: number): number {
    const value = u8[index];
    if (value === undefined) {
      throw new Error(`renderer u8 read out of range: ${String(index)}`);
    }
    return value;
  }
  function rd16(index: number): number {
    const value = u16[index];
    if (value === undefined) {
      throw new Error(`renderer u16 read out of range: ${String(index)}`);
    }
    return value;
  }

  // The output framebuffer and per-pixel layer map are indexed by a pixel that
  // is already range-checked (0 <= x < WIDTH, 0 <= y < HEIGHT) before we get
  // here, so an undefined read would be an internal bug — surface it.
  function rdImage(index: number): number {
    const value = image[index];
    if (value === undefined) {
      throw new Error(`renderer image read out of range: ${String(index)}`);
    }
    return value;
  }
  function rd8Layer(pixel: number): number {
    const value = layerData[pixel];
    if (value === undefined) {
      throw new Error(`renderer layer read out of range: ${String(pixel)}`);
    }
    return value;
  }

  function word(offset: number): number {
    return rd16((REG + offset) >> 1) | (rd16((REG + offset + 2) >> 1) << 16);
  }

  function windowMask(x: number, y: number): number {
    const dispcnt = rd16(REG >> 1);
    const windowsEnabled = dispcnt & 0xe0_00;
    if (!windowsEnabled) return 0x3f;
    if (
      dispcnt & 0x20_00 &&
      inWindowRange(x, rd16((REG + 0x40) >> 1)) &&
      inWindowRange(y, rd16((REG + 0x44) >> 1))
    ) {
      return rd16((REG + 0x48) >> 1) & 0x3f;
    }
    if (
      dispcnt & 0x40_00 &&
      inWindowRange(x, rd16((REG + 0x42) >> 1)) &&
      inWindowRange(y, rd16((REG + 0x46) >> 1))
    ) {
      return (rd16((REG + 0x48) >> 1) >> 8) & 0x3f;
    }
    return rd16((REG + 0x4a) >> 1) & 0x3f;
  }

  function activeBlendColor(
    color: Color,
    layer: number,
    pixel: number,
    effectsEnabled: number,
  ): number[] {
    const bldcnt = rd16((REG + 0x50) >> 1);
    const effect = (bldcnt >> 6) & 3;
    const sourceTargets = bldcnt & 0x3f;
    if (!effectsEnabled || !(sourceTargets & layer) || effect === 0)
      return color;
    if (effect === 1 && (bldcnt >> 8) & rd8Layer(pixel)) {
      const alpha = rd16((REG + 0x52) >> 1);
      const eva = Math.min(alpha & 0x1f, 16);
      const evb = Math.min((alpha >> 8) & 0x1f, 16);
      return [
        Math.min(255, (color[0] * eva + rdImage(pixel * 4) * evb) >> 4),
        Math.min(255, (color[1] * eva + rdImage(pixel * 4 + 1) * evb) >> 4),
        Math.min(255, (color[2] * eva + rdImage(pixel * 4 + 2) * evb) >> 4),
      ];
    }
    const evy = Math.min(rd16((REG + 0x54) >> 1) & 0x1f, 16);
    if (effect === 2) return color.map((c) => c + (((255 - c) * evy) >> 4));
    if (effect === 3) return color.map((c) => c - ((c * evy) >> 4));
    return color;
  }

  function putPixel(x: number, y: number, color: Color, layer = 0x20): void {
    if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
    const mask = windowMask(x, y);
    if (!(mask & layer)) return;
    const pixel = y * WIDTH + x;
    const output = activeBlendColor(color, layer, pixel, mask & 0x20);
    const [r, g, b] = output;
    if (r === undefined || g === undefined || b === undefined) {
      throw new Error("blend produced fewer than 3 channels");
    }
    const p = pixel * 4;
    image[p] = r;
    image[p + 1] = g;
    image[p + 2] = b;
    image[p + 3] = 255;
    layerData[pixel] = layer;
  }

  function clearScreen(): void {
    const color = gbaColor(rd16(PAL >> 1));
    for (let y = 0; y < HEIGHT; y++)
      for (let x = 0; x < WIDTH; x++) putPixel(x, y, color, 0x20);
  }

  function renderBitmapMode3(): void {
    for (let i = 0; i < WIDTH * HEIGHT; i++) {
      const [r, g, b] = gbaColor(rd16((VRAM >> 1) + i));
      const p = i * 4;
      image[p] = r;
      image[p + 1] = g;
      image[p + 2] = b;
      image[p + 3] = 255;
      layerData[i] = 0x04;
    }
  }

  function renderBitmapMode4(dispcnt: number): void {
    const page = dispcnt & 0x10 ? 0xa0_00 : 0;
    for (let i = 0; i < WIDTH * HEIGHT; i++) {
      const colorIndex = rd8(VRAM + page + i);
      const [r, g, b] = gbaColor(rd16((PAL >> 1) + colorIndex));
      const p = i * 4;
      image[p] = r;
      image[p + 1] = g;
      image[p + 2] = b;
      image[p + 3] = 255;
      layerData[i] = 0x04;
    }
  }

  function textBgPixel(bg: number, x: number, y: number): Color | null {
    const cnt = rd16((REG + 8 + bg * 2) >> 1);
    const charBase = VRAM + ((cnt >> 2) & 3) * 0x40_00;
    const screenBase = VRAM + ((cnt >> 8) & 31) * 0x8_00;
    const color256 = cnt & 0x80;
    const size = (cnt >> 14) & 3;
    const width = size & 1 ? 512 : 256;
    const height = size & 2 ? 512 : 256;
    const hofs = rd16((REG + 0x10 + bg * 4) >> 1) & 511;
    const vofs = rd16((REG + 0x12 + bg * 4) >> 1) & 511;
    const sx = (x + hofs) & (width - 1);
    const sy = (y + vofs) & (height - 1);
    const block = (sx >= 256 ? 1 : 0) + (sy >= 256 ? (size === 3 ? 2 : 1) : 0);
    const mapX = (sx & 255) >> 3;
    const mapY = (sy & 255) >> 3;
    const entry = rd16(
      (screenBase + block * 0x8_00 + (mapY * 32 + mapX) * 2) >> 1,
    );
    const tile = entry & 0x3_ff;
    const palette = (entry >> 12) & 15;
    const px = entry & 0x4_00 ? 7 - (sx & 7) : sx & 7;
    const py = entry & 0x8_00 ? 7 - (sy & 7) : sy & 7;
    if (color256) {
      const colorIndex = rd8(charBase + tile * 64 + py * 8 + px);
      if (!colorIndex) return null;
      return gbaColor(rd16((PAL >> 1) + colorIndex));
    }
    const packed = rd8(charBase + tile * 32 + py * 4 + (px >> 1));
    const colorIndex = px & 1 ? packed >> 4 : packed & 15;
    if (!colorIndex) return null;
    return gbaColor(rd16((PAL >> 1) + palette * 16 + colorIndex));
  }

  function affineBgPixel(bg: number, x: number, y: number): Color | null {
    const cnt = rd16((REG + 8 + bg * 2) >> 1);
    const charBase = VRAM + ((cnt >> 2) & 3) * 0x40_00;
    const screenBase = VRAM + ((cnt >> 8) & 31) * 0x8_00;
    const sizes = [128, 256, 512, 1024];
    const size = sizes[(cnt >> 14) & 3];
    if (size === undefined) {
      throw new Error(
        `affine bg size out of range: ${String((cnt >> 14) & 3)}`,
      );
    }
    const wrap = cnt & 0x20_00;
    const reg = bg === 2 ? 0x20 : 0x30;
    const pa = signed16(rd16((REG + reg) >> 1));
    const pb = signed16(rd16((REG + reg + 2) >> 1));
    const pc = signed16(rd16((REG + reg + 4) >> 1));
    const pd = signed16(rd16((REG + reg + 6) >> 1));
    const refX = signed28(word(reg + 8));
    const refY = signed28(word(reg + 12));
    let sx = (refX + pa * x + pb * y) >> 8;
    let sy = (refY + pc * x + pd * y) >> 8;
    if (wrap) {
      sx &= size - 1;
      sy &= size - 1;
    } else if (sx < 0 || sy < 0 || sx >= size || sy >= size) {
      return null;
    }
    const tilesPerRow = size >> 3;
    const tile = rd8(screenBase + (sy >> 3) * tilesPerRow + (sx >> 3));
    const colorIndex = rd8(charBase + tile * 64 + (sy & 7) * 8 + (sx & 7));
    if (!colorIndex) return null;
    return gbaColor(rd16((PAL >> 1) + colorIndex));
  }

  type Layer = { bg: number; type: "text" | "affine"; priority: number };
  function bgLayersForMode(dispcnt: number): Layer[] {
    const mode = dispcnt & 7;
    const layers: { bg: number; type: "text" | "affine" }[] = [];
    for (let bg = 0; bg < 4; bg++) {
      if (!(dispcnt & (0x1_00 << bg))) continue;
      if (mode === 0) layers.push({ bg, type: "text" });
      else if (mode === 1 && bg < 2) layers.push({ bg, type: "text" });
      else if (mode === 1 && bg === 2) layers.push({ bg, type: "affine" });
      else if (mode === 2 && bg >= 2) layers.push({ bg, type: "affine" });
    }
    return layers.map((layer) => ({
      ...layer,
      priority: rd16((REG + 8 + layer.bg * 2) >> 1) & 3,
    }));
  }

  function objPixel(sprite: Sprite, x: number, y: number): Color | null {
    const tileOffset = objTileOffset(sprite, x >> 3, y >> 3);
    let colorIndex: number;
    if (sprite.color256)
      colorIndex = rd8(
        VRAM + 0x1_00_00 + tileOffset * 32 + (y & 7) * 8 + (x & 7),
      );
    else {
      const packed = rd8(
        VRAM + 0x1_00_00 + tileOffset * 32 + (y & 7) * 4 + ((x & 7) >> 1),
      );
      colorIndex = x & 1 ? packed >> 4 : packed & 15;
    }
    if (!colorIndex) return null;
    const palOffset = sprite.color256
      ? colorIndex
      : sprite.palette * 16 + colorIndex;
    return gbaColor(rd16((PAL >> 1) + 0x1_00 + palOffset));
  }

  function renderBgLayer(bg: number, type: "text" | "affine"): void {
    const pixel = type === "affine" ? affineBgPixel : textBgPixel;
    const layer = 1 << bg;
    for (let y = 0; y < HEIGHT; y++)
      for (let x = 0; x < WIDTH; x++) {
        const color = pixel(bg, x, y);
        if (color) putPixel(x, y, color, layer);
      }
  }

  function drawRegularSprite(sprite: Sprite): void {
    const { width: w, height: h, ox, oy, flipX, flipY } = sprite;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const px = flipX ? w - 1 - x : x;
        const py = flipY ? h - 1 - y : y;
        const color = objPixel(sprite, px, py);
        if (color) putPixel(ox + x, oy + y, color, 0x10);
      }
  }

  function drawAffineSprite(sprite: Sprite): void {
    const { width: w, height: h, ox, oy, affineMode, pa, pb, pc, pd } = sprite;
    const drawW = affineMode === 3 ? w * 2 : w;
    const drawH = affineMode === 3 ? h * 2 : h;
    const drawCx = drawW / 2;
    const drawCy = drawH / 2;
    const texCx = w / 2;
    const texCy = h / 2;
    for (let y = 0; y < drawH; y++)
      for (let x = 0; x < drawW; x++) {
        const dx = x - drawCx;
        const dy = y - drawCy;
        const px = ((pa * dx + pb * dy) >> 8) + texCx;
        const py = ((pc * dx + pd * dy) >> 8) + texCy;
        if (px < 0 || py < 0 || px >= w || py >= h) continue;
        const color = objPixel(sprite, px, py);
        if (color) putPixel(ox + x, oy + y, color, 0x10);
      }
  }

  function decodeSprite(
    i: number,
    dispcnt: number,
    priority: number | null,
  ): Sprite | null {
    const base = (OAM >> 1) + i * 4;
    const a0 = rd16(base);
    const a1 = rd16(base + 1);
    const a2 = rd16(base + 2);
    const affineMode = (a0 >> 8) & 3;
    const affine = affineMode & 1;
    if (!affine && a0 & 0x02_00) return null;
    const shape = (a0 >> 14) & 3;
    if (shape === 3) return null;
    const shapeSizes = SPRITE_SIZES[shape];
    const dims = shapeSizes?.[(a1 >> 14) & 3];
    if (dims === undefined) {
      throw new Error(`sprite size out of range: shape ${String(shape)}`);
    }
    const [width, height] = dims;
    if (width === undefined || height === undefined) {
      throw new Error(`sprite dimensions missing for shape ${String(shape)}`);
    }
    const spritePriority = (a2 >> 10) & 3;
    if (priority !== null && spritePriority !== priority) return null;
    let ox = a1 & 511;
    let oy = a0 & 255;
    if (ox > 240) ox -= 512;
    if (oy > 160) oy -= 256;

    let pa = 0;
    let pb = 0;
    let pc = 0;
    let pd = 0;
    if (affine) {
      const matrix = (a1 >> 9) & 31;
      const matrixBase = (OAM >> 1) + matrix * 16;
      pa = signed16(rd16(matrixBase + 3));
      pb = signed16(rd16(matrixBase + 7));
      pc = signed16(rd16(matrixBase + 11));
      pd = signed16(rd16(matrixBase + 15));
    }

    return {
      tileBase: a2 & 0x3_ff,
      width,
      height,
      color256: a0 & 0x20_00,
      palette: (a2 >> 12) & 15,
      mapping1d: dispcnt & 0x40,
      ox,
      oy,
      flipX: (a1 & 0x10_00) !== 0,
      flipY: (a1 & 0x20_00) !== 0,
      affineMode,
      pa,
      pb,
      pc,
      pd,
    };
  }

  function renderSprites(
    dispcnt: number,
    priority: number | null = null,
  ): void {
    if (!(dispcnt & 0x10_00)) return;
    for (let i = 127; i >= 0; i--) {
      const sprite = decodeSprite(i, dispcnt, priority);
      if (!sprite) continue;
      if (sprite.affineMode & 1) drawAffineSprite(sprite);
      else drawRegularSprite(sprite);
    }
  }

  function renderTiled(dispcnt: number): void {
    clearScreen();
    const layers = bgLayersForMode(dispcnt);
    for (let priority = 3; priority >= 0; priority--) {
      for (const { bg, type } of layers) {
        if ((rd16((REG + 8 + bg * 2) >> 1) & 3) === priority)
          renderBgLayer(bg, type);
      }
      renderSprites(dispcnt, priority);
    }
  }

  return {
    refresh(memory: WebAssembly.Memory): void {
      u8 = new Uint8Array(memory.buffer);
      u16 = new Uint16Array(memory.buffer);
    },
    render(): Uint8ClampedArray {
      const dispcnt = rd16(REG >> 1);
      const mode = dispcnt & 7;
      if (mode === 3) renderBitmapMode3();
      else if (mode === 4) renderBitmapMode4(dispcnt);
      else renderTiled(dispcnt);
      if (mode === 3 || mode === 4) renderSprites(dispcnt);
      return image;
    },
  };
}
