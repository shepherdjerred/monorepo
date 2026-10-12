import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  begin: vi.fn(),
  snapshot: vi.fn(),
  end: vi.fn(),
  maintain: vi.fn(),
  sleep: vi.fn(),
}));
vi.mock("@temporalio/workflow", () => ({
  ActivityCancellationType: {
    WAIT_CANCELLATION_COMPLETED: "WAIT_CANCELLATION_COMPLETED",
  },
  proxyActivities: () => ({
    beginStormForumBackup: mocks.begin,
    snapshotStormForum: mocks.snapshot,
    endStormForumBackup: mocks.end,
    maintainStormForum: mocks.maintain,
  }),
  workflowInfo: () => ({ runId: "f8d36d3a-e74e-4b28-a661-b03ed85c7e55" }),
  sleep: mocks.sleep,
  CancellationScope: {
    nonCancellable: async (operation: () => Promise<void>) => {
      await operation();
    },
  },
}));
import { backupStormForumWorkflow } from "./storm-forum.ts";
describe("forum backup compensation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });
  it("waits for active requests to drain before committing a snapshot", async () => {
    mocks.snapshot.mockResolvedValue({
      manifestKey: "snapshots/test/manifest.json",
    });
    expect(await backupStormForumWorkflow("beta")).toEqual({
      manifestKey: "snapshots/test/manifest.json",
    });
    expect(mocks.sleep).toHaveBeenCalledWith("65 seconds");
    expect(mocks.begin.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.sleep.mock.invocationCallOrder[0] ?? 0,
    );
    expect(mocks.sleep.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.snapshot.mock.invocationCallOrder[0] ?? 0,
    );
    expect(mocks.end).toHaveBeenCalledOnce();
  });
  it("releases maintenance after an export fails", async () => {
    mocks.snapshot.mockRejectedValue(new Error("S3 unavailable"));
    await expect(backupStormForumWorkflow("prod")).rejects.toThrow(
      "S3 unavailable",
    );
    expect(mocks.end).toHaveBeenCalledWith(
      "f8d36d3a-e74e-4b28-a661-b03ed85c7e55",
    );
  });
});
