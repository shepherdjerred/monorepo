import { beforeEach, describe, expect, test, vi } from "vitest";
import { RawMatchSchema, type RawMatch } from "@scout-for-lol/data";
import type { DareSettlementSummary } from "#src/betting/dares/settlement/dare-settle-shared.ts";

/**
 * v1's behaviour on the partial-settlement path, pinned BEFORE the
 * announcement sink is threaded through this module.
 *
 * This file exists to be a genuine before-and-after rather than a description
 * of code already written. `settleAndAwardBucks` runs on every v1 match and
 * moves real balances; the sink adds a parameter to it and to the settlement
 * steps beneath it, and the failure mode of getting that wrong is silent. So
 * what v1 does today is written down first, and the threading must leave every
 * assertion here untouched.
 *
 * The path pinned is the one the sink changes most: `settleDaresForMatch`
 * exhausts its retries on one Dare after others have already committed, throws
 * `DarePartialSettlementError` carrying the summaries that DID settle, and
 * this module delivers those summaries before rethrowing — because they are
 * one-shot and a retry can never reproduce them.
 */

const stubs = vi.hoisted(() => ({
  closeBettingWindowsForMatch: vi.fn(() => Promise.resolve([])),
  closeAndSettleBettingForMatch: vi.fn(() =>
    Promise.resolve({ closures: [], settlements: [] }),
  ),
  settleParlaysForMatch: vi.fn(() => Promise.resolve([])),
  awardBucksForMatch: vi.fn(() => Promise.resolve([])),
  settleDaresV2ForMatch: vi.fn(() => Promise.resolve(undefined)),
  settleDaresForMatch: vi.fn((): Promise<DareSettlementSummary[]> =>
    Promise.resolve([]),
  ),
  deliverDareSummaries: vi.fn(
    (_summaries: readonly DareSettlementSummary[], _db?: unknown) =>
      Promise.resolve(undefined),
  ),
  deliverPendingDareNotifications: vi.fn(() => Promise.resolve(undefined)),
  refreshPendingDareV2Callouts: vi.fn(
    (_dependencies?: { mayPost?: () => boolean }): Promise<number[]> =>
      Promise.resolve([]),
  ),
  refreshClosedBucksMessages: vi.fn(() => Promise.resolve(undefined)),
  refreshClosedParlayMessages: vi.fn(() => Promise.resolve(undefined)),
  isFeatureHardDisabled: vi.fn(() => false),
}));

vi.mock("#src/betting/settlement/sweep.ts", () => ({
  closeBettingWindowsForMatch: stubs.closeBettingWindowsForMatch,
}));
vi.mock("#src/betting/settle.ts", () => ({
  closeAndSettleBettingForMatch: stubs.closeAndSettleBettingForMatch,
}));
vi.mock("#src/betting/parlays/runtime/parlay-settle.ts", () => ({
  settleParlaysForMatch: stubs.settleParlaysForMatch,
}));
vi.mock("#src/betting/accounts/earnings.ts", () => ({
  awardBucksForMatch: stubs.awardBucksForMatch,
}));
vi.mock("#src/betting/dares/settlement/dare-settle-v2.ts", () => ({
  settleDaresV2ForMatch: stubs.settleDaresV2ForMatch,
}));
vi.mock("#src/betting/dares/settlement/dare-settle.ts", () => ({
  settleDaresForMatch: stubs.settleDaresForMatch,
}));
vi.mock("#src/betting/dares/presentation/notify/dare-delivery.ts", () => ({
  deliverDareSummaries: stubs.deliverDareSummaries,
}));
vi.mock(
  "#src/betting/dares/presentation/notify/dare-notification-delivery.ts",
  () => ({
    deliverPendingDareNotifications: stubs.deliverPendingDareNotifications,
  }),
);
vi.mock("#src/betting/dares/presentation/dare-callout-v2.ts", () => ({
  refreshPendingDareV2Callouts: stubs.refreshPendingDareV2Callouts,
  defaultDareV2CalloutDependencies: {},
}));
vi.mock("#src/betting/notify/message-refresh.ts", () => ({
  refreshClosedBucksMessages: stubs.refreshClosedBucksMessages,
}));
vi.mock("#src/betting/parlays/runtime/parlay-refresh.ts", () => ({
  refreshClosedParlayMessages: stubs.refreshClosedParlayMessages,
}));
vi.mock("#src/configuration/flags.ts", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "#src/configuration/flags.ts",
  );
  return { ...actual, isFeatureHardDisabled: stubs.isFeatureHardDisabled };
});
vi.mock("#src/database/index.ts", () => ({ prisma: {} }));

const { settleAndAwardBucks } =
  await import("#src/betting/markets/postmatch-hook.ts");
const { DarePartialSettlementError } =
  await import("#src/betting/dares/settlement/dare-settle-shared.ts");
const { announcingSettlementSink, silentSettlementSink } =
  await import("#src/betting/notify/announcement-sink.ts");

const FIXTURE = RawMatchSchema.parse(
  await Bun.file(
    new URL("../../../../../testdata/rift.json", import.meta.url),
  ).json(),
);

