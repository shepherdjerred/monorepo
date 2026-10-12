import path from "node:path";
import { expect, test } from "vitest";

test("toolkit mc bundles only the mc-harness protocol", async () => {
  const result = await Bun.build({
    entrypoints: [
      path.resolve(import.meta.dirname, "../../src/handlers/mc.ts"),
    ],
    target: "bun",
    metafile: true,
  });
  expect(result.success).toBe(true);
  const inputs = Object.keys(result.metafile?.inputs ?? {});
  expect(inputs.length).toBeGreaterThan(0);
  expect(
    inputs.filter((input) => /mineflayer|minecraft-data/u.test(input)),
  ).toEqual([]);
  const harness = inputs.filter((input) => input.includes("mc-harness/"));
  expect(harness.length).toBeGreaterThan(0);
  expect(
    harness.filter((input) => !input.includes("mc-harness/src/protocol/")),
  ).toEqual([]);
});
