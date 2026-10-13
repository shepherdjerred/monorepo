import { describe, expect, test } from "vitest";
import path from "node:path";
import { expandedKitWeights } from "./expanded-kit-weights.ts";

const BOTS = path.join(
  import.meta.dir,
  "..",
  "..",
  "server",
  "owned",
  "plugins",
  "TheStorm",
  "rwfbots",
);

describe("rwfbots kit-weights.yml", () => {
  test("is what the script generates from the shipped personalities", async () => {
    const shipped = await Bun.file(path.join(BOTS, "kit-weights.yml")).text();

    expect(shipped).toBe(
      await expandedKitWeights(path.join(BOTS, "personalities")),
    );
  });
});
