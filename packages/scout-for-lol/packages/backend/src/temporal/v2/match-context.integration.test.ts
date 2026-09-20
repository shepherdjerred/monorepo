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

const { resolveScoutV2MatchContext } =
  await import("#src/temporal/v2/match-context.ts");

async function riftPayload(): Promise<unknown> {
  const raw: unknown = JSON.parse(await Bun.file(RIFT_PATH).text());
  return RawMatchSchema.parse(raw);
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

afterAll(async () => {
  await prisma.$disconnect();
});
