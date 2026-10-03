import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  activatePendingDares: vi.fn(() => Promise.resolve()),
  activatePendingParlayMarkets: vi.fn(() => Promise.resolve()),
  announceSettlements: vi.fn(() => Promise.resolve()),
  checkActiveGames: vi.fn(() => Promise.resolve()),
  checkMatchHistory: vi.fn(() =>
    Promise.resolve({ evidenceComplete: true, evidenceWatermark: undefined }),
  ),
  closeExpiredBettingWindows: vi.fn(async () => []),
  closeExpiredParlayWindows: vi.fn(async () => []),
  deleteExpiredActiveGames: vi.fn(async () => 0),
  deliverPendingDareNotifications: vi.fn(() => Promise.resolve()),
  expireDareAcceptWindows: vi.fn(async () => [17]),
  getPostmatchMessageIds: vi.fn(async () => new Map<string, string>()),
  markPostMatchPollCompleted: vi.fn(() => Promise.resolve()),
  markPostMatchPollFailed: vi.fn(() => Promise.resolve()),
  refreshClosedBucksMessages: vi.fn(() => Promise.resolve()),
  refreshClosedParlayMessages: vi.fn(() => Promise.resolve()),
  refreshPendingDareCallouts: vi.fn(() => Promise.resolve([])),
  retryPendingBucksEarnings: vi.fn(() => Promise.resolve()),
  settleEndedDareWindows: vi.fn(async () => []),
  settleMatureDareSqlRaces: vi.fn(() => Promise.resolve()),
  voidStaleBettingPools: vi.fn(async () => ({
    closures: [],
    settlements: [],
  })),
  voidStaleParlayMarkets: vi.fn(() => Promise.resolve()),
}));

vi.mock("#src/league/tasks/prematch/active-game-detection.ts", () => ({
  checkActiveGames: mocks.checkActiveGames,
}));
vi.mock("#src/league/tasks/postmatch/match-history-polling.ts", () => ({
  checkMatchHistory: mocks.checkMatchHistory,
}));
vi.mock("#src/betting/dares/lifecycle/dare-activation.ts", () => ({
  activatePendingDares: mocks.activatePendingDares,
}));
vi.mock("#src/betting/dares/settlement/dare-settle-contract.ts", () => ({
  settleMatureDareSqlRaces: mocks.settleMatureDareSqlRaces,
}));
vi.mock(
  "#src/betting/dares/presentation/notify/dare-notification-delivery.ts",
  () => ({
    deliverPendingDareNotifications: mocks.deliverPendingDareNotifications,
  }),
);
vi.mock("#src/betting/dares/settlement/dare-sweep.ts", () => ({
  expireDareAcceptWindows: mocks.expireDareAcceptWindows,
  settleEndedDareWindows: mocks.settleEndedDareWindows,
}));
vi.mock("#src/betting/dares/presentation/dare-callout.ts", () => ({
  refreshPendingDareCallouts: mocks.refreshPendingDareCallouts,
}));
vi.mock("#src/betting/settlement/sweep.ts", () => ({
  closeExpiredBettingWindows: mocks.closeExpiredBettingWindows,
}));
vi.mock("#src/betting/parlays/runtime/parlay-sweep.ts", () => ({
  closeExpiredParlayWindows: mocks.closeExpiredParlayWindows,
  voidStaleParlayMarkets: mocks.voidStaleParlayMarkets,
}));
vi.mock("#src/betting/parlays/runtime/parlay-publish.ts", () => ({
  activatePendingParlayMarkets: mocks.activatePendingParlayMarkets,
}));
vi.mock("#src/betting/parlays/runtime/parlay-refresh.ts", () => ({
  refreshClosedParlayMessages: mocks.refreshClosedParlayMessages,
}));
vi.mock("#src/betting/notify/message-refresh.ts", () => ({
  refreshClosedBucksMessages: mocks.refreshClosedBucksMessages,
}));
vi.mock("#src/betting/accounts/earnings-retry.ts", () => ({
  retryPendingBucksEarnings: mocks.retryPendingBucksEarnings,
}));
vi.mock("#src/betting/notify/announce.ts", () => ({
  announceSettlements: mocks.announceSettlements,
}));
vi.mock("#src/betting/settlement/void-stale.ts", () => ({
  voidStaleBettingPools: mocks.voidStaleBettingPools,
}));
vi.mock("#src/league/tasks/prematch/active-game-queries.ts", () => ({
  deleteExpiredActiveGames: mocks.deleteExpiredActiveGames,
  getPostmatchMessageIdsForMatchIdOrEmpty: mocks.getPostmatchMessageIds,
}));
vi.mock("#src/league/tasks/recovery/app-state.ts", () => ({
  markPostMatchPollCompleted: mocks.markPostMatchPollCompleted,
  markPostMatchPollFailed: mocks.markPostMatchPollFailed,
}));
vi.mock("#src/configuration/flags.ts", () => ({
  isFeatureHardDisabled: () => true,
  isPolicyEnabled: () => Promise.resolve(false),
}));
vi.mock("#src/logger.ts", () => ({
  createLogger: () => ({ info: vi.fn(), error: vi.fn() }),
}));

