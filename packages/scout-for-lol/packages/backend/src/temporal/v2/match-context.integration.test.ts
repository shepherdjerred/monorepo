import { afterAll, expect, test, vi } from "vitest";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { RawMatchSchema } from "@scout-for-lol/data";
import {
  createTestDatabase,
  testDatabaseModule,
} from "#src/testing/test-database.ts";

/**
 * Which route a match is fetched through, when no tracked account is on it.
 *
 * The route belongs to the match, not to the roster: a Riot match id carries
 * its platform as its own prefix. The resolver used to derive that platform
 * and then search the live accounts for one whose region mapped back to it,
 * failing non-retryably when none did. That made every per-match Activity
 * depend on the present state of the roster to process a match Scout had
 * already observed, and it failed at the FIRST Activity, so the run stopped
 * before the cursor could advance and every later match queued behind it.
 *
 * Both cases below fail under that shape. The first is the reported one: an
 * account deregisters and the platform it covered goes with it. The second
 * could never work at all, because `ME1` is a platform no `Region` maps to,
 * so no roster however complete could have produced a route for it.
 */

const { prisma } = createTestDatabase("scout-v2-match-context-route");

const RIFT_PATH = `${import.meta.dir}/../../../../../testdata/rift.json`;

const riot = vi.hoisted((): { routes: string[]; response: unknown } => ({
  routes: [],
  response: undefined,
}));

vi.mock("#src/database/index.ts", async () => await testDatabaseModule(prisma));

// No guilds, therefore no tracked accounts, which is the condition under test.
vi.mock("#src/discord/utils/guild-membership.ts", () => ({
  getActiveServerIds: () => [],
}));

vi.mock("#src/league/api/api.ts", () => ({
  riotClient: {
    match: {
      get: (_matchId: string, regionalRoute: string) => {
        riot.routes.push(regionalRoute);
        return Promise.resolve(riot.response);
      },
      timeline: () => Promise.resolve(undefined),
    },
  },
}));

const { resolveScoutV2MatchContext, resolveScoutV2ObservedMatchContext } =
  await import("#src/temporal/v2/match-context.ts");
const { observeMatch } =
  await import("#src/database/durable/observation-repository.ts");
const { recordTrackedAccounts } =
  await import("#src/database/durable/tracked-account-repository.ts");
const { IsoInstantSchema } =
  await import("@scout-for-lol/domain/identity/brands.ts");
const { LeaguePuuidSchema } =
  await import("@scout-for-lol/domain/identity/league-account.ts");
const { platformRouteOf } =
  await import("#src/durable/match/match-identity.ts");
const { DiscordAccountIdSchema, DiscordGuildIdSchema } =
  await import("@scout-for-lol/domain/identity/discord.ts");

async function riftPayload(): Promise<unknown> {
  const raw: unknown = JSON.parse(await Bun.file(RIFT_PATH).text());
  return RawMatchSchema.parse(raw);
}

/** An observation for `matchId`, tracking `puuids`. */
async function observe(matchId: string, puuids: string[]): Promise<void> {
  const parsed = RiotMatchIdSchema.parse(matchId);
  await observeMatch(prisma, {
    matchId: parsed,
    platformRoute: platformRouteOf(parsed),
    policy: "FULL",
    deliveryMode: "live",
    owner: { kind: "temporal-v2" },
    promotion: null,
    gameCreatedAt: IsoInstantSchema.parse("2026-09-18T09:00:00.000Z"),
    observedAt: IsoInstantSchema.parse("2026-09-18T09:40:00.000Z"),
    artifacts: { match: null, timeline: null },
  });
  await recordTrackedAccounts(
    prisma,
    puuids.map((puuid) => ({
      matchId: parsed,
      puuid: LeaguePuuidSchema.parse(puuid),
      playerId: null,
      accountId: null,
      cursorAdvancedAt: null,
    })),
  );
}

