import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { deflateSync } from "node:zlib";
import { afterEach, describe, expect, test } from "vitest";
import {
  ShowcaseAssetFileSchema,
  comparePngImages,
  discardShowcaseImageNoise,
  parsePngPixels,
} from "./scout-image-drift.ts";
import { runCommand as shellRunCommand } from "#activities/data-dragon/data-dragon-shell.ts";

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(Bun.hash.crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function createTestPng(
  width: number,
  height: number,
  fillOrPixels: { r: number; g: number; b: number; a: number } | Buffer,
): Uint8Array {
  const bpp = 4;
  const pixels = Buffer.isBuffer(fillOrPixels)
    ? fillOrPixels
    : Buffer.alloc(width * height * bpp);

  if (!Buffer.isBuffer(fillOrPixels)) {
    for (let i = 0; i < pixels.length; i += bpp) {
      pixels[i] = fillOrPixels.r;
      pixels[i + 1] = fillOrPixels.g;
      pixels[i + 2] = fillOrPixels.b;
      pixels[i + 3] = fillOrPixels.a;
    }
  }

  const stride = 1 + width * bpp;
  const raw = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0;
    pixels.copy(raw, y * stride + 1, y * width * bpp, (y + 1) * width * bpp);
  }

  const idatData = deflateSync(raw);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idatData),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function createBaselinePng(
  width = 100,
  height = 100,
): { bytes: Uint8Array; buffer: Buffer } {
  const buffer = Buffer.alloc(width * height * 4, 50);
  for (let i = 3; i < buffer.length; i += 4) buffer[i] = 255;
  for (let y = 10; y <= 70; y++) {
    for (let x = 10; x <= 20; x++) {
      buffer.fill(200, (y * width + x) * 4, (y * width + x) * 4 + 3);
    }
  }
  return { bytes: createTestPng(width, height, buffer), buffer };
}

function createEdgeDriftPng(
  baseBuffer: Buffer,
  width = 100,
  height = 100,
  driftPixelCount = 10,
): Uint8Array {
  const copy = Buffer.from(baseBuffer);
  for (let p = 0; p < driftPixelCount; p++) {
    const y = 10 + Math.floor(p / 2);
    const x = p % 2 === 0 ? 9 : 21;
    const idx = (y * width + x) * 4;
    copy[idx] = 80;
    copy[idx + 1] = 80;
    copy[idx + 2] = 80;
  }
  return createTestPng(width, height, copy);
}

async function assertImageNotReverted(params: {
  repoDir: string;
  pngPath: string;
  assetIndexPath: string;
  maxAllowedY?: number | undefined;
}): Promise<void> {
  const reverted = await discardShowcaseImageNoise({
    repoDir: params.repoDir,
    changedFiles: [params.pngPath],
    assetIndexPath: params.assetIndexPath,
    maxAllowedY: params.maxAllowedY,
    component: "test",
  });
  expect(reverted).toEqual([]);
  const status = await shellRunCommand(["git", "status", "--porcelain"], {
    cwd: params.repoDir,
  });
  expect(status).toContain(params.pngPath);
}

describe("parsePngPixels", () => {
  test("throws on invalid PNG signature", () => {
    expect(() => parsePngPixels(new Uint8Array([1, 2, 3, 4]))).toThrow(
      "Invalid PNG: file too short",
    );
    expect(() => parsePngPixels(new Uint8Array(10))).toThrow(
      "Invalid PNG signature",
    );
  });

  test("correctly parses valid RGBA PNG", () => {
    const png = createTestPng(2, 2, { r: 10, g: 20, b: 30, a: 255 });
    const parsed = parsePngPixels(png);
    expect(parsed.width).toBe(2);
    expect(parsed.height).toBe(2);
    expect(parsed.bpp).toBe(4);
    expect(parsed.pixels.length).toBe(16);
    expect(parsed.pixels[0]).toBe(10);
    expect(parsed.pixels[1]).toBe(20);
    expect(parsed.pixels[2]).toBe(30);
    expect(parsed.pixels[3]).toBe(255);
  });
});

