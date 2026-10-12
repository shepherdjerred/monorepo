import { describe, expect, test } from "vitest";
import { resolveTarget } from "#lib/mc/target.ts";

describe("resolveTarget", () => {
  test("passes the explicit live target through", async () => {
    await expect(resolveTarget("live")).resolves.toBe("live");
  });

  test("passes an explicit sandbox id through without asking the daemon", async () => {
    await expect(resolveTarget("sbx-abc123")).resolves.toBe("sbx-abc123");
  });
});
