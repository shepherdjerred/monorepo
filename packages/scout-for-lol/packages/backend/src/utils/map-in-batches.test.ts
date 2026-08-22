import { describe, expect, test } from "vitest";
import { mapInBatches } from "#src/utils/map-in-batches.ts";

describe("mapInBatches", () => {
  test("bounds concurrency and preserves input order", async () => {
    let active = 0;
    let peak = 0;
    const output = await mapInBatches([1, 2, 3, 4, 5], 2, async (value) => {
      active++;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active--;
      return value * 2;
    });

    expect(peak).toBe(2);
    expect(output).toEqual([2, 4, 6, 8, 10]);
  });

  test("rejects an invalid batch size", async () => {
    await expect(mapInBatches([1], 0, async (value) => value)).rejects.toThrow(
      "Batch size must be a positive integer.",
    );
  });
});