describe("comparePngImages", () => {
  test("returns zero diff for identical images", () => {
    const png1 = createTestPng(10, 10, { r: 100, g: 150, b: 200, a: 255 });
    const png2 = createTestPng(10, 10, { r: 100, g: 150, b: 200, a: 255 });
    const res = comparePngImages(png1, png2);
    expect(res.identicalDimensions).toBe(true);
    expect(res.diffPixels).toBe(0);
    expect(res.diffRatio).toBe(0);
  });

  test("returns diffRatio = 1 for different dimensions", () => {
    const png1 = createTestPng(10, 10, { r: 100, g: 150, b: 200, a: 255 });
    const png2 = createTestPng(10, 12, { r: 100, g: 150, b: 200, a: 255 });
    const res = comparePngImages(png1, png2);
    expect(res.identicalDimensions).toBe(false);
    expect(res.diffRatio).toBe(1);
  });

  test("ignores RGB differences on fully transparent pixels (alpha === 0)", () => {
    const png1 = createTestPng(10, 10, { r: 255, g: 255, b: 255, a: 0 });
    const png2 = createTestPng(10, 10, { r: 0, g: 0, b: 0, a: 0 });
    const res = comparePngImages(png1, png2);
    expect(res.identicalDimensions).toBe(true);
    expect(res.diffPixels).toBe(0);
    expect(res.diffRatio).toBe(0);
  });

  test("counts pixel differences when visible", () => {
    const buf1 = Buffer.alloc(100 * 4, 128);
    const buf2 = Buffer.from(buf1);
    // Alter 2 pixels out of 100
    buf2[0] = 200;
    buf2[4] = 200;

    const png1 = createTestPng(10, 10, buf1);
    const png2 = createTestPng(10, 10, buf2);
    const res = comparePngImages(png1, png2);
    expect(res.identicalDimensions).toBe(true);
    expect(res.diffPixels).toBe(2);
    expect(res.diffRatio).toBe(0.02);
  });

  test("tracks pixel differences outside maxAllowedY region", () => {
    const buf1 = Buffer.alloc(10 * 10 * 4, 128);
    const buf2 = Buffer.from(buf1);
    // Alter pixel at (x=0, y=2) -> index = (2 * 10 + 0) * 4 = 80
    buf2[80] = 200;
    // Alter pixel at (x=0, y=6) -> index = (6 * 10 + 0) * 4 = 240
    buf2[240] = 200;

    const png1 = createTestPng(10, 10, buf1);
    const png2 = createTestPng(10, 10, buf2);
    const res = comparePngImages(png1, png2, { maxAllowedY: 5 });
    expect(res.diffPixels).toBe(2);
    expect(res.diffOutsideRegion).toBe(1);
  });

  test("flags arbitrary header changes for solid blocks", () => {
    const { bytes: basePng, buffer: baseBuf } = createBaselinePng(100, 100);
    const modBuf = Buffer.from(baseBuf);
    for (let y = 10; y <= 16; y++) {
      for (let x = 40; x <= 46; x++) {
        const idx = (y * 100 + x) * 4;
        modBuf[idx] = 255;
        modBuf[idx + 1] = 0;
        modBuf[idx + 2] = 0;
      }
    }
    const res = comparePngImages(basePng, createTestPng(100, 100, modBuf), {
      maxAllowedY: 160,
    });
    expect(res.hasArbitraryChanges).toBe(true);
  });

  test("flags arbitrary header changes for flat pixel edits", () => {
    const { bytes: basePng, buffer: baseBuf } = createBaselinePng(100, 100);
    const modBuf = Buffer.from(baseBuf);
    for (let y = 10; y <= 12; y++) {
      for (let x = 40; x <= 42; x++) {
        const idx = (y * 100 + x) * 4;
        modBuf[idx] = 80;
        modBuf[idx + 1] = 80;
        modBuf[idx + 2] = 80;
      }
    }
    const res = comparePngImages(basePng, createTestPng(100, 100, modBuf), {
      maxAllowedY: 160,
    });
    expect(res.hasArbitraryChanges).toBe(true);
  });

  test("accepts subpixel anti-aliasing edge drift along stroke boundaries", () => {
    const { bytes: basePng, buffer: baseBuf } = createBaselinePng(100, 100);
    const driftPng = createEdgeDriftPng(baseBuf, 100, 100, 10);
    const res = comparePngImages(basePng, driftPng, { maxAllowedY: 160 });
    expect(res.diffPixels).toBe(10);
    expect(res.hasArbitraryChanges).toBe(false);
  });
});

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function createRepository(): Promise<{
  repoDir: string;
  pngPath: string;
  assetIndexPath: string;
  baselinePngBytes: Uint8Array;
  baselineBuffer: Buffer;
}> {
  const repoDir = await mkdtemp(`${tmpdir()}/scout-image-drift-test-`);
  temporaryDirectories.push(repoDir);

  const runGit = (args: string[]) => shellRunCommand(args, { cwd: repoDir });
  await runGit(["git", "init", "-q"]);
  await runGit(["git", "config", "user.email", "test@example.com"]);
  await runGit(["git", "config", "user.name", "Test"]);

  const relPngDir = "packages/scout-for-lol/public";
  const relPngFile = "showcase.png";
  const relPngPath = `${relPngDir}/${relPngFile}`;
  const relIndexPath = "packages/scout-for-lol/assets.json";

  const { bytes: baselinePngBytes, buffer: baselineBuffer } =
    createBaselinePng();
  await Bun.write(`${repoDir}/${relPngPath}`, baselinePngBytes, {
    createPath: true,
  });

  const initialAssetIndex = {
    version: 1,
    generatedAt: "2026-01-01T00:00:00.000Z",
    assets: [
      {
        id: "showcase-1",
        title: "Showcase 1",
        group: "Group 1",
        kind: "discord-screenshot",
        fileName: relPngFile,
        byteLength: baselinePngBytes.length,
      },
    ],
  };

  await Bun.write(
    `${repoDir}/${relIndexPath}`,
    `${JSON.stringify(initialAssetIndex, null, 2)}\n`,
    { createPath: true },
  );

  await runGit(["git", "add", "."]);
  await runGit(["git", "commit", "-qm", "baseline"]);

  return {
    repoDir,
    pngPath: relPngPath,
    assetIndexPath: `${repoDir}/${relIndexPath}`,
    baselinePngBytes,
    baselineBuffer,
  };
}

