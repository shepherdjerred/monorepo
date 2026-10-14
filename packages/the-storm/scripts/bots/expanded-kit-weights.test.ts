import { describe, expect, test } from "vitest";
import path from "node:path";
import { expandedKitWeights } from "./expanded-kit-weights.ts";
import { ALL_KITS } from "./schema.ts";
import { z } from "zod";

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
  test("all new kits can be drafted and have personality preferences", async () => {
    const draft = z
      .object({ draft: z.object({ kits: z.array(z.enum(ALL_KITS)) }) })
      .parse(
        Bun.YAML.parse(
          await Bun.file(path.join(BOTS, "..", "rwfbots.yml")).text(),
        ),
      );
    expect(new Set(draft.draft.kits)).toEqual(new Set(ALL_KITS));
    expect(draft.draft.kits).toHaveLength(51);
    const weights = z
      .object({
        personalities: z.record(
          z.string(),
          z.record(z.string(), z.number().positive()),
        ),
      })
      .parse(
        Bun.YAML.parse(
          await Bun.file(path.join(BOTS, "kit-weights.yml")).text(),
        ),
      );
    const selected = new Set(
      Object.values(weights.personalities).flatMap((personality) =>
        Object.keys(personality),
      ),
    );
    for (const kit of [
      "duelist",
      "knight",
      "ravager",
      "acrobat",
      "alchemist",
      "scavenger",
      "arbalist",
      "volley",
      "marksman",
      "windrunner",
      "harpooner",
      "fletcher",
      "lancer",
      "maceguard",
      "quartermaster",
      "warden",
      "smokescreen",
      "tactician",
    ]) {
      expect(selected.has(kit)).toBe(true);
    }
  });

  test("is what the script generates from the shipped personalities", async () => {
    const shipped = await Bun.file(path.join(BOTS, "kit-weights.yml")).text();

    expect(shipped).toBe(
      await expandedKitWeights(path.join(BOTS, "personalities")),
    );
  });
});
