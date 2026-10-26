import { describe, expect, it, vi } from "vitest";
import { cleanupPromotionResources, runPromotionAgent } from "./agent.ts";
import { promotionMaintenanceContext, promotionTarget } from "./manifest.ts";
import { initialPromotionState } from "#shared/promotion.ts";
import { memoryPromotionStore } from "./test-support.ts";

describe("promotion cleanup", () => {
  it("includes recorded manual receipts while excluding account locators", async () => {
    const context = await promotionMaintenanceContext();
    expect(context).toContain("2026-10-25 22:15:21 UTC");
    expect(context).not.toContain("## Accounts");
    expect(context).not.toContain("cajum4hu3zrd3hxzuyp5qgwhw4");
  });
  it.each(["run", "reconcile"] as const)(
    "rejects a profile override in %s before opening a browser",
    async (mode) => {
      await expect(
        runPromotionAgent({
          target: promotionTarget("pmc"),
          state: initialPromotionState("pmc", 900),
          occurrenceId: "fixture",
          mode,
          store: memoryPromotionStore(),
          browserProfile: "existing-session",
        }),
      ).rejects.toThrow("only in preview");
    },
  );
  it("attempts all resources without replacing a completed publication outcome", async () => {
    const closed = vi
      .fn<() => Promise<void>>()
      .mockRejectedValue(new Error("Tab already gone"));
    const removed = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const report = vi.fn();
    const finish = async () => {
      try {
        return "verified";
      } finally {
        await cleanupPromotionResources(
          [
            ["tab", closed],
            ["workspace", removed],
          ],
          report,
        );
      }
    };
    expect(await finish()).toBe("verified");
    expect(removed).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledWith("tab", expect.any(Error));
  });
});
