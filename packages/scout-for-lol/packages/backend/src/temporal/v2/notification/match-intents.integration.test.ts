import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import {
  NotificationIntentKeySchema,
  RiotMatchIdSchema,
} from "@scout-for-lol/domain/identity/brands.ts";
import { PlatformRouteSchema } from "@scout-for-lol/domain/identity/routes.ts";
import { IsoInstantSchema } from "@scout-for-lol/domain/identity/brands.ts";
import type * as DatabaseModule from "#src/database/index.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { testGuildId } from "#src/testing/test-ids.ts";
import { DiscordChannelIdSchema } from "@scout-for-lol/domain/identity/discord.ts";
import {
  deliveryIntentKey,
  prematchDeliveryKeyPrefix,
} from "#src/durable/match/delivery-intents.ts";
import type { DareSettlementSummary } from "#src/betting/dares/settlement/dare-settle-shared.ts";
import type { SettlementSummary } from "#src/betting/settle.ts";
import { BucksPoolTotalSchema } from "@scout-for-lol/data";

/**
 * What a post-match match mints, against real rows.
 *
 * The question these cover is not "does an intent get written" — the prematch
 * lane already proves the write discipline — but WHICH matches may write one
 * at all. A `silent-backfill` match must leave no evidence that a delivery was
 * intended: no intent row, in any state, for any kind.
 */

const { prisma } = createTestDatabase("scout-v2-match-intents");

const MATCH = RiotMatchIdSchema.parse("NA1_8300");
const SILENT_MATCH = RiotMatchIdSchema.parse("NA1_8301");
const CHANNEL = "100000000000000021";
const GUILD = testGuildId("4200");

vi.mock("#src/database/index.ts", async () => {
  const actual = await vi.importActual<typeof DatabaseModule>(
    "#src/database/index.ts",
  );
  return { ...actual, prisma };
});

type PreparedStub = {
  refs: { channelId: string; messageId: string }[];
  kind: "message" | "pool-missing" | "nothing-to-report";
};
const prepared: PreparedStub = vi.hoisted(() => ({
  refs: [{ channelId: "100000000000000031", messageId: "9001" }],
  kind: "message",
}));

// v1's own announcement decision, replaced so these tests are about the
// MINTING rules rather than about pool rows: what v1 refuses to announce must
// mint nothing, and what it announces must mint one row per watching channel.
vi.mock("#src/betting/notify/announce-prepare.ts", () => ({
  prepareSettlementAnnouncement: () =>
    Promise.resolve(
      prepared.kind === "message"
        ? {
            kind: "message",
            message: {},
            refs: prepared.refs,
            showOutcome: true,
            unmatchedPositions: [],
            roster: [],
            queueType: null,
          }
        : { kind: prepared.kind },
    ),
  outcomeIsVisible: () => true,
}));

// The audience is v1's own resolver; the channels it returns are not what
// these tests are about, so it answers one subscribed channel for every match.
vi.mock("#src/league/tasks/notification-filters.ts", () => ({
  resolvePostmatchDeliveryChannels: () =>
    Promise.resolve({
      subscribed: [],
      deliverable: [{ channel: CHANNEL, serverId: GUILD, subscriptions: [] }],
      guildIds: [GUILD],
    }),
}));

const {
  mintDareSummaryIntentsV2,
  mintPostmatchIntentsV2,
  mintSettlementIntentsV2,
} = await import("#src/temporal/v2/notification/match-intents.ts");
const { observeMatch, getObservation } =
  await import("#src/database/durable/observation-repository.ts");
const { listIntentsForMatch, upsertIntent } =
  await import("#src/database/durable/intent-repository.ts");
const { planMatchFanOutV2 } = await import("#src/temporal/v2/match-reads.ts");
const {
  dareSummariesOf,
  settlementAnnouncementInputsOf,
  settlementCheckpointPayload,
} = await import("#src/temporal/v2/notification/match-intents.ts");
const {
  getSettlementAnnouncementCheckpoint,
  recordSettlementAnnouncementCheckpoint,
} = await import("#src/database/durable/settlement-announcement-repository.ts");

const GAME_CREATED_AT = Date.parse("2026-09-19T09:00:00.000Z");

async function observe(
  matchId: string,
  deliveryMode: "live" | "silent-backfill",
): Promise<void> {
  await observeMatch(prisma, {
    matchId: RiotMatchIdSchema.parse(matchId),
    platformRoute: PlatformRouteSchema.parse("NA1"),
    policy: "FULL",
    deliveryMode,
    owner: { kind: "temporal-v2" },
    promotion: null,
    gameCreatedAt: IsoInstantSchema.parse("2026-09-19T09:00:00.000Z"),
    observedAt: IsoInstantSchema.parse("2026-09-19T09:30:00.000Z"),
    artifacts: { match: null, timeline: null },
  });
}

