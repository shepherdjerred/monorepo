import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { cueNames, synthesizeCue } from "./feedback-synthesis.ts";
import {
  constantSchema,
  paletteOutputs,
  presentationDirectory,
  producePalette,
} from "./generate-feedback-palette.ts";

function samples(bytes: Uint8Array): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Array.from({ length: (bytes.length - 44) / 2 }, (_, index) =>
    view.getInt16(44 + index * 2, true),
  );
}
function energy(values: number[], start: number, milliseconds: number): number {
  const window = values.slice(start * 48, (start + milliseconds) * 48);
  return (
    window.reduce((total, value) => total + value * value, 0) / window.length
  );
}

describe("first-party coordinated feedback palette", () => {
  test("ships deterministic distinct PCM16 WAVs within duration, peak and envelope limits", async () => {
    const checksums = new Set<string>();
    for (const name of cueNames) {
      const bytes = synthesizeCue(name);
      expect(synthesizeCue(name)).toEqual(bytes);
      const view = new DataView(bytes.buffer);
      const ascii = (start: number, end: number): string =>
        new TextDecoder().decode(bytes.slice(start, end));
      expect(ascii(0, 4)).toBe("RIFF");
      expect(ascii(8, 16)).toBe("WAVEfmt ");
      expect(ascii(36, 40)).toBe("data");
      expect(view.getUint32(4, true)).toBe(bytes.length - 8);
      expect(view.getUint32(40, true)).toBe(bytes.length - 44);
      expect(view.getUint16(20, true)).toBe(1);
      expect(view.getUint16(22, true)).toBe(1);
      expect(view.getUint32(24, true)).toBe(48_000);
      expect(view.getUint32(28, true)).toBe(96_000);
      expect(view.getUint16(32, true)).toBe(2);
      expect(view.getUint16(34, true)).toBe(16);
      const pcm = samples(bytes);
      const peak = pcm.reduce(
        (maximum, value) => Math.max(maximum, Math.abs(value)),
        0,
      );
      expect(pcm.length / 48).toBeLessThanOrEqual(220);
      expect(20 * Math.log10(peak / 32_768)).toBeLessThanOrEqual(-9);
      expect(peak).toBeGreaterThan(5000);
      expect(pcm[0]).toBe(0);
      expect(pcm.at(-1)).toBe(0);
      expect(Math.max(...pcm.slice(-96).map(Math.abs))).toBeLessThan(10);
      expect(
        Math.abs(pcm.reduce((sum, value) => sum + value, 0) / pcm.length),
      ).toBeLessThan(20);
      const bundled = new Uint8Array(
        await Bun.file(
          `${presentationDirectory}/audio/${name}.wav`,
        ).arrayBuffer(),
      );
      expect(bundled).toEqual(bytes);
      checksums.add(new Bun.CryptoHasher("sha256").update(bytes).digest("hex"));
    }
    expect(checksums.size).toBe(4);
  });

  test("completion has two transients while add, delete and reverse decay", () => {
    const completion = samples(synthesizeCue("complete"));
    expect(energy(completion, 70, 10)).toBeGreaterThan(
      energy(completion, 50, 10) * 4,
    );
    expect(energy(completion, 0, 10)).toBeGreaterThan(
      energy(completion, 50, 10) * 4,
    );
    for (const name of ["create", "delete", "reverse"] as const) {
      const pcm = samples(synthesizeCue(name));
      expect(energy(pcm, 10, 10)).toBeGreaterThan(energy(pcm, 60, 10) * 4);
    }
  });

  test("policy schemas require every field, reject extra keys and pin nested values", () => {
    expect(
      constantSchema({
        sounds: true,
        silent: null,
        identity: ["session", "receipt"],
      }),
    ).toEqual({
      type: "object",
      additionalProperties: false,
      required: ["sounds", "silent", "identity"],
      properties: {
        sounds: { type: "boolean", const: true },
        silent: { type: "null", const: null },
        identity: { type: "array", const: ["session", "receipt"] },
      },
    });
  });

  test("normal check verifies committed schema, palette metadata and all four exact assets", async () => {
    expect((await paletteOutputs()).size).toBe(6);
    await expect(producePalette(false)).resolves.toBeUndefined();
  });

  test("check fails on modified or missing output without regenerating it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "facet-feedback-"));
    try {
      await Bun.write(
        join(directory, "feedback.json"),
        await Bun.file(`${presentationDirectory}/feedback.json`).text(),
      );
      await producePalette(true, directory);
      const path = join(directory, "audio/create.wav");
      await Bun.write(path, "damaged");
      await expect(producePalette(false, directory)).rejects.toThrow(
        "producer drift: audio/create.wav",
      );
      expect(await Bun.file(path).text()).toBe("damaged");
      await rm(path);
      await expect(producePalette(false, directory)).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true });
    }
  });
});
