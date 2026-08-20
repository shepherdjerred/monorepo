import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { testGuildId, testPuuid } from "#src/testing/test-ids.ts";
import { resolveLakeDir } from "#src/report-lake/paths.ts";
import {
  resetTestLake,
  writeTestLake,
  type TestLakeMatchFact,
} from "#src/testing/test-report-lake.ts";
import { executeReportQuery } from "#src/reports/query-engine.ts";
import { GLOBAL_SCOPE } from "#src/reports/duckdb/scope.ts";
import { resolvePlayerIdentities } from "#src/reports/identity.ts";
import { formatReportQuery } from "@scout-for-lol/data";

/**
 * Identity: one person, several accounts, several names.
 *
 * The fixture reproduces the two fan-outs that compound in production. "Aaron"
 * is one tracked player with two accounts, and his first account was renamed,
 * so his games are spread over three Riot IDs. "Edward" is a second player
 * whose old Riot ID happens to begin with another player's alias — the shape
 * that let one person's stats surface under another person's name.
 */

const { prisma } = createTestDatabase("report-identity-test");
const serverId = testGuildId("515151");
const otherServerId = testGuildId("626262");
const now = new Date(Date.UTC(2026, 4, 17, 12, 0, 0));
const lakeDir = resolveLakeDir();

const AARON_MAIN = testPuuid("aaron-main");
const AARON_SMURF = testPuuid("aaron-smurf");
const EDWARD = testPuuid("edward-main");

function fact(
  overrides: Partial<TestLakeMatchFact> & {
    matchId: string;
    puuid: string;
    playerId: number;
    playerAlias: string;
  },
): TestLakeMatchFact {
  return {
    queue: "solo",
    win: true,
    surrendered: false,
    kills: 5,
    deaths: 3,
    assists: 7,
    gameCreationAt: new Date(Date.UTC(2026, 4, 1, 0, 0, 0)),
    ...overrides,
  };
}

const matchFacts: TestLakeMatchFact[] = [
  // Aaron's main, renamed part-way through: two Riot IDs, one PUUID.
  fact({
    matchId: "NA1_A1",
    puuid: AARON_MAIN,
    playerId: 1,
    playerAlias: "Aaron",
    riotIdGameName: "DarkinBunnygirl",
    gameCreationAt: new Date(Date.UTC(2026, 3, 1)),
  }),
  fact({
    matchId: "NA1_A2",
    puuid: AARON_MAIN,
    playerId: 1,
    playerAlias: "Aaron",
    riotIdGameName: "GexIsAngry",
    gameCreationAt: new Date(Date.UTC(2026, 4, 1)),
  }),
  // Aaron's second account: a third Riot ID, a second PUUID.
  fact({
    matchId: "NA1_A3",
    puuid: AARON_SMURF,
    playerId: 1,
    playerAlias: "Aaron",
    riotIdGameName: "EddieChavez",
    gameCreationAt: new Date(Date.UTC(2026, 4, 2)),
  }),
  // Edward, whose old name starts with the word "Long".
  fact({
    matchId: "NA1_E1",
    puuid: EDWARD,
    playerId: 2,
    playerAlias: "Edward",
    riotIdGameName: "Long Tentacles",
    gameCreationAt: new Date(Date.UTC(2026, 4, 3)),
  }),
];

