import { stat } from "node:fs/promises";
import { inflateSync } from "node:zlib";
import { z } from "zod";
import { runCommand as defaultRunCommand } from "#activities/data-dragon/data-dragon-shell.ts";
import { captureBinaryCommand } from "#activities/command-runner.ts";

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

export const DEFAULT_MAX_DIFF_PIXEL_RATIO = 0.005;
export const DEFAULT_DISCORD_HEADER_MAX_Y = 160;
export const DEFAULT_TARGET_ASSET_KINDS = ["discord-screenshot"] as const;

type RunCommand = typeof defaultRunCommand;

export const ShowcaseAssetFileSchema = z.looseObject({
  version: z.number().optional(),
  generatedAt: z.string().optional(),
  assets: z.array(z.record(z.string(), z.unknown())).optional(),
});

export type ParsedPng = {
  width: number;
  height: number;
  colorType: number;
  bpp: number;
  pixels: Buffer;
};

export type ComparePngOptions = {
  maxAllowedY?: number | undefined;
  maxDiffPixelRatio?: number | undefined;
};

export type PngComparisonResult = {
  identicalDimensions: boolean;
  diffPixels: number;
  totalPixels: number;
  diffRatio: number;
  diffOutsideRegion: number;
  hasArbitraryChanges: boolean;
};

function priorByte(filter: number, a: number, b: number, c: number): number {
  if (filter === 0) return 0;
  if (filter === 1) return a;
  if (filter === 2) return b;
  if (filter === 3) return Math.floor((a + b) / 2);
  if (filter === 4) {
    const p = a + b - c;
    const da = Math.abs(p - a);
    return da <= Math.abs(p - b) && da <= Math.abs(p - c)
      ? a
      : Math.abs(p - b) <= Math.abs(p - c)
        ? b
        : c;
  }
  throw new Error(`Unknown PNG filter type: ${String(filter)}`);
}

type PngRawChunks = {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  idatParts: Buffer[];
};

function extractPngChunks(buf: Buffer): PngRawChunks {
  if (buf.length < 8) throw new Error("Invalid PNG: file too short");
  for (let i = 0; i < 8; i++) {
    if (buf[i] !== PNG_SIGNATURE[i]) throw new Error("Invalid PNG signature");
  }

  let idx = 8;
  const state = { width: 0, height: 0, bitDepth: 0, colorType: 0 };
  const idatParts: Buffer[] = [];

  while (idx + 8 <= buf.length) {
    const len = buf.readUInt32BE(idx);
    const type = buf.toString("ascii", idx + 4, idx + 8);
    const start = idx + 8,
      end = start + len;
    if (end + 4 > buf.length)
      throw new Error(`Invalid PNG: chunk ${type} extends past buffer`);
    switch (type) {
      case "IHDR":
        state.width = buf.readUInt32BE(start);
        state.height = buf.readUInt32BE(start + 4);
        state.bitDepth = buf.readUInt8(start + 8);
        state.colorType = buf.readUInt8(start + 9);
        break;
      case "IDAT":
        idatParts.push(buf.subarray(start, end));
        break;
      case "IEND":
        return { ...state, idatParts };
    }
    idx = end + 4;
  }
  return { ...state, idatParts };
}

function unfilterScanlines(
  raw: Buffer,
  w: number,
  h: number,
  bpp: number,
): Buffer {
  const stride = 1 + w * bpp;
  if (raw.length < h * stride) {
    throw new Error(
      `Invalid PNG: decompressed size ${String(raw.length)} less than expected ${String(h * stride)}`,
    );
  }
  const pixels = Buffer.alloc(w * h * bpp);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * stride] ?? 0;
    const src = y * stride + 1,
      dst = y * w * bpp,
      prev = (y - 1) * w * bpp;
    for (let x = 0; x < w * bpp; x++) {
      const a = x >= bpp ? (pixels[dst + x - bpp] ?? 0) : 0;
      const b = y > 0 ? (pixels[prev + x] ?? 0) : 0;
      const c = x >= bpp && y > 0 ? (pixels[prev + x - bpp] ?? 0) : 0;
      pixels[dst + x] =
        ((raw[src + x] ?? 0) + priorByte(filter, a, b, c)) & 0xff;
    }
  }
  return pixels;
}

