import { afterAll, describe, expect, test, vi } from "vitest";
import { ApplicationFailure } from "@temporalio/common";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { LeaguePuuidSchema } from "@scout-for-lol/domain/identity/league-account.ts";
import type * as DatabaseModule from "#src/database/index.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";

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

vi.mock("#src/database/index.ts", async () => {
  const actual = await vi.importActual<typeof DatabaseModule>(
    "#src/database/index.ts",
  );
  return { ...actual, prisma };
});

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
      allPlayerConfigs: [],
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

/**
 * The non-retryable refusal a commit answered with, asserted once.
 *
 * Both refusals this file covers — an untracked source, an unknowable
 * delivery mode — must fail the same way: `MissingDomainRecord`,
 * non-retryable, and with nothing written. Only the message differs, so only
 * the message is passed in.
 */
async function refusedCommit(
  input: Parameters<typeof commitMatchObservationV2>[0],
  message: RegExp,
): Promise<void> {
  const settled = await commitMatchObservationV2(input).then(
    () => null,
    (error: unknown) => error,
  );

  expect(settled).toBeInstanceOf(ApplicationFailure);
  if (!(settled instanceof ApplicationFailure)) return;
  expect(settled.type).toBe("MissingDomainRecord");
  expect(settled.nonRetryable).toBe(true);
  expect(settled.message).toMatch(message);
  expect(
    await getObservation(prisma, { matchId: input.riotMatchId }),
  ).toBeNull();
}

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

    await refusedCommit(
      {
        riotMatchId: matchId,
        sourcePuuid: DEREGISTERED,
        deliveryMode: "live",
      },
      /no longer tracked in it/,
    );

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

  test("refuses rather than choose when nothing knows the mode", async () => {
    // No mode in, no observation to read one from. Choosing here is how a
    // backfill would announce itself, so the run fails before any effect.
    const matchId = RiotMatchIdSchema.parse("NA1_8112");

    await refusedCommit(
      { riotMatchId: matchId },
      /owed a public delivery is unknown/,
    );
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