/**
 * A real match payload with this test's id. Every settlement step beneath this
 * module is mocked, so only the id is read — but the fixture is parsed rather
 * than hand-built, so the argument this module is called with is one the
 * production path would accept.
 */
const MATCH: RawMatch = RawMatchSchema.parse({
  ...FIXTURE,
  metadata: { ...FIXTURE.metadata, matchId: "NA1_7001" },
});

function summary(dareId: number): DareSettlementSummary {
  return {
    dareId,
    serverId: "guild-one",
    channelId: "channel-one",
    messageRef: "7",
    matchId: "NA1_7001",
    resolution: "achieved",
    horizonKind: "next_game",
    challengerDiscordId: "1",
    targetAliases: ["a"],
    conditionSummary: "do a thing",
    potTotal: 10,
    payouts: [],
    refunds: [],
    voidReason: undefined,
    leafCounts: undefined,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("v1 on the partial-settlement path", () => {
  test("delivers the summaries that committed, then rethrows", async () => {
    // The whole point of the catch: those summaries are one-shot. Losing them
    // to the throw would leave an already-terminal Dare with nothing to
    // announce, ever.
    const committed = [summary(1), summary(2)];
    const cause = new Error("dare 3 exhausted its retries");
    stubs.settleDaresForMatch.mockRejectedValueOnce(
      new DarePartialSettlementError(committed, cause),
    );

    await expect(settleAndAwardBucks(MATCH)).rejects.toThrow(
      DarePartialSettlementError,
    );

    expect(stubs.deliverDareSummaries).toHaveBeenCalledTimes(1);
    expect(stubs.deliverDareSummaries.mock.calls[0]?.[0]).toEqual(committed);
  });

  test("delivers nothing extra when settlement completes normally", async () => {
    // The ordinary path returns its summaries to the caller, which announces
    // them; this module delivers only on the partial-failure branch.
    stubs.settleDaresForMatch.mockResolvedValueOnce([summary(1)]);

    const result = await settleAndAwardBucks(MATCH);

    expect(result.dareSettlements).toEqual([summary(1)]);
    expect(stubs.deliverDareSummaries).not.toHaveBeenCalled();
  });

  test("drains the Dare notification outbox on every settled match", async () => {
    // The third bypass, pinned as v1 behaviour so the sink can be shown to
    // change it for V2 only: this sends queued Dare DMs, and it runs on the
    // ordinary path with no condition on it.
    stubs.settleDaresForMatch.mockResolvedValueOnce([]);

    await settleAndAwardBucks(MATCH);

    expect(stubs.deliverPendingDareNotifications).toHaveBeenCalledTimes(1);
  });

  test("refreshes pending Dare callouts on every settled match", async () => {
    // The fourth: `ensureDareV2Callout` POSTS when a Dare has no messageRef,
    // so this is not only an edit of something already public.
    stubs.settleDaresForMatch.mockResolvedValueOnce([]);

    await settleAndAwardBucks(MATCH);

    expect(stubs.refreshPendingDareV2Callouts).toHaveBeenCalled();
  });
});

describe("a sink for a match owed no public delivery", () => {
  test("withholds every announcing path while settlement still runs", async () => {
    // The guarantee, tested as one rule rather than four assertions about
    // four paths: nothing new is posted and nothing is enqueued. Settlement
    // itself is untouched — the steps below still run and still return.
    const committed = [summary(1)];
    stubs.settleDaresForMatch.mockRejectedValueOnce(
      new DarePartialSettlementError(committed, new Error("exhausted")),
    );

    await expect(
      settleAndAwardBucks(MATCH, undefined, {
        announcementSink: silentSettlementSink,
      }),
    ).rejects.toThrow(DarePartialSettlementError);

    expect(stubs.deliverDareSummaries).not.toHaveBeenCalled();
    expect(stubs.deliverPendingDareNotifications).not.toHaveBeenCalled();
    // Settlement ran in full: the money paths were still called.
    expect(stubs.closeAndSettleBettingForMatch).toHaveBeenCalledTimes(1);
    expect(stubs.awardBucksForMatch).toHaveBeenCalledTimes(1);
  });

  test("still refreshes callouts, but forbids posting a new one", async () => {
    // Edits stay allowed: withholding them would leave an already-public
    // callout stale and wrong. Only the post branch is refused, and the
    // refresh is still invoked so existing messages are updated.
    stubs.settleDaresForMatch.mockResolvedValueOnce([]);

    await settleAndAwardBucks(MATCH, undefined, {
      announcementSink: silentSettlementSink,
    });

    expect(stubs.refreshPendingDareV2Callouts).toHaveBeenCalled();
    const dependencies = stubs.refreshPendingDareV2Callouts.mock.calls[0]?.[0];
    expect(dependencies?.mayPost?.()).toBe(false);
  });

  test("v1's own sink still posts", async () => {
    stubs.settleDaresForMatch.mockResolvedValueOnce([]);

    await settleAndAwardBucks(MATCH, undefined, {
      announcementSink: announcingSettlementSink,
    });

    const dependencies = stubs.refreshPendingDareV2Callouts.mock.calls[0]?.[0];
    expect(dependencies?.mayPost?.()).toBe(true);
  });
});
