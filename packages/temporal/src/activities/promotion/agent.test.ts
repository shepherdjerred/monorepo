import { describe, expect, it, vi } from "vitest";
import { cleanupPromotionResources } from "./agent.ts";

describe("promotion cleanup", () => {
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
