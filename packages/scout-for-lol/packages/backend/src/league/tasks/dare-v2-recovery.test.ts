import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  abandonExpiredDareProposals: vi.fn(async () => []),
  activatePendingDaresV3: vi.fn(() => Promise.resolve()),
  activatePendingParlayMarkets: vi.fn(() => Promise.resolve()),
  announceSettlements: vi.fn(() => Promise.resolve()),
  checkActiveGames: vi.fn(() => Promise.resolve()),
  checkMatchHistory: vi.fn(() =>
    Promise.resolve({ evidenceComplete: true, evidenceWatermark: undefined }),
  ),
  closeExpiredBettingWindows: vi.fn(async () => []),
  closeExpiredParlayWindows: vi.fn(async () => []),
  deliverDareSummaries: vi.fn(() => Promise.resolve()),
  deliverPendingDareNotifications: vi.fn(() => Promise.resolve()),
  expireDareAcceptWindows: vi.fn(async () => []),
  expireDareV2AcceptWindows: vi.fn(async () => [17]),
  getPostmatchMessageIds: vi.fn(async () => new Map<string, string>()),
  markPostMatchPollCompleted: vi.fn(() => Promise.resolve()),
  markPostMatchPollFailed: vi.fn(() => Promise.resolve()),
  refreshClosedBucksMessages: vi.fn(() => Promise.resolve()),
  refreshClosedParlayMessages: vi.fn(() => Promise.resolve()),
  refreshPendingDareV2Callouts: vi.fn(() => Promise.resolve([])),
  retryPendingBucksEarnings: vi.fn(() => Promise.resolve()),
  settleEndedDareV2Windows: vi.fn(async () => []),
  settleEndedDareWindows: vi.fn(async () => []),
  settleMatureDareSqlV3Races: vi.fn(() => Promise.resolve()),
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
vi.mock("#src/betting/dares/settlement/dare-sweep.ts", () => ({
  abandonExpiredDareProposals: mocks.abandonExpiredDareProposals,
  expireDareAcceptWindows: mocks.expireDareAcceptWindows,
  settleEndedDareWindows: mocks.settleEndedDareWindows,
}));
vi.mock("#src/betting/dares/presentation/dare-delivery.ts", () => ({
  deliverDareSummaries: mocks.deliverDareSummaries,
}));
vi.mock("#src/betting/dares/lifecycle/dare-activation-v3.ts", () => ({
  activatePendingDaresV3: mocks.activatePendingDaresV3,
}));
vi.mock("#src/betting/dares/settlement/dare-settle-v3.ts", () => ({
  settleMatureDareSqlV3Races: mocks.settleMatureDareSqlV3Races,
}));
vi.mock(
  "#src/betting/dares/presentation/dare-notification-delivery.ts",
  () => ({
    deliverPendingDareNotifications: mocks.deliverPendingDareNotifications,
  }),
);
vi.mock("#src/betting/dares/settlement/dare-sweep-v2.ts", () => ({
  expireDareV2AcceptWindows: mocks.expireDareV2AcceptWindows,
  settleEndedDareV2Windows: mocks.settleEndedDareV2Windows,
}));
vi.mock("#src/betting/dares/presentation/dare-callout-v2.ts", () => ({
  refreshPendingDareV2Callouts: mocks.refreshPendingDareV2Callouts,
}));
vi.mock("#src/betting/settlement/sweep.ts", () => ({
  closeExpiredBettingWindows: mocks.closeExpiredBettingWindows,
}));
vi.mock("#src/betting/parlays/parlay-sweep.ts", () => ({
  closeExpiredParlayWindows: mocks.closeExpiredParlayWindows,
  voidStaleParlayMarkets: mocks.voidStaleParlayMarkets,
}));
vi.mock("#src/betting/parlays/parlay-publish.ts", () => ({
  activatePendingParlayMarkets: mocks.activatePendingParlayMarkets,
}));
vi.mock("#src/betting/parlays/parlay-refresh.ts", () => ({
  refreshClosedParlayMessages: mocks.refreshClosedParlayMessages,
}));
vi.mock("#src/betting/message-refresh.ts", () => ({
  refreshClosedBucksMessages: mocks.refreshClosedBucksMessages,
}));
vi.mock("#src/betting/accounts/earnings-retry.ts", () => ({
  retryPendingBucksEarnings: mocks.retryPendingBucksEarnings,
}));
vi.mock("#src/betting/announce.ts", () => ({
  announceSettlements: mocks.announceSettlements,
}));
vi.mock("#src/betting/settlement/void-stale.ts", () => ({
  voidStaleBettingPools: mocks.voidStaleBettingPools,
}));
vi.mock("#src/league/tasks/prematch/active-game-queries.ts", () => ({
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

describe("Dare v2 recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("expires funded acceptance windows while betting is hard-disabled", async () => {
    await expect(checkPreMatch()).resolves.toEqual({ dareSummaries: [] });

    expect(mocks.checkActiveGames).toHaveBeenCalledOnce();
    expect(mocks.expireDareV2AcceptWindows).toHaveBeenCalledOnce();
    expect(mocks.refreshPendingDareV2Callouts).toHaveBeenCalledOnce();
    expect(mocks.abandonExpiredDareProposals).not.toHaveBeenCalled();
    expect(mocks.closeExpiredBettingWindows).not.toHaveBeenCalled();
  });

  test("settles funded contracts while betting is hard-disabled", async () => {
    await expect(checkPostMatch()).resolves.toEqual({ dareSummaries: [] });

    expect(mocks.checkMatchHistory).toHaveBeenCalledOnce();
    expect(mocks.settleEndedDareV2Windows).toHaveBeenCalledOnce();
    expect(mocks.refreshPendingDareV2Callouts).toHaveBeenCalledOnce();
    expect(mocks.deliverPendingDareNotifications).toHaveBeenCalledOnce();
    expect(mocks.markPostMatchPollCompleted).toHaveBeenCalledOnce();
    expect(mocks.markPostMatchPollFailed).not.toHaveBeenCalled();
    expect(mocks.retryPendingBucksEarnings).not.toHaveBeenCalled();
    expect(mocks.settleEndedDareWindows).not.toHaveBeenCalled();
    expect(mocks.voidStaleBettingPools).not.toHaveBeenCalled();
  });
});
