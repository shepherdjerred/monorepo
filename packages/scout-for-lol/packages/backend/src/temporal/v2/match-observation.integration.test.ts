import { afterAll, describe, expect, test, vi } from "vitest";
import { ApplicationFailure } from "@temporalio/common";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { LeaguePuuidSchema } from "@scout-for-lol/domain/identity/league-account.ts";
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

const riot = vi.hoisted(() => ({
  gameCreation: Date.parse("2026-09-16T09:00:00.000Z"),
  trackedPuuids: ["s".repeat(78), "t".repeat(78)],
}));

vi.mock("#src/database/index.ts", async () => await testDatabaseModule(prisma));

vi.mock("#src/temporal/v2/match-context.ts", () => ({
  resolveScoutV2MatchContext: (riotMatchId: string) =>
    Promise.resolve({
      matchId: riotMatchId,
      riotMatchId,
      matchData: { info: { gameCreation: riot.gameCreation } },
      trackedPlayers: riot.trackedPuuids.map((puuid) => ({
        alias: puuid.slice(0, 4),
        league: { leagueAccount: { puuid } },
      })),
    }),
}));

const { commitMatchObservationV2 } =
  await import("#src/temporal/v2/match-archive.ts");
const { getObservation } =
  await import("#src/database/durable/observation-repository.ts");
const { listTrackedAccounts } =
  await import("#src/database/durable/tracked-account-repository.ts");

afterAll(async () => {
  await prisma.$disconnect();
});

describe("the source precondition on the V2 observation commit", () => {
  test("commits when the discovering account is still tracked in the match", async () => {
    const matchId = RiotMatchIdSchema.parse("NA1_8101");

    const result = await commitMatchObservationV2({
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

    const settled = await commitMatchObservationV2({
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

    const result = await commitMatchObservationV2({
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

    const result = await commitMatchObservationV2({
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
    await commitMatchObservationV2({
      riotMatchId: matchId,
      sourcePuuid: SOURCE,
      deliveryMode: "silent-backfill",
    });

    const resumed = await commitMatchObservationV2({ riotMatchId: matchId });

    expect(resumed.deliveryMode).toBe("silent-backfill");
    expect(resumed.commit).toEqual({ outcome: "already-applied" });
    const stored = await getObservation(prisma, { matchId });
    expect(stored?.deliveryMode).toBe("silent-backfill");
  });

  test("observes as live a child started before the mode existed", async () => {
    // The only run that reaches here: a per-match child started from a
    // pre-change discovery, whose input was serialized without the field and
    // which had not yet committed its observation when this deployed. Its
    // starter stamped `live` unconditionally, so `live` is what that
    // execution already did, not a choice taken now on its behalf. Refusing
    // would kill the child after it had archived and fail its parent
    // discovery — the loss this preserves against.
    const matchId = RiotMatchIdSchema.parse("NA1_8112");

    const result = await commitMatchObservationV2({ riotMatchId: matchId });

    expect(result.deliveryMode).toBe("live");
    expect(result.commit).toEqual({ outcome: "applied" });
    const stored = await getObservation(prisma, { matchId });
    expect(stored?.deliveryMode).toBe("live");
  });

  test("refuses a live claim over a standing silent-backfill", async () => {
    // The mode is part of the observation claim, so two producers disagreeing
    // about it is drift, never a quiet overwrite. This is what stops a later
    // live discovery from turning a committed backfill into an announcement.
    const matchId = RiotMatchIdSchema.parse("NA1_8113");
    await commitMatchObservationV2({
      riotMatchId: matchId,
      sourcePuuid: SOURCE,
      deliveryMode: "silent-backfill",
    });

    const settled = await commitMatchObservationV2({
      riotMatchId: matchId,
      sourcePuuid: SOURCE,
      deliveryMode: "live",
    }).then(
      () => null,
      (error: unknown) => error,
    );

    expect(settled).toBeInstanceOf(ApplicationFailure);
    const stored = await getObservation(prisma, { matchId });
    expect(stored?.deliveryMode).toBe("silent-backfill");
  });
});
