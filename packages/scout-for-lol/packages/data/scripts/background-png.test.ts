import { describe, expect, test } from "vitest";
import sharp from "sharp";
import { backgroundPngWithinBudget } from "./background-png.ts";

describe("background PNG asset budget", () => {
  test("preserves pixels, dimensions and alpha when recompressing oversized input", async () => {
    const pixels = Buffer.alloc(128 * 64 * 4);
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = i % 256;
      pixels[i + 1] = 90;
      pixels[i + 2] = 190;
      pixels[i + 3] = i % 128;
    }
    const original = await sharp(pixels, {
      raw: { width: 128, height: 64, channels: 4 },
    })
      .png({ compressionLevel: 0 })
      .toBuffer();
    const output = await backgroundPngWithinBudget(original, 4096);
    expect(output.byteLength).toBeLessThanOrEqual(4096);
    expect(await sharp(output).metadata()).toMatchObject({
      width: 128,
      height: 64,
      channels: 4,
      hasAlpha: true,
    });
    expect(await sharp(output).raw().toBuffer()).toEqual(pixels);
  });

  test("retains the original bytes when they already fit", async () => {
    const original = new Uint8Array([1, 2, 3]);
    expect(await backgroundPngWithinBudget(original, 3)).toBe(original);
  });

  test("still rejects an image that cannot fit losslessly", async () => {
    const input = await sharp({
      create: { width: 10, height: 10, channels: 3, background: "red" },
    })
      .png()
      .toBuffer();
    await expect(backgroundPngWithinBudget(input, 1)).rejects.toThrow(
      "Losslessly compressed background exceeds",
    );
  });
});