export function parsePngPixels(bytes: Uint8Array): ParsedPng {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const { width, height, bitDepth, colorType, idatParts } =
    extractPngChunks(buf);
  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) {
    throw new Error(
      `Unsupported PNG: bitDepth=${String(bitDepth)}, colorType=${String(colorType)} (expected 8-bit RGB or RGBA)`,
    );
  }
  const bpp = colorType === 6 ? 4 : 3;
  const pixels = unfilterScanlines(
    inflateSync(Buffer.concat(idatParts)),
    width,
    height,
    bpp,
  );
  return { width, height, colorType, bpp, pixels };
}

function localMaxDelta(img: ParsedPng, cx: number, cy: number): number {
  const { pixels, width, bpp } = img;
  const center = (cy * width + cx) * bpp;
  let max = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const n = ((cy + dy) * width + (cx + dx)) * bpp;
      const d =
        Math.abs((pixels[center] ?? 0) - (pixels[n] ?? 0)) +
        Math.abs((pixels[center + 1] ?? 0) - (pixels[n + 1] ?? 0)) +
        Math.abs((pixels[center + 2] ?? 0) - (pixels[n + 2] ?? 0));
      if (d > max) max = d;
    }
  }
  return max;
}

function hasSolidBlock(
  grid: Uint8Array,
  points: readonly { x: number; y: number }[],
  width: number,
  maxY: number,
): boolean {
  return points.some(({ x, y }) => {
    if (x + 6 > width || y + 6 > maxY) return false;
    for (let dy = 0; dy < 6; dy++) {
      for (let dx = 0; dx < 6; dx++) {
        if (grid[(y + dy) * width + (x + dx)] !== 1) return false;
      }
    }
    return true;
  });
}

function hasContrast(img: ParsedPng, x: number, y: number): boolean {
  return (
    x >= 1 &&
    x < img.width - 1 &&
    y >= 1 &&
    y < img.height - 1 &&
    localMaxDelta(img, x, y) >= 40
  );
}

function isNearEdge(img: ParsedPng, x: number, y: number): boolean {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      if (hasContrast(img, x + dx, y + dy)) return true;
    }
  }
  return false;
}

function isPointNearEdge(
  images: { a: ParsedPng; b: ParsedPng },
  x: number,
  y: number,
): boolean {
  return isNearEdge(images.a, x, y) && isNearEdge(images.b, x, y);
}

function detectArbitraryHeaderChanges(
  images: { a: ParsedPng; b: ParsedPng },
  points: readonly { x: number; y: number }[],
  grid: Uint8Array,
  maxY: number,
): boolean {
  if (hasSolidBlock(grid, points, images.a.width, maxY)) return true;
  return points.some(({ x, y }) => {
    const flat =
      localMaxDelta(images.a, x, y) <= 10 &&
      localMaxDelta(images.b, x, y) <= 10;
    return flat || !isPointNearEdge(images, x, y);
  });
}

function countPixelDeltas(
  imgA: ParsedPng,
  imgB: ParsedPng,
  maxAllowedY?: number,
): [number, number, { x: number; y: number }[], Uint8Array] {
  const { width, bpp, pixels: pixA } = imgA;
  const { pixels: pixB } = imgB;
  let diffPixels = 0;
  let diffOutsideRegion = 0;
  const diffPoints: { x: number; y: number }[] = [];
  const diffGrid =
    maxAllowedY === undefined
      ? new Uint8Array(0)
      : new Uint8Array(width * maxAllowedY);

  for (let i = 0; i < pixA.length; i += bpp) {
    const alphaZero =
      bpp === 4 && (pixA[i + 3] ?? 0) === 0 && (pixB[i + 3] ?? 0) === 0;
    const alphaDiff = bpp === 4 && (pixA[i + 3] ?? 0) !== (pixB[i + 3] ?? 0);
    const rgbDiff =
      pixA[i] !== pixB[i] ||
      pixA[i + 1] !== pixB[i + 1] ||
      pixA[i + 2] !== pixB[i + 2];
    if (alphaZero || (!alphaDiff && !rgbDiff)) continue;
    diffPixels++;
    if (maxAllowedY !== undefined) {
      const idx = i / bpp;
      const y = Math.floor(idx / width),
        x = idx % width;
      if (y >= maxAllowedY) diffOutsideRegion++;
      else {
        diffPoints.push({ x, y });
        diffGrid[y * width + x] = 1;
      }
    }
  }
  return [diffPixels, diffOutsideRegion, diffPoints, diffGrid];
}

