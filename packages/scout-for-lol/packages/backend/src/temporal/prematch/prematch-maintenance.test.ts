import { afterEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  expire: vi.fn(),
  refresh: vi.fn(),
  purge: vi.fn(),
}));

vi.mock("#src/dares/settlement/dare-sweep.ts", () => ({
  expireDareAcceptWindows: mocks.expire,
}));
vi.mock("#src/dares/presentation/dare-callout.ts", () => ({
  refreshPendingDareCallouts: mocks.refresh,
}));
vi.mock("#src/live-roster/live-roster-retention.ts", () => ({
  purgeExpiredLiveRosters: mocks.purge,
}));

const { runPrematchMaintenance, prematchMaintenanceSteps } =
  await import("#src/temporal/prematch/prematch-maintenance.ts");

afterEach(() => {
  vi.clearAllMocks();
});

describe("prematch maintenance", () => {
  test("every poll purges the live rosters past their window", async () => {
    mocks.expire.mockResolvedValue(undefined);
    mocks.refresh.mockResolvedValue(undefined);
    mocks.purge.mockResolvedValue({ expired: 0, ended: 0 });

    await runPrematchMaintenance();

    expect(prematchMaintenanceSteps().map((step) => step.name)).toContain(
      "live game roster retention",
    );
    expect(mocks.purge).toHaveBeenCalledOnce();
    expect(mocks.purge.mock.calls[0]?.[0]).toBeInstanceOf(Date);
  });

  test("a failing Dare sweep does not stop the purge, and still fails the pass", async () => {
    mocks.expire.mockRejectedValue(new Error("dare sweep failed"));
    mocks.purge.mockResolvedValue({ expired: 1, ended: 0 });

    await expect(runPrematchMaintenance()).rejects.toThrow("dare sweep failed");
    expect(mocks.purge).toHaveBeenCalledOnce();
  });
});