test("resolves a match on a platform no tracked account plays on", async () => {
  riot.routes.length = 0;
  riot.response = await riftPayload();

  const context = await resolveScoutV2MatchContext(
    RiotMatchIdSchema.parse("KR_9701"),
  );

  // The platform came from the id, so the fetch is routed without consulting
  // anyone's registration.
  expect(riot.routes).toEqual(["ASIA"]);
  // Nobody tracked is in it, which is a match with no audience rather than an
  // error: the pipeline still archives it and still advances its cursor.
  expect(context.trackedPlayers).toEqual([]);
  expect(context.riotMatchId).toBe("KR_9701");
});

test("resolves a match on a platform no Region can express", async () => {
  riot.routes.length = 0;
  riot.response = await riftPayload();

  const context = await resolveScoutV2MatchContext(
    RiotMatchIdSchema.parse("ME1_9702"),
  );

  expect(riot.routes).toEqual(["EUROPE"]);
  expect(context.trackedPlayers).toEqual([]);
});

/**
 * The roster the observation recorded, against a live roster that hides it.
 *
 * `getActiveServerIds` is mocked empty above, which is exactly what a worker
 * whose Discord guild cache does not hold this guild sees — the `Account` rows
 * are all still there, and the live resolver still answers with nobody. The
 * observed resolver must answer with the recorded account regardless, because
 * the same filter narrows differently in different processes and a report that
 * was owed must not depend on which worker picked the Activity up.
 */
test("observed roster survives a live roster narrowed to nothing", async () => {
  riot.response = await riftPayload();
  const puuid = LeaguePuuidSchema.parse("a".repeat(78));
  const player = await prisma.player.create({
    data: {
      alias: "observed-player",
      discordId: DiscordAccountIdSchema.parse("1".repeat(18)),
      // A guild this worker's gateway cache does not hold.
      serverId: DiscordGuildIdSchema.parse("3".repeat(18)),
      creatorDiscordId: DiscordAccountIdSchema.parse("2".repeat(18)),
      createdTime: new Date(),
      updatedTime: new Date(),
    },
  });
  await prisma.account.create({
    data: {
      alias: "observed-account",
      puuid,
      region: "AMERICA_NORTH",
      playerId: player.id,
      serverId: player.serverId,
      creatorDiscordId: player.creatorDiscordId,
      createdTime: new Date(),
      updatedTime: new Date(),
    },
  });
  await observe("NA1_9801", [puuid]);

  const live = await resolveScoutV2MatchContext(
    RiotMatchIdSchema.parse("NA1_9801"),
  );
  const observed = await resolveScoutV2ObservedMatchContext(
    RiotMatchIdSchema.parse("NA1_9801"),
  );

  // The two genuinely disagree, which is the whole defect.
  expect(live.trackedPlayers).toEqual([]);
  expect(observed.observedPuuids).toEqual([puuid]);
  expect(observed.trackedPlayers.map((config) => config.alias)).toEqual([
    "observed-player",
  ]);
  expect(
    observed.trackedPlayers.map((config) => config.league.leagueAccount.region),
  ).toEqual(["AMERICA_NORTH"]);
});

/**
 * An observation that recorded NOBODY is legitimate and must return empty.
 * Routing a match by its own id made exactly this reachable, so collapsing it
 * into the failure below would reintroduce the stall that change removed.
 */
test("observed roster is empty for a match observed for nobody", async () => {
  riot.response = await riftPayload();
  await observe("NA1_9802", []);

  const observed = await resolveScoutV2ObservedMatchContext(
    RiotMatchIdSchema.parse("NA1_9802"),
  );

  expect(observed.observedPuuids).toEqual([]);
  expect(observed.trackedPlayers).toEqual([]);
});

/**
 * No observation at all is a caller reaching for the snapshot before it is
 * written — an ordering error no retry fixes — and must not be answered with
 * the same empty roster a match observed for nobody gets.
 */
test("observed roster fails loudly when the match has no observation", async () => {
  riot.response = await riftPayload();

  await expect(
    resolveScoutV2ObservedMatchContext(RiotMatchIdSchema.parse("NA1_9803")),
  ).rejects.toThrow(/has no observation/u);
});

afterAll(async () => {
  await prisma.$disconnect();
});
