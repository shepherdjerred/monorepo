import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { LeaguePuuidSchema } from "@scout-for-lol/domain/identity/league-account.ts";
import {
  IsoInstantSchema,
  RiotMatchIdSchema,
} from "@scout-for-lol/domain/identity/brands.ts";
import type * as MatchIntentsModule from "#src/temporal/v2/notification/match-intents.ts";
import {
  createTestDatabase,
  testDatabaseModule,
} from "#src/testing/test-database.ts";

/**
 * Who the post-match report is owed to, when the roster has moved since.
 *
 * The report belongs to the accounts the match was OBSERVED for, and that set
 * was settled when the observation committed. Rebuilding it from whoever is
 * tracked at the moment the Activity runs asks a different question, and an
 * account deregistered in between answers it by vanishing — the mint succeeds
 * with fewer channels and the run looks complete.
 *
 * So the match context is made to disagree with the durable snapshot on
 * purpose: the context knows one account, the snapshot recorded two.
 */

const { prisma } = createTestDatabase("scout-v2-postmatch-mint-audience");

const MATCH_ID = RiotMatchIdSchema.parse("NA1_9601");
const STILL_TRACKED = LeaguePuuidSchema.parse("s".repeat(78));
const DEREGISTERED = LeaguePuuidSchema.parse("d".repeat(78));

const minted = vi.hoisted((): { puuids: string[][] } => ({ puuids: [] }));

vi.mock("#src/database/index.ts", async () => await testDatabaseModule(prisma));

vi.mock("#src/temporal/v2/match-context.ts", () => ({
  // Only the account that is STILL tracked; the other has deregistered since
  // the match was observed.
  resolveScoutV2MatchContext: (riotMatchId: string) =>
    Promise.resolve({
      matchId: riotMatchId,
      riotMatchId,
      matchData: {
        metadata: { participants: [] },
        info: {
          gameCreation: Date.parse("2026-09-18T09:00:00.000Z"),
          queueId: 420,
          gameMode: "CLASSIC",
          gameType: "MATCHED_GAME",
        },
      },
      trackedPlayers: [
        {
          alias: "still",
          league: { leagueAccount: { puuid: "s".repeat(78) } },
        },
      ],
      allPlayerConfigs: [],
    }),
}));

vi.mock("#src/temporal/v2/notification/match-intents.ts", async () => {
  const actual = await vi.importActual<typeof MatchIntentsModule>(
    "#src/temporal/v2/notification/match-intents.ts",
  );
  return {
    ...actual,
    // Recorded, NOT delegated. What is under test is which audience the
    // Activity computes; the minter itself reads subscribed channels through
    // the database module's own client, which no module mock can redirect,
    // and driving it would test that instead.
    mintPostmatchIntentsV2: (
      _db: Parameters<typeof actual.mintPostmatchIntentsV2>[0],
      args: Parameters<typeof actual.mintPostmatchIntentsV2>[1],
    ) => {
      minted.puuids.push([...args.puuids]);
      return Promise.resolve({
        minted: 0,
        existing: 0,
        conflicts: 0,
        silent: 0,
        undeliverable: 0,
      });
    },
  };
});

const { mintPostmatchNotificationIntentsV2 } =
  await import("#src/temporal/v2/match-effects.ts");
const { recordTrackedAccounts } =
  await import("#src/database/durable/tracked-account-repository.ts");
const { observeMatch } =
  await import("#src/database/durable/observation-repository.ts");

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  minted.puuids.length = 0;
  await prisma.matchTrackedAccount.deleteMany({});
  await prisma.matchObservation.deleteMany({});
});

test("mints for the accounts the match was observed for, not today's", async () => {
  await observeMatch(prisma, {
    matchId: MATCH_ID,
    platformRoute: "NA1",
    policy: "FULL",
    // Live, so the minter does not withhold for an unrelated reason.
    deliveryMode: "live",
    owner: { kind: "temporal-v2" },
    promotion: null,
    gameCreatedAt: IsoInstantSchema.parse("2026-09-18T09:00:00.000Z"),
    observedAt: IsoInstantSchema.parse("2026-09-18T09:40:00.000Z"),
    artifacts: { match: null, timeline: null },
  });
  await recordTrackedAccounts(
    prisma,
    [STILL_TRACKED, DEREGISTERED].map((puuid) => ({
      matchId: MATCH_ID,
      puuid,
      playerId: null,
      accountId: null,
      cursorAdvancedAt: null,
    })),
  );

  await mintPostmatchNotificationIntentsV2({ riotMatchId: MATCH_ID });

  // Both, including the account the current roster no longer knows about.
  expect(minted.puuids).toHaveLength(1);
  expect(minted.puuids[0]?.toSorted()).toEqual(
    [STILL_TRACKED, DEREGISTERED].toSorted(),
  );
});