export function comparePngImages(
  bytesA: Uint8Array,
  bytesB: Uint8Array,
  options?: ComparePngOptions,
): PngComparisonResult {
  const imgA = parsePngPixels(bytesA);
  const imgB = parsePngPixels(bytesB);
  const totalPixels = imgA.width * imgA.height;

  if (
    imgA.width !== imgB.width ||
    imgA.height !== imgB.height ||
    imgA.colorType !== imgB.colorType
  ) {
    return {
      identicalDimensions: false,
      diffPixels: totalPixels,
      totalPixels,
      diffRatio: 1,
      diffOutsideRegion: totalPixels,
      hasArbitraryChanges: true,
    };
  }

  const [diffPixels, diffOutsideRegion, diffPoints, diffGrid] =
    countPixelDeltas(imgA, imgB, options?.maxAllowedY);

  const diffRatio = totalPixels > 0 ? diffPixels / totalPixels : 0;
  const maxDiffRatio =
    options?.maxDiffPixelRatio ?? DEFAULT_MAX_DIFF_PIXEL_RATIO;
  const hasArbitraryChanges =
    options?.maxAllowedY === undefined
      ? diffPixels > 0
      : diffOutsideRegion > 0 ||
        diffRatio > maxDiffRatio ||
        (diffPixels > 0 &&
          detectArbitraryHeaderChanges(
            { a: imgA, b: imgB },
            diffPoints,
            diffGrid,
            options.maxAllowedY,
          ));

  return {
    identicalDimensions: true,
    diffPixels,
    totalPixels,
    diffRatio,
    diffOutsideRegion,
    hasArbitraryChanges,
  };
}

async function defaultReadBaselineBytes(
  cwd: string,
  gitPath: string,
): Promise<Uint8Array> {
  const res = await captureBinaryCommand(["git", "show", gitPath], { cwd });
  if (res.exitCode !== 0)
    throw new Error(`Git show failed ${gitPath}: ${res.stderr}`);
  return res.stdout;
}

const ShowcaseRecordSchema = z.record(z.string(), z.unknown());
const ShowcaseAssetsArraySchema = z.array(ShowcaseRecordSchema);

async function readEligibleAssetFileNames(
  assetIndexPath: string,
  targetKinds: readonly string[],
): Promise<Set<string>> {
  const indexFile = Bun.file(assetIndexPath);
  if (!(await indexFile.exists())) return new Set();
  const raw: unknown = JSON.parse(await indexFile.text());
  const parsed = ShowcaseAssetFileSchema.parse(raw);
  const names = (parsed.assets ?? []).flatMap((a) => {
    const fn = a["fileName"],
      k = a["kind"];
    return typeof fn === "string" &&
      typeof k === "string" &&
      targetKinds.includes(k)
      ? [fn]
      : [];
  });
  return new Set(names);
}

async function updateAssetIndexLengths(
  assetIndexPath: string,
  repoDir: string,
  revertedPaths: readonly string[],
): Promise<void> {
  const indexFile = Bun.file(assetIndexPath);
  if (!(await indexFile.exists())) return;
  const raw: unknown = JSON.parse(await indexFile.text());
  ShowcaseAssetFileSchema.parse(raw);
  const root = ShowcaseRecordSchema.parse(raw);
  const assets = ShowcaseAssetsArraySchema.parse(root["assets"]);
  let updated = false;
  for (const asset of assets) {
    const fn = asset["fileName"];
    const match =
      typeof fn === "string"
        ? revertedPaths.find((p) => p.endsWith(`/${fn}`))
        : undefined;
    if (match === undefined) continue;
    const fileStat = await stat(`${repoDir}/${match}`);
    if (asset["byteLength"] !== fileStat.size) {
      asset["byteLength"] = fileStat.size;
      updated = true;
    }
  }
  if (updated) {
    root["assets"] = assets;
    await Bun.write(assetIndexPath, `${JSON.stringify(root, null, 2)}\n`);
  }
}

