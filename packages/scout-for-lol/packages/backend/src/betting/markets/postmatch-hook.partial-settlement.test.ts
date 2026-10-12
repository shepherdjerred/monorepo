import {
  DiscordGuildIdSchema,
  DiscordChannelIdSchema,
} from "@scout-for-lol/domain/identity/discord.ts";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { RawMatchSchema, type RawMatch } from "@scout-for-lol/data";
import type { DareSettlementSummary } from "#src/betting/dares/settlement/dare-settle-types.ts";

/**
 * The post-match Bucks hook on the Dare paths, with every settlement step
 * beneath it stubbed.
 *
 * `settleAndAwardBucks` runs on every match and moves real balances, and the
 * announcement sink decides what it may say about them. Dares are the one
 * family that can throw: a Dare whose capture failed is retried with the
 * whole match, so the hook refreshes callouts for what did commit and then
 * rethrows. The Dare summaries it returns are what the settlement receipt
 * names as resolved Dares.
 */

/** Which sink each settlement family was handed, in call order. */
type HandedSink = { family: string; sink: unknown };
const handed: HandedSink[] = vi.hoisted(() => []);

const stubs = vi.hoisted(() => ({
  closeBettingWindowsForMatch: vi.fn(() => Promise.resolve([])),
  closeAndSettleBettingForMatch: vi.fn(
    (
      _match: unknown,
      _db: unknown,
      sink: unknown,
    ): Promise<{ closures: unknown[]; settlements: unknown[] }> => {
      handed.push({ family: "settlement", sink });
      return Promise.resolve({ closures: [], settlements: [] });
    },
  ),
  settleParlaysForMatch: vi.fn((): Promise<unknown[]> => Promise.resolve([])),
  awardBucksForMatch: vi.fn(() => Promise.resolve([])),
  settleDaresForMatch: vi.fn(
    (
      _match: unknown,
      _db: unknown,
      _options?: { notify?: string },
    ): Promise<DareSettlementSummary[]> => Promise.resolve([]),
  ),
  deliverPendingDareNotifications: vi.fn(() => Promise.resolve(undefined)),
  refreshPendingDareCallouts: vi.fn(
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
vi.mock("#src/betting/dares/settlement/dare-settle.ts", () => ({
  settleDaresForMatch: stubs.settleDaresForMatch,
}));
vi.mock(
  "#src/betting/dares/presentation/notify/dare-notification-delivery.ts",
  () => ({
    deliverPendingDareNotifications: stubs.deliverPendingDareNotifications,
  }),
);
vi.mock("#src/betting/dares/presentation/dare-callout.ts", () => ({
  refreshPendingDareCallouts: stubs.refreshPendingDareCallouts,
  defaultDareCalloutDependencies: {},
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
  await import("#src/betting/dares/settlement/dare-settle-types.ts");
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
    serverId: DiscordGuildIdSchema.parse("813397242200260844"),
    channelId: DiscordChannelIdSchema.parse("825208359990580364"),
    matchId: RiotMatchIdSchema.parse("NA1_7001"),
    resolution: "achieved",
    value: true,
    finality: { value: true, final: true, reason: "monotone_success" },
    proof: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  handed.length = 0;
});

describe("the Dare path", () => {
  test("refreshes callouts for what committed, then rethrows", async () => {
    // A partial failure is retried with the whole match; the Dares that did
    // resolve still get their callouts edited before the throw.
    stubs.settleDaresForMatch.mockRejectedValueOnce(
      new DarePartialSettlementError([summary(1)], new Error("dare 2 failed")),
    );

    await expect(settleAndAwardBucks(MATCH)).rejects.toThrow(
      DarePartialSettlementError,
    );

    expect(stubs.refreshPendingDareCallouts).toHaveBeenCalledTimes(1);
    expect(stubs.deliverPendingDareNotifications).not.toHaveBeenCalled();
  });

  test("returns the Dares this match resolved", async () => {
    // These are what the settlement receipt names as resolved Dares.
    stubs.settleDaresForMatch.mockResolvedValueOnce([summary(1)]);

    const result = await settleAndAwardBucks(MATCH);

    expect(result.dareSettlements).toEqual([summary(1)]);
  });

  test("drains the Dare notification outbox on every settled match", async () => {
    await settleAndAwardBucks(MATCH);

    expect(stubs.deliverPendingDareNotifications).toHaveBeenCalledTimes(1);
  });

  test("refreshes pending Dare callouts on every settled match", async () => {
    // `ensureDareCallout` POSTS when a Dare has no messageRef, so this is
    // not only an edit of something already public.
    await settleAndAwardBucks(MATCH);

    expect(stubs.refreshPendingDareCallouts).toHaveBeenCalled();
  });
});

describe("a sink for a match owed no public delivery", () => {
  test("withholds every announcing path while settlement still runs", async () => {
    // The guarantee, tested as one rule rather than assertions about each
    // path: nothing new is posted and nothing is enqueued. Settlement itself
    // is untouched — the steps below still run and still return.
    await settleAndAwardBucks(MATCH, undefined, {
      announcementSink: silentSettlementSink,
    });

    expect(stubs.settleDaresForMatch.mock.calls[0]?.[2]).toEqual({
      notify: "withhold",
    });
    expect(stubs.deliverPendingDareNotifications).not.toHaveBeenCalled();
    // Settlement ran in full: the money paths were still called.
    expect(stubs.closeAndSettleBettingForMatch).toHaveBeenCalledTimes(1);
    expect(stubs.awardBucksForMatch).toHaveBeenCalledTimes(1);
  });

  test("still refreshes callouts, but forbids posting a new one", async () => {
    // Edits stay allowed: withholding them would leave an already-public
    // callout stale and wrong. Only the post branch is refused, and the
    // refresh is still invoked so existing messages are updated.
    await settleAndAwardBucks(MATCH, undefined, {
      announcementSink: silentSettlementSink,
    });

    expect(stubs.refreshPendingDareCallouts).toHaveBeenCalled();
    const dependencies = stubs.refreshPendingDareCallouts.mock.calls[0]?.[0];
    expect(dependencies?.mayPost?.()).toBe(false);
  });

  test("the announcing sink still posts and enqueues", async () => {
    await settleAndAwardBucks(MATCH, undefined, {
      announcementSink: announcingSettlementSink,
    });

    const dependencies = stubs.refreshPendingDareCallouts.mock.calls[0]?.[0];
    expect(dependencies?.mayPost?.()).toBe(true);
    expect(stubs.settleDaresForMatch.mock.calls[0]?.[2]).toEqual({
      notify: "enqueue",
    });
  });
});

describe("the settlement and parlay paths", () => {
  test("still receive each family's summaries", async () => {
    const settlement = {
      matchId: "NA1_7001",
      serverId: "813397242200260844",
    };
    const parlay = { matchId: "NA1_7001", serverId: "guild-two" };
    stubs.closeAndSettleBettingForMatch.mockResolvedValueOnce({
      closures: [],
      settlements: [settlement],
    });
    stubs.settleParlaysForMatch.mockResolvedValueOnce([parlay]);

    const result = await settleAndAwardBucks(MATCH);

    expect(result.settlements).toEqual([settlement]);
    expect(result.parlaySettlements).toEqual([parlay]);
  });

  test("hands the caller's sink to the settlement family", async () => {
    await settleAndAwardBucks(MATCH, undefined, {
      announcementSink: silentSettlementSink,
    });

    expect(handed).toEqual([
      { family: "settlement", sink: silentSettlementSink },
    ]);
  });
});