function mint(matchId: string) {
  return mintPostmatchIntentsV2(prisma, {
    matchId: RiotMatchIdSchema.parse(matchId),
    puuids: [],
    queue: { queueId: 420, gameMode: "CLASSIC", gameType: "MATCHED_GAME" },
    gameCreation: GAME_CREATED_AT,
    createdAt: new Date("2026-09-19T09:35:00.000Z"),
  });
}

beforeEach(async () => {
  await prisma.matchNotificationIntent.deleteMany();
  await prisma.matchSettlementAnnouncement.deleteMany();
  await prisma.matchObservation.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("what a post-match match mints", () => {
  test("mints the report for a live match", async () => {
    await observe(MATCH, "live");

    expect(await mint(MATCH)).toEqual({
      minted: 1,
      existing: 0,
      conflicts: 0,
      silent: 0,
      undeliverable: 0,
    });
    const intents = await listIntentsForMatch(prisma, { matchId: MATCH });
    expect(intents).toHaveLength(1);
    expect(intents[0]?.intent.kind).toBe("postmatch");
    expect(intents[0]?.intent.origin).toEqual({ kind: "live" });
    expect(intents[0]?.intent.state).toEqual({ kind: "pending" });
  });

  test("mints NOTHING for a silent-backfill match", async () => {
    // The whole point of the mode. Not a suppressed row, not a row nobody
    // drives — no row at all, because the row is the evidence that a delivery
    // was intended and the backlog gauge and the sweep both read it.
    await observe(SILENT_MATCH, "silent-backfill");

    expect(await mint(SILENT_MATCH)).toEqual({
      minted: 0,
      existing: 0,
      conflicts: 0,
      silent: 1,
      undeliverable: 0,
    });
    expect(
      await listIntentsForMatch(prisma, { matchId: SILENT_MATCH }),
    ).toEqual([]);
  });

  test("is read-gated, so a retry mints nothing new", async () => {
    await observe(MATCH, "live");
    await mint(MATCH);

    expect(await mint(MATCH)).toMatchObject({ minted: 0, existing: 1 });
    expect(await listIntentsForMatch(prisma, { matchId: MATCH })).toHaveLength(
      1,
    );
  });

  test("refuses to mint for a match nothing has observed", async () => {
    // Every minting site runs after the observation commit, so no observation
    // is a broken caller contract. Defaulting either way is unrecoverable:
    // one announces a backfill, the other silences a live match.
    await expect(mint(MATCH)).rejects.toThrow(
      /owed a public delivery is unknown/,
    );
    expect(await listIntentsForMatch(prisma, { matchId: MATCH })).toEqual([]);
  });

  test("reads the mode from the row, not from the caller", async () => {
    // A caller cannot talk this into minting: there is no parameter to pass.
    // Flipping the committed row is the only thing that changes the answer,
    // and the observation claim is what defends that row against drift.
    await observe(SILENT_MATCH, "silent-backfill");
    expect(await mint(SILENT_MATCH)).toMatchObject({ silent: 1, minted: 0 });

    const stored = await getObservation(prisma, { matchId: SILENT_MATCH });
    expect(stored?.deliveryMode).toBe("silent-backfill");
  });
});

function dareSummary(
  overrides: Partial<DareSettlementSummary>,
): DareSettlementSummary {
  return {
    dareId: 77,
    serverId: GUILD,
    channelId: "100000000000000041",
    messageRef: "7",
    matchId: MATCH,
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
    ...overrides,
  };
}

describe("what the settlement effect mints", () => {
  const settlement: SettlementSummary = {
    matchId: MATCH,
    serverId: GUILD,
    winningTeamId: undefined,
    voidReason: undefined,
    winnersPool: BucksPoolTotalSchema.parse(0),
    losersPool: BucksPoolTotalSchema.parse(0),
    houseCut: BucksPoolTotalSchema.parse(0),
    bets: [],
  };

  test("mints one recap per channel the pool's bettors are watching", async () => {
    await observe(MATCH, "live");
    prepared.kind = "message";

    const summary = await mintSettlementIntentsV2(prisma, {
      matchId: MATCH,
      closures: [],
      settlements: [settlement],
      parlaySettlements: [],
      earnings: [],
      gameCreation: GAME_CREATED_AT,
      createdAt: new Date("2026-09-19T09:35:00.000Z"),
    });

    expect(summary).toMatchObject({ minted: 1, undeliverable: 0 });
    const intents = await listIntentsForMatch(prisma, { matchId: MATCH });
    expect(intents[0]?.intent.kind).toBe("settlement");
    expect(intents[0]?.intent.announcement).toBeDefined();
  });

  test("mints nothing when v1 has nothing to announce", async () => {
    // `pool-missing` and `nothing-to-report` are v1's own refusals. A row for
    // either would be an intent the delivery arm then declines to render.
    await observe(MATCH, "live");
    for (const kind of ["pool-missing", "nothing-to-report"] as const) {
      prepared.kind = kind;
      expect(
        await mintSettlementIntentsV2(prisma, {
          matchId: MATCH,
          closures: [],
          settlements: [settlement],
          parlaySettlements: [],
          earnings: [],
          gameCreation: GAME_CREATED_AT,
          createdAt: new Date("2026-09-19T09:35:00.000Z"),
        }),
      ).toMatchObject({ minted: 0 });
    }
    expect(await listIntentsForMatch(prisma, { matchId: MATCH })).toEqual([]);
  });

  test("mints nothing, and says so, when there is nowhere to announce", async () => {
    // v1 refuses to substitute a channel nobody opted into; so does this.
    await observe(MATCH, "live");
    prepared.kind = "message";
    prepared.refs = [];

    expect(
      await mintSettlementIntentsV2(prisma, {
        matchId: MATCH,
        closures: [],
        settlements: [settlement],
        parlaySettlements: [],
        earnings: [],
        gameCreation: GAME_CREATED_AT,
        createdAt: new Date("2026-09-19T09:35:00.000Z"),
      }),
    ).toMatchObject({ minted: 0, undeliverable: 1 });
    expect(await listIntentsForMatch(prisma, { matchId: MATCH })).toEqual([]);
    prepared.refs = [{ channelId: "100000000000000031", messageId: "9001" }];
  });

  test("withholds the recap entirely for a silent-backfill match", async () => {
    await observe(SILENT_MATCH, "silent-backfill");
    prepared.kind = "message";

    expect(
      await mintSettlementIntentsV2(prisma, {
        matchId: SILENT_MATCH,
        closures: [],
        settlements: [{ ...settlement, matchId: SILENT_MATCH }],
        parlaySettlements: [],
        earnings: [],
        gameCreation: GAME_CREATED_AT,
        createdAt: new Date("2026-09-19T09:35:00.000Z"),
      }),
    ).toMatchObject({ minted: 0, silent: 1 });
    expect(
      await listIntentsForMatch(prisma, { matchId: SILENT_MATCH }),
    ).toEqual([]);
  });

  test("mints one Dare summary, and none for a resolution that announces nothing", async () => {
    await observe(MATCH, "live");

    const summary = await mintDareSummaryIntentsV2(prisma, {
      matchId: MATCH,
      dareSettlements: [
        dareSummary({}),
        dareSummary({ dareId: 78, resolution: "captured" }),
        dareSummary({ dareId: 79, resolution: "abandoned" }),
        // Not this match's: a deadline resolution belongs to maintenance.
        dareSummary({ dareId: 80, matchId: undefined }),
      ],
      gameCreation: GAME_CREATED_AT,
      createdAt: new Date("2026-09-19T09:35:00.000Z"),
    });

    expect(summary).toMatchObject({ minted: 1 });
    const intents = await listIntentsForMatch(prisma, { matchId: MATCH });
    expect(intents).toHaveLength(1);
    expect(intents[0]?.intent.kind).toBe("dare-summary");
  });
});

describe("what the post-match fan-out drives", () => {
  test("never drives a prematch intent, however fresh it still is", async () => {
    // The hazard is this Activity's TIMING, not its routing. A prematch intent
    // announces a game STARTING and this runs when the game is known to have
    // ended — but the freshness deadline is the game's own three-hour TTL, so
    // a match discovered minutes after it finished is still well inside it.
    // A prematch row an outage left `pending` would therefore pass `beginSend`
    // and post "game starting" after the result was already known.
    await observe(MATCH, "live");
    const prematchKey = NotificationIntentKeySchema.parse(
      deliveryIntentKey(prematchDeliveryKeyPrefix(MATCH), CHANNEL),
    );
    await upsertIntent(prisma, {
      matchId: MATCH,
      intent: {
        key: prematchKey,
        kind: "prematch",
        origin: { kind: "live" },
        target: {
          kind: "channel",
          channelId: DiscordChannelIdSchema.parse(CHANNEL),
        },
        // Deliberately far in the future: the deadline is not what saves us.
        freshnessDeadline: IsoInstantSchema.parse("2099-01-01T00:00:00.000Z"),
        createdAt: IsoInstantSchema.parse("2026-09-19T09:05:00.000Z"),
        attemptCount: 0,
        state: { kind: "pending" },
      },
    });
    await mint(MATCH);

    const plan = await planMatchFanOutV2({ riotMatchId: MATCH });

    expect(plan.notificationIntentKeys).not.toContain(prematchKey);
    // The report for the same match and channel is still driven, so this is
    // an exclusion of the KIND and not of the match or the channel.
    expect(plan.notificationIntentKeys).toHaveLength(1);
  });
});

describe("recovering a settlement whose run died before its receipt", () => {
  const settlement: SettlementSummary = {
    matchId: MATCH,
    serverId: GUILD,
    winningTeamId: undefined,
    voidReason: undefined,
    winnersPool: BucksPoolTotalSchema.parse(0),
    losersPool: BucksPoolTotalSchema.parse(0),
    houseCut: BucksPoolTotalSchema.parse(0),
    bets: [],
  };

  function instructions() {
    return settlementCheckpointPayload({
      closures: [],
      settlements: [settlement],
      parlaySettlements: [],
      earnings: [],
      dareSettlements: [dareSummary({})],
    });
  }

  test("a takeover mints the same intents from the checkpoint", async () => {
    // The kill: settlement committed and its checkpoint landed, then the
    // worker died before anything was minted and before the receipt. The
    // takeover cannot re-run settlement — its steps are one-shot and would
    // return nothing — so it must mint from what the dead attempt recorded.
    await observe(MATCH, "live");
    prepared.kind = "message";
    expect(
      await recordSettlementAnnouncementCheckpoint(prisma, {
        matchId: MATCH,
        payload: instructions(),
      }),
    ).toEqual({ outcome: "applied" });

    // What the takeover does: read the checkpoint, mint from it.
    const recovered = await getSettlementAnnouncementCheckpoint(prisma, {
      matchId: MATCH,
    });
    expect(recovered).not.toBeNull();
    if (recovered === null) return;
    await mintSettlementIntentsV2(prisma, {
      matchId: MATCH,
      announcements: settlementAnnouncementInputsOf(recovered.payload),
      gameCreation: GAME_CREATED_AT,
      createdAt: new Date("2026-09-19T10:00:00.000Z"),
    });
    await mintDareSummaryIntentsV2(prisma, {
      matchId: MATCH,
      dareSettlements: dareSummariesOf(recovered.payload),
      gameCreation: GAME_CREATED_AT,
      createdAt: new Date("2026-09-19T10:00:00.000Z"),
    });

    const minted = await listIntentsForMatch(prisma, { matchId: MATCH });
    expect(minted.map((record) => record.intent.kind).toSorted()).toEqual([
      "dare-summary",
      "settlement",
    ]);
  });

  test("the recovered instructions are the ones settlement produced", async () => {
    // Round-tripping through the checkpoint must not change what is minted,
    // or the recovery path would announce something the live path would not.
    const payload = instructions();
    await recordSettlementAnnouncementCheckpoint(prisma, {
      matchId: MATCH,
      payload,
    });
    const recovered = await getSettlementAnnouncementCheckpoint(prisma, {
      matchId: MATCH,
    });
    if (recovered === null) throw new Error("expected a checkpoint");

    expect(settlementAnnouncementInputsOf(recovered.payload)).toEqual(
      settlementAnnouncementInputsOf(payload),
    );
    expect(dareSummariesOf(recovered.payload)).toEqual([dareSummary({})]);
  });

  test("a retry re-presenting the same instructions is already-applied", async () => {
    await recordSettlementAnnouncementCheckpoint(prisma, {
      matchId: MATCH,
      payload: instructions(),
    });

    expect(
      await recordSettlementAnnouncementCheckpoint(prisma, {
        matchId: MATCH,
        payload: instructions(),
      }),
    ).toEqual({ outcome: "already-applied" });
  });

  test("a second settlement offering different announcements conflicts", async () => {
    // Write-once. The row is the only surviving record of output nothing can
    // recompute, so a differing one is two producers disagreeing about what
    // ONE settlement produced — surfaced, never overwritten.
    await recordSettlementAnnouncementCheckpoint(prisma, {
      matchId: MATCH,
      payload: instructions(),
    });

    const differing = settlementCheckpointPayload({
      closures: [],
      settlements: [settlement],
      parlaySettlements: [],
      earnings: [],
      dareSettlements: [dareSummary({ dareId: 99 })],
    });
    expect(
      await recordSettlementAnnouncementCheckpoint(prisma, {
        matchId: MATCH,
        payload: differing,
      }),
    ).toEqual({
      outcome: "conflict",
      reason: "settlement-announcement-differs",
    });

    // And the first settlement's record still stands, unmodified.
    const standing = await getSettlementAnnouncementCheckpoint(prisma, {
      matchId: MATCH,
    });
    expect(dareSummariesOf(standing?.payload ?? instructions())).toEqual([
      dareSummary({}),
    ]);
  });
});
