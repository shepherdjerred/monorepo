import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  status: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  php: vi.fn(async () => ""),
}));
vi.mock("#src/minecraft.ts", () => ({ updateMinecraftStatus: mocks.status }));
vi.mock("#src/process.ts", () => ({ runPhp: mocks.php }));
vi.mock("@temporalio/activity", () => ({ heartbeat: vi.fn() }));
vi.mock("#src/config.ts", () => ({
  createForumConfig: () => ({
    value: async (key: string) => (key === "season" ? "auto" : true),
  }),
  forumFlagOptions: () => ({}),
}));
vi.mock("@shepherdjerred/feature-flags/config-source.ts", () => ({
  createFlagConfigSource: () => ({}),
}));
import { createMaintainStormForum } from "#src/activities.ts";

describe("independent housekeeping outcomes", () => {
  it("refreshes status even when forum policy fails, while retaining the failure", async () => {
    mocks.status.mockClear();
    mocks.php.mockRejectedValueOnce(new Error("policy failure"));
    await expect(createMaintainStormForum("prod")()).rejects.toThrow(
      "Forum housekeeping failed",
    );
    expect(mocks.status).toHaveBeenCalledOnce();
  });
  it("still runs forum maintenance if writing the status cache fails", async () => {
    mocks.php.mockClear();
    mocks.status.mockRejectedValueOnce(new Error("cache write failure"));
    await expect(createMaintainStormForum("prod")()).rejects.toThrow(
      "Forum housekeeping failed",
    );
    expect(mocks.php).toHaveBeenCalledTimes(2);
  });
});
