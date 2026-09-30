import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { z } from "zod";
import {
  CachedLeaderboardSchema,
  CompetitionIdSchema,
  type CachedLeaderboard,
} from "@scout-for-lol/data";
import {
  createCompetitionReadTools,
  type CompetitionReadDependencies,
} from "#src/explore/tools/competition-read-tools.ts";
import { createCompetitionFixture } from "#src/testing/competition-fixtures.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { testGuildId } from "#src/testing/test-ids.ts";
import {
  passthroughTracker as track,
  runExploreTool as run,
} from "#src/testing/explore-tool-runner.ts";

const { prisma } = createTestDatabase("explore-competition-reads");
afterAll(async () => {
  await prisma.$disconnect();
});

/** Two servers the user is in, and one they are not. */
const MINE = testGuildId("701");
const ALSO_MINE = testGuildId("703");
const ELSEWHERE = testGuildId("702");

const SummarySchema = z.object({
  competitionId: z.number(),
  server: z.string(),
  title: z.string(),
  leader: z.object({ player: z.string() }).nullable().optional(),
});

function board(competitionId: number): CachedLeaderboard {
  return CachedLeaderboardSchema.parse({
    version: "v1",
    competitionId,
    calculatedAt: "2026-09-20T00:00:00.000Z",
    entries: [{ playerId: 1, playerName: "Alice", score: 12, rank: 1 }],
  });
}

function tools(overrides: Partial<CompetitionReadDependencies> = {}) {
  return createCompetitionReadTools(
    {
      db: prisma,
      guildIds: [MINE, ALSO_MINE],
      track,
    },
    {
      loadLeaderboard: (id) => Promise.resolve(board(id)),
      ...overrides,
    },
  );
}

let mineId = 0;
let elsewhereId = 0;
beforeEach(async () => {
  await prisma.competition.deleteMany();
  const mine = await createCompetitionFixture(prisma, {
    serverId: MINE,
    title: "Our cup",
  });
  await createCompetitionFixture(prisma, {
    serverId: ALSO_MINE,
    title: "Our other cup",
  });
  const elsewhere = await createCompetitionFixture(prisma, {
    serverId: ELSEWHERE,
    title: "Their cup",
  });
  mineId = mine.id;
  elsewhereId = elsewhere.id;
});

describe("list_competitions", () => {
  test("lists every server the user is in, and no other", async () => {
    // Membership is the whole gate: every member holds competitions:read.
    const result = await run(tools().list_competitions.execute, {});
    const listed = z.array(SummarySchema).parse(result.data);
    expect(listed.map((entry) => entry.title).toSorted()).toEqual([
      "Our cup",
      "Our other cup",
    ]);
  });

  test("reads each competition's leader only when asked", async () => {
    const plainResult = await run(tools().list_competitions.execute, {});
    const plain = z.array(SummarySchema).parse(plainResult.data);
    expect(plain[0]?.leader).toBeUndefined();
    const leaderResult = await run(tools().list_competitions.execute, {
      includeLeaders: true,
    });
    const withLeaders = z.array(SummarySchema).parse(leaderResult.data);
    expect(withLeaders[0]?.leader?.player).toBe("Alice");
  });
});

describe("get_competition_standings", () => {
  test("reads a competition in one of the user's servers", async () => {
    const result = await run(tools().get_competition_standings.execute, {
      competitionId: CompetitionIdSchema.parse(mineId),
    });
    expect(result.kind).toBe("competition_standings");
    expect(JSON.stringify(result.data)).toContain("Alice");
  });

  test("a competition in another server looks exactly like a missing one", async () => {
    // Confirming it exists would leak a server the user is not in.
    const hidden = await run(tools().get_competition_standings.execute, {
      competitionId: CompetitionIdSchema.parse(elsewhereId),
    });
    const missing = await run(tools().get_competition_standings.execute, {
      competitionId: CompetitionIdSchema.parse(elsewhereId + mineId + 1000),
    });
    expect(hidden).toEqual(missing);
    expect(hidden.kind).toBe("competition_not_found");
  });

  test("says standings are not computed rather than that nobody plays", async () => {
    const result = await run(
      tools({ loadLeaderboard: () => Promise.resolve(null) })
        .get_competition_standings.execute,
      { competitionId: CompetitionIdSchema.parse(mineId) },
    );
    expect(result.message).toContain("have not been computed");
  });
});
