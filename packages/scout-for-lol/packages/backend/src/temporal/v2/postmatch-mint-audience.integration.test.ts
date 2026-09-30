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
 * The resolver is REAL here and reads this file's own database. It used to be
 * mocked, with the snapshot read living in the Activity beside it, so the two
 * could be made to disagree from the test. The snapshot read now lives inside
 * the resolver, and mocking it would have left this asserting only that the
 * Activity passes through whatever the mock said. So the disagreement is built
 * where it actually occurs: the snapshot records two accounts and NEITHER has
 * an `Account` row, which is what a deregistration leaves behind, and the mint
 * must still name both.
 */

const { prisma } = createTestDatabase("scout-v2-postmatch-mint-audience");

const MATCH_ID = RiotMatchIdSchema.parse("NA1_9601");
const STILL_TRACKED = LeaguePuuidSchema.parse("s".repeat(78));
const DEREGISTERED = LeaguePuuidSchema.parse("d".repeat(78));

const RIFT_PATH = `${import.meta.dir}/../../../../../testdata/rift.json`;

const minted = vi.hoisted((): { puuids: string[][] } => ({ puuids: [] }));
const riot = vi.hoisted((): { response: unknown } => ({ response: undefined }));

vi.mock("#src/database/index.ts", async () => await testDatabaseModule(prisma));

// The resolver imports this module; the observed path never calls it, and
// stubbing it keeps the Discord client out of the test.
vi.mock("#src/discord/utils/guild-membership.ts", () => ({
  getActiveServerIds: () => [],
}));

vi.mock("#src/league/api/api.ts", () => ({
  riotClient: {
    match: {
      get: () => Promise.resolve(riot.response),
      timeline: () => Promise.resolve(undefined),
    },
  },
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
const { RawMatchSchema } = await import("@scout-for-lol/data");

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  minted.puuids.length = 0;
  riot.response = RawMatchSchema.parse(
    JSON.parse(await Bun.file(RIFT_PATH).text()),
  );
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
