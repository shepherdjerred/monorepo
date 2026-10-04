import { describe, expect, test } from "vitest";
import { resolveTarget } from "#lib/mc/target.ts";

describe("resolveTarget", () => {
  test("refuses the live target until it exists", async () => {
    await expect(resolveTarget("live")).rejects.toThrow(/not available yet/u);
  });

  test("passes an explicit sandbox id through without asking the daemon", async () => {
    await expect(resolveTarget("sbx-abc123")).resolves.toBe("sbx-abc123");
  });
});
