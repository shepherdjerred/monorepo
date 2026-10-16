import { afterAll, describe, expect, test, vi } from "vitest";
import { ApplicationFailure } from "@temporalio/common";
import {
  RiotMatchIdSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import { LeaguePuuidSchema } from "@scout-for-lol/domain/identity/league-account.ts";
import type { MatchDataSource } from "@scout-for-lol/domain/match-processing/states.ts";
import {
  createTestDatabase,
  testDatabaseModule,
} from "#src/testing/test-database.ts";

/**
 * v1's source precondition on the V2 observation commit, against real rows.
 *
 * Riot is replaced and nothing else is: the commit resolves the match context
 * for the game's creation instant and its tracked participants, and the
 * precondition is a question about exactly those participants. Every durable
 * write — the observation, the tracked-account associations — runs against
 * Postgres so the refusal can be shown to leave nothing behind.
 */

const { prisma } = createTestDatabase("scout-v2-match-observation");

const SOURCE = LeaguePuuidSchema.parse("s".repeat(78));
const OTHER_TRACKED = LeaguePuuidSchema.parse("t".repeat(78));
const DEREGISTERED = LeaguePuuidSchema.parse("d".repeat(78));

const riot = vi.hoisted(
  (): {
    gameCreation: number;
    trackedPuuids: string[];
    matchDataSource: MatchDataSource;
  } => ({
    gameCreation: Date.parse("2026-09-16T09:00:00.000Z"),
    trackedPuuids: ["s".repeat(78), "t".repeat(78)],
    matchDataSource: "RIOT",
  }),
);

vi.mock("#src/database/index.ts", async () => await testDatabaseModule(prisma));

vi.mock("#src/temporal/match/match-context.ts", () => ({
  resolveScoutMatchContext: (riotMatchId: RiotMatchId) =>
    Promise.resolve({
      riotMatchId,
      matchData: {
        info: {
          gameCreation: riot.gameCreation,
          gameEndTimestamp: riot.gameCreation + 1_800_000,
        },
      },
      matchDataSource: riot.matchDataSource,
      trackedPlayers: riot.trackedPuuids.map((puuid) => ({
        alias: puuid.slice(0, 4),
        league: { leagueAccount: { puuid } },
      })),
    }),
}));

const { commitMatchObservation } =
  await import("#src/temporal/match/match-archive.ts");
const { getObservation } =
  await import("#src/database/durable/observation-repository.ts");
const { listTrackedAccounts } =
  await import("#src/database/durable/tracked-account-repository.ts");

afterAll(async () => {
  await prisma.$disconnect();
});

describe("the source precondition on the V2 observation commit", () => {
  test("later history evidence completes a previously admitted live job", async () => {
    const matchId = RiotMatchIdSchema.parse("NA1_8130");
    const { admitMatchEvidence } = await import("#src/evidence/admission.ts");
    const completedAt = riot.gameCreation + 1_800_000;
    await admitMatchEvidence({
      matchId,
      completedAt,
      discoveredAt: new Date(completedAt),
      historical: false,
    });
    const completed = await commitMatchObservation({
      riotMatchId: matchId,
      sourcePuuid: SOURCE,
      deliveryMode: "silent-backfill",
    });
    expect(completed).toMatchObject({ policy: "FULL", deliveryMode: "live" });
    expect(await getObservation(prisma, { matchId })).toMatchObject({
      policy: "FULL",
      deliveryMode: "live",
    });
  });
  test("commits when the discovering account is still tracked in the match", async () => {
    const matchId = RiotMatchIdSchema.parse("NA1_8101");

    const result = await commitMatchObservation({
      riotMatchId: matchId,
      sourcePuuid: SOURCE,
      deliveryMode: "live",
    });

    expect(result.commit).toEqual({ outcome: "applied" });
    expect(result.owner).toEqual({ kind: "temporal-v2" });
    const tracked = await listTrackedAccounts(prisma, { matchId });
    expect(tracked.map((row) => row.puuid).toSorted()).toEqual(
      [SOURCE, OTHER_TRACKED].toSorted(),
    );
  });

  test("refuses, before any write, a source that is no longer tracked in the match", async () => {
    // v1's `ingestDiscoveredMatch` throws here. The account that surfaced the
    // match was deregistered between discovery and this commit; V2's own
    // platform check would have let the match through on the strength of the
    // OTHER tracked participant, which is the weakening the restored check
    // closes. Non-retryable: no retry changes which accounts are tracked.
    const matchId = RiotMatchIdSchema.parse("NA1_8102");

    const settled = await commitMatchObservation({
      riotMatchId: matchId,
      sourcePuuid: DEREGISTERED,
      deliveryMode: "live",
    }).then(
      () => null,
      (error: unknown) => error,
    );

    expect(settled).toBeInstanceOf(ApplicationFailure);
    expect(settled).toMatchObject({
      type: "MissingDomainRecord",
      nonRetryable: true,
      message: expect.stringMatching(/no longer tracked in it/),
    });
    expect(await getObservation(prisma, { matchId })).toBeNull();

    // Nothing was claimed on that account's behalf.
    expect(await listTrackedAccounts(prisma, { matchId })).toEqual([]);
  });

  test("commits without a source when the run has none to check", async () => {
    // A reconciliation restart carries no discovering account: it resumes a
    // match from durable state, and the check ran when that observation was
    // first committed. The absence is explicit, not a fallback.
    const matchId = RiotMatchIdSchema.parse("NA1_8103");

    const result = await commitMatchObservation({
      riotMatchId: matchId,
      deliveryMode: "live",
    });

    expect(result.commit).toEqual({ outcome: "applied" });
    expect(await getObservation(prisma, { matchId })).not.toBeNull();
  });
});

describe("the delivery mode the V2 observation commits", () => {
  test("records the mode the discovering pass decided", async () => {
    // Only that pass knows whether it followed live history or filled a gap.
    const matchId = RiotMatchIdSchema.parse("NA1_8110");

    const result = await commitMatchObservation({
      riotMatchId: matchId,
      sourcePuuid: SOURCE,
      deliveryMode: "silent-backfill",
    });

    expect(result.deliveryMode).toBe("silent-backfill");
    const stored = await getObservation(prisma, { matchId });
    expect(stored?.deliveryMode).toBe("silent-backfill");
  });

  test("takes the committed mode when the run carries none", async () => {
    // The reconciliation restart. It resumes a match already observed, so the
    // mode is a durable fact to be read, not a decision to be retaken.
    const matchId = RiotMatchIdSchema.parse("NA1_8111");
    await commitMatchObservation({
      riotMatchId: matchId,
      sourcePuuid: SOURCE,
      deliveryMode: "silent-backfill",
    });

    const resumed = await commitMatchObservation({ riotMatchId: matchId });

    expect(resumed.deliveryMode).toBe("silent-backfill");
    expect(resumed.commit).toEqual({ outcome: "already-applied" });
    const stored = await getObservation(prisma, { matchId });
    expect(stored?.deliveryMode).toBe("silent-backfill");
  });

  test("a late child without a standing admission is historical in beta", async () => {
    // An absent legacy mode cannot establish earlier live admission. Preserve
    // capture while excluding effects for this first discovery of an old game.
    const matchId = RiotMatchIdSchema.parse("NA1_8112");

    const result = await commitMatchObservation({ riotMatchId: matchId });

    expect(result.deliveryMode).toBe("silent-backfill");
    expect(result.policy).toBe("HISTORY_ONLY");
    expect(result.commit).toEqual({ outcome: "applied" });
    const stored = await getObservation(prisma, { matchId });
    expect(stored?.deliveryMode).toBe("silent-backfill");
  });

  test("a later live discovery cannot change historical admission", async () => {
    const matchId = RiotMatchIdSchema.parse("NA1_8113");
    await commitMatchObservation({
      riotMatchId: matchId,
      sourcePuuid: SOURCE,
      deliveryMode: "silent-backfill",
    });

    const settled = await commitMatchObservation({
      riotMatchId: matchId,
      sourcePuuid: SOURCE,
      deliveryMode: "live",
    });

    expect(settled).toMatchObject({
      policy: "HISTORY_ONLY",
      deliveryMode: "silent-backfill",
      commit: { outcome: "already-applied" },
    });
    const stored = await getObservation(prisma, { matchId });
    expect(stored?.deliveryMode).toBe("silent-backfill");
  });
});

describe("the payload provenance the V2 observation commits", () => {
  test("records a Riot-sourced match as RIOT", async () => {
    const matchId = RiotMatchIdSchema.parse("NA1_8120");

    await commitMatchObservation({
      riotMatchId: matchId,
      deliveryMode: "live",
    });

    const stored = await getObservation(prisma, { matchId });
    expect(stored?.matchDataSource).toBe("RIOT");
  });

  test("records a client-captured match as SCOUT_CLIENT", async () => {
    const matchId = RiotMatchIdSchema.parse("NA1_8121");
    riot.matchDataSource = "SCOUT_CLIENT";
    try {
      await commitMatchObservation({
        riotMatchId: matchId,
        deliveryMode: "live",
      });
    } finally {
      riot.matchDataSource = "RIOT";
    }

    const stored = await getObservation(prisma, { matchId });
    expect(stored?.matchDataSource).toBe("SCOUT_CLIENT");
  });
});