export type DiscardShowcaseImageNoiseInput = {
  repoDir: string;
  changedFiles: readonly string[];
  assetIndexPath?: string | undefined;
  component?: string | undefined;
  maxDiffPixelRatio?: number | undefined;
  maxAllowedY?: number | undefined;
  targetAssetKinds?: readonly string[] | undefined;
  runCommand?: RunCommand | undefined;
  readBaselineBytes?:
    ((repoDir: string, gitPath: string) => Promise<Uint8Array>) | undefined;
};

type RestoreOptions = ComparePngOptions & {
  readBaseline: (d: string, p: string) => Promise<Uint8Array>;
};

async function shouldRestoreImage(
  path: string,
  repoDir: string,
  opts: RestoreOptions,
  runCommand: RunCommand,
): Promise<boolean> {
  const fullPath = `${repoDir}/${path}`;
  if (!(await Bun.file(fullPath).exists())) return false;
  const tracked = await runCommand(["git", "ls-files", "--", path], {
    cwd: repoDir,
  });
  if (tracked.length === 0) return false;
  try {
    const [curr, base] = await Promise.all([
      Bun.file(fullPath).bytes(),
      opts.readBaseline(repoDir, `HEAD:${path}`),
    ]);
    const cmp = comparePngImages(curr, base, opts);
    return (
      cmp.identicalDimensions &&
      cmp.diffOutsideRegion === 0 &&
      cmp.diffRatio <=
        (opts.maxDiffPixelRatio ?? DEFAULT_MAX_DIFF_PIXEL_RATIO) &&
      !cmp.hasArbitraryChanges
    );
  } catch {
    return false;
  }
}

export async function discardShowcaseImageNoise(
  input: DiscardShowcaseImageNoiseInput,
): Promise<string[]> {
  const runCommand = input.runCommand ?? defaultRunCommand;
  const readBaseline = input.readBaselineBytes ?? defaultReadBaselineBytes;
  const maxDiffPixelRatio =
    input.maxDiffPixelRatio ?? DEFAULT_MAX_DIFF_PIXEL_RATIO;
  const maxAllowedY = input.maxAllowedY ?? DEFAULT_DISCORD_HEADER_MAX_Y;
  const targetKinds = input.targetAssetKinds ?? DEFAULT_TARGET_ASSET_KINDS;

  const pngPaths = input.changedFiles.filter((path) => path.endsWith(".png"));
  if (pngPaths.length === 0) return [];

  const eligibleFileNames =
    input.assetIndexPath === undefined
      ? undefined
      : await readEligibleAssetFileNames(input.assetIndexPath, targetKinds);
  const eligiblePaths =
    eligibleFileNames === undefined
      ? pngPaths
      : pngPaths.filter((p) => {
          const fn = p.split("/").pop();
          return fn !== undefined && eligibleFileNames.has(fn);
        });
  if (eligiblePaths.length === 0) return [];

  const reverted: string[] = [];
  const opts = { maxAllowedY, maxDiffPixelRatio, readBaseline };
  for (const path of eligiblePaths) {
    if (await shouldRestoreImage(path, input.repoDir, opts, runCommand)) {
      await runCommand(["git", "restore", "--", path], { cwd: input.repoDir });
      reverted.push(path);
    }
  }

  if (reverted.length > 0 && input.assetIndexPath !== undefined) {
    await updateAssetIndexLengths(
      input.assetIndexPath,
      input.repoDir,
      reverted,
    );
    console.warn(
      JSON.stringify({
        level: "info",
        msg: "Generated refresh discarded showcase image noise",
        component: input.component ?? "temporal-generated-refresh",
        files: reverted,
      }),
    );
  }

  return reverted;
}