import { checkPostMatch } from "#src/league/tasks/postmatch/index.ts";
import { checkPreMatch } from "#src/league/tasks/prematch/index.ts";
import { runPrematchMaintenance } from "#src/temporal/v2/prematch/prematch-maintenance.ts";

describe("Dare recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("expires funded acceptance windows while betting is hard-disabled", async () => {
    await expect(
      checkPreMatch({
        activeGameDetection: "v1",
        capturedByV2: () => Promise.resolve(false),
      }),
    ).resolves.toBeUndefined();

    expect(mocks.checkActiveGames).toHaveBeenCalledOnce();
    expect(mocks.deleteExpiredActiveGames).not.toHaveBeenCalled();
    expect(mocks.expireDareAcceptWindows).toHaveBeenCalledOnce();
    expect(mocks.refreshPendingDareCallouts).toHaveBeenCalledOnce();
    expect(mocks.closeExpiredBettingWindows).not.toHaveBeenCalled();
  });

  test("keeps prematch maintenance, and skips v1 detection, when V2 detected the pass", async () => {
    // The prematch ownership router hands v1 only its maintenance once V2
    // discovery has detected the pass's games. Dare recovery must still run.
    await expect(
      checkPreMatch({ activeGameDetection: "v2" }),
    ).resolves.toBeUndefined();

    expect(mocks.checkActiveGames).not.toHaveBeenCalled();
    expect(mocks.deleteExpiredActiveGames).toHaveBeenCalledOnce();
    expect(mocks.expireDareAcceptWindows).toHaveBeenCalledOnce();
    expect(mocks.refreshPendingDareCallouts).toHaveBeenCalledOnce();
  });

  test("runs the V2 poll's prematch maintenance with no active-game step", async () => {
    // The sweeps v1's poll carried, now run by the V2 discovery poll. V2
    // detects games itself and never writes ActiveGame, so neither v1
    // detection nor its row expiry belongs here.
    await runPrematchMaintenance();

    expect(mocks.checkActiveGames).not.toHaveBeenCalled();
    expect(mocks.deleteExpiredActiveGames).not.toHaveBeenCalled();
    expect(mocks.expireDareAcceptWindows).toHaveBeenCalledOnce();
    expect(mocks.refreshPendingDareCallouts).toHaveBeenCalledOnce();
    expect(mocks.closeExpiredBettingWindows).not.toHaveBeenCalled();
  });

  test("settles funded contracts while betting is hard-disabled", async () => {
    await expect(checkPostMatch()).resolves.toBeUndefined();

    expect(mocks.checkMatchHistory).toHaveBeenCalledOnce();
    expect(mocks.settleEndedDareWindows).toHaveBeenCalledOnce();
    expect(mocks.refreshPendingDareCallouts).toHaveBeenCalledOnce();
    expect(mocks.deliverPendingDareNotifications).toHaveBeenCalledOnce();
    expect(mocks.markPostMatchPollCompleted).toHaveBeenCalledOnce();
    expect(mocks.markPostMatchPollFailed).not.toHaveBeenCalled();
    expect(mocks.retryPendingBucksEarnings).not.toHaveBeenCalled();
    expect(mocks.voidStaleBettingPools).not.toHaveBeenCalled();
  });
});