beforeEach(async () => {
  await resetTestLake(lakeDir);
  await writeTestLake(lakeDir, { serverId, matchFacts });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("player identity resolution", () => {
  test("an alias resolves to every account and every past name", async () => {
    const found = await resolvePlayerIdentities({
      query: "Aaron",
      guildIds: [serverId],
      lakeDir,
    });

    expect(found).toHaveLength(1);
    expect(found[0]?.displayName).toBe("Aaron");
    expect(found[0]?.puuids.toSorted()).toEqual(
      [AARON_MAIN, AARON_SMURF].toSorted(),
    );
    expect(found[0]?.riotIds.toSorted()).toEqual([
      "DarkinBunnygirl#NA1",
      "EddieChavez#NA1",
      "GexIsAngry#NA1",
    ]);
    expect(found[0]?.games).toBe(3);
  });

  // The bug in one assertion: one of Aaron's names must answer for Aaron, not
  // for the slice of games played under that name.
  test("a Riot ID belonging to a tracked account resolves to the person", async () => {
    const found = await resolvePlayerIdentities({
      query: "GexIsAngry#NA1",
      guildIds: [serverId],
      lakeDir,
    });

    expect(found).toHaveLength(1);
    expect(found[0]?.displayName).toBe("Aaron");
    expect(found[0]?.games).toBe(3);
  });

  // "Long" is nobody here. Matching it to Edward's "Long Tentacles" would
  // report one player's games under another player's name — which reads as a
  // perfectly ordinary answer, unlike an under-count.
  test("a name is not matched to a different player's Riot ID", async () => {
    expect(
      await resolvePlayerIdentities({
        query: "Long",
        guildIds: [serverId],
        lakeDir,
      }),
    ).toEqual([]);

    const edward = await resolvePlayerIdentities({
      query: "Long Tentacles",
      guildIds: [serverId],
      lakeDir,
    });
    expect(edward[0]?.displayName).toBe("Edward");
  });

  // The alias lookup is the one part that crosses into per-server data, so it
  // must answer only for servers the asker actually belongs to.
  test("an alias is invisible to someone outside that server", async () => {
    expect(
      await resolvePlayerIdentities({
        query: "Aaron",
        guildIds: [otherServerId],
        lakeDir,
      }),
    ).toEqual([]);
  });
});

/** Total `games` across every returned row, for a global-scope query. */
async function games(queryText: string): Promise<number> {
  const result = await executeReportQuery({
    prisma,
    scope: GLOBAL_SCOPE,
    askerGuildIds: [serverId],
    queryText,
    now,
  });
  return result.rows.reduce(
    (total, row) => total + Number(row.values[0]?.value ?? 0),
    0,
  );
}

describe("PUUIDs stay in the data layer", () => {
  // The owner's constraint, as a test. Stored query text is rendered in the
  // transcript, served unauthenticated to anyone holding a share link, baked
  // into markdown exports, and replayed into the model's context on every
  // follow-up — so a PUUID reaching it escapes in four directions at once.
  // `player('…')` keeps the human name in the text and resolves behind it.
  test("a resolved query still reads as the name the author wrote", async () => {
    const queryText =
      "SELECT games FROM match_participants WHERE player = player('Aaron') GROUP BY player DURING ALL TIME";

    const result = await executeReportQuery({
      prisma,
      scope: GLOBAL_SCOPE,
      askerGuildIds: [serverId],
      queryText,
      now,
    });

    const formatted = formatReportQuery(queryText);
    expect(formatted).toContain("player = player('Aaron')");
    for (const puuid of [AARON_MAIN, AARON_SMURF, EDWARD]) {
      expect(formatted).not.toContain(puuid);
      expect(JSON.stringify(result.plan)).not.toContain(puuid);
    }
  });

  // The label a reader sees is the most recent Riot ID, not an arbitrary one:
  // grouping is by puuid, so `any_value` could surface a name the player has
  // not used in months, and two runs could disagree.
  test("a renamed player is labelled with their current Riot ID", async () => {
    const result = await executeReportQuery({
      prisma,
      scope: GLOBAL_SCOPE,
      askerGuildIds: [serverId],
      queryText:
        "SELECT games FROM match_participants WHERE player = player('Aaron') GROUP BY player DURING ALL TIME",
      now,
    });

    const labels = result.rows.map((row) => row.label).toSorted();
    // AARON_MAIN's latest game is under GexIsAngry, not the older
    // DarkinBunnygirl; AARON_SMURF has only ever been EddieChavez.
    expect(labels).toEqual(["EddieChavez#NA1", "GexIsAngry#NA1"]);
  });
});

describe("player('…') in a query", () => {
  test("counts every account and every past name", async () => {
    expect(
      await games(
        "SELECT games FROM match_participants WHERE player = player('Aaron') GROUP BY player DURING ALL TIME",
      ),
    ).toBe(3);
  });

  test("a bare Riot ID still finds only that name's games", async () => {
    expect(
      await games(
        "SELECT games FROM match_participants WHERE player = 'GexIsAngry#NA1' GROUP BY player DURING ALL TIME",
      ),
    ).toBe(1);
  });

  // An unresolvable reference must not compile to "no filter" or to an empty
  // IN (): both answer a question nobody asked and look like a real result.
  test("an unresolvable name fails instead of matching everyone", async () => {
    await expect(
      games(
        "SELECT games FROM match_participants WHERE player = player('nobody') GROUP BY player DURING ALL TIME",
      ),
    ).rejects.toThrow('No player matches "nobody"');
  });
});