describe("discardShowcaseImageNoise", () => {
  test("reverts PNG and restores asset index byteLength when drift is within threshold", async () => {
    const {
      repoDir,
      pngPath,
      assetIndexPath,
      baselinePngBytes,
      baselineBuffer,
    } = await createRepository();

    const modifiedPngBytes = createEdgeDriftPng(baselineBuffer, 100, 100, 10);
    await Bun.write(`${repoDir}/${pngPath}`, modifiedPngBytes);

    const root = ShowcaseAssetFileSchema.parse(
      JSON.parse(await Bun.file(assetIndexPath).text()),
    );
    if (root.assets?.[0] !== undefined) {
      root.assets[0]["byteLength"] = modifiedPngBytes.length;
    }
    await Bun.write(assetIndexPath, `${JSON.stringify(root, null, 2)}\n`);

    // Verify git sees changes before preflight
    const statusBefore = await shellRunCommand(
      ["git", "status", "--porcelain"],
      {
        cwd: repoDir,
      },
    );
    expect(statusBefore).toContain(pngPath);

    const reverted = await discardShowcaseImageNoise({
      repoDir,
      changedFiles: [pngPath, "packages/scout-for-lol/assets.json"],
      assetIndexPath,
      component: "test",
    });

    expect(reverted).toEqual([pngPath]);

    // Check git status after preflight: PNG should be clean!
    const statusAfter = await shellRunCommand(
      ["git", "status", "--porcelain"],
      {
        cwd: repoDir,
      },
    );
    expect(statusAfter).not.toContain(pngPath);

    // Asset index byteLength should be restored to baseline length!
    const restoredRaw: unknown = JSON.parse(
      await Bun.file(assetIndexPath).text(),
    );
    expect(
      typeof restoredRaw === "object" &&
        restoredRaw !== null &&
        Object.keys(restoredRaw),
    ).toEqual(["version", "generatedAt", "assets"]);
    const restoredIndex = ShowcaseAssetFileSchema.parse(restoredRaw);
    expect(restoredIndex.assets?.[0]?.["byteLength"]).toBe(
      baselinePngBytes.length,
    );
    const firstRestoredAsset = restoredIndex.assets?.[0];
    expect(firstRestoredAsset).toBeDefined();
    if (firstRestoredAsset !== undefined) {
      expect(Object.keys(firstRestoredAsset)).toEqual([
        "id",
        "title",
        "group",
        "kind",
        "fileName",
        "byteLength",
      ]);
    }
  });

  test("fails loudly when asset index is invalid JSON during length repair", async () => {
    const { repoDir, pngPath, assetIndexPath, baselineBuffer } =
      await createRepository();
    await Bun.write(assetIndexPath, "invalid json");
    await Bun.write(
      `${repoDir}/${pngPath}`,
      createEdgeDriftPng(baselineBuffer, 100, 100, 5),
    );
    await expect(
      discardShowcaseImageNoise({
        repoDir,
        changedFiles: [pngPath],
        assetIndexPath,
      }),
    ).rejects.toThrow();
  });

  test("leaves PNG alone when drift exceeds threshold", async () => {
    const { repoDir, pngPath, assetIndexPath, baselineBuffer } =
      await createRepository();

    // Modify 60 edge pixels (> 50 pixels threshold = 0.5%)
    const modifiedPngBytes = createEdgeDriftPng(baselineBuffer, 100, 100, 60);
    await Bun.write(`${repoDir}/${pngPath}`, modifiedPngBytes);

    await assertImageNotReverted({ repoDir, pngPath, assetIndexPath });
  });

  test("leaves PNG alone when header changes contain solid blocks (e.g. avatar recolor)", async () => {
    const { repoDir, pngPath, assetIndexPath, baselineBuffer } =
      await createRepository();
    const copy = Buffer.from(baselineBuffer);
    for (let y = 10; y <= 16; y++) {
      for (let x = 40; x <= 46; x++) {
        copy[(y * 100 + x) * 4] = 255;
      }
    }
    await Bun.write(`${repoDir}/${pngPath}`, createTestPng(100, 100, copy));
    await assertImageNotReverted({ repoDir, pngPath, assetIndexPath });
  });

  test("leaves PNG alone when header changes alter flat regions (e.g. appNameColor)", async () => {
    const { repoDir, pngPath, assetIndexPath, baselineBuffer } =
      await createRepository();
    const copy = Buffer.from(baselineBuffer);
    for (let y = 10; y <= 12; y++) {
      for (let x = 40; x <= 42; x++) {
        copy[(y * 100 + x) * 4] = 80;
      }
    }
    await Bun.write(`${repoDir}/${pngPath}`, createTestPng(100, 100, copy));
    await assertImageNotReverted({ repoDir, pngPath, assetIndexPath });
  });

  test("skips untracked PNG files", async () => {
    const { repoDir, assetIndexPath } = await createRepository();
    const untrackedPng = "packages/scout-for-lol/public/new.png";
    await Bun.write(
      `${repoDir}/${untrackedPng}`,
      createTestPng(10, 10, { r: 1, g: 1, b: 1, a: 255 }),
      { createPath: true },
    );

    const reverted = await discardShowcaseImageNoise({
      repoDir,
      changedFiles: [untrackedPng],
      assetIndexPath,
      component: "test",
    });

    expect(reverted).toEqual([]);
  });

  test("skips non-target asset kinds like s3-image even if drift is within threshold", async () => {
    const { repoDir, pngPath, assetIndexPath, baselineBuffer } =
      await createRepository();

    const raw: unknown = JSON.parse(await Bun.file(assetIndexPath).text());
    const index = ShowcaseAssetFileSchema.parse(raw);
    if (index.assets?.[0]) index.assets[0]["kind"] = "s3-image";
    await Bun.write(assetIndexPath, `${JSON.stringify(index, null, 2)}\n`);
    await Bun.write(
      `${repoDir}/${pngPath}`,
      createEdgeDriftPng(baselineBuffer, 100, 100, 5),
    );
    await assertImageNotReverted({ repoDir, pngPath, assetIndexPath });
  });

  test("leaves image alone when diffs occur outside maxAllowedY", async () => {
    const { repoDir, pngPath, assetIndexPath } = await createRepository();
    const buf = Buffer.alloc(100 * 100 * 4, 50);
    for (let i = 3; i < buf.length; i += 4) buf[i] = 255;
    for (let row = 80; row < 85; row++) buf[row * 100 * 4] = 90;
    await Bun.write(`${repoDir}/${pngPath}`, createTestPng(100, 100, buf));
    await assertImageNotReverted({
      repoDir,
      pngPath,
      assetIndexPath,
      maxAllowedY: 50,
    });
  });
});
