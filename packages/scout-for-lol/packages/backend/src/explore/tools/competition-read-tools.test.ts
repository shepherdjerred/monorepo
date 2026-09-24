import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { z } from "zod";
import {
  CachedLeaderboardSchema,
  CompetitionIdSchema,
  P,
  createPermissionSet,
  type CachedLeaderboard,
} from "@scout-for-lol/data";
import type { CreationAccess } from "#src/explore/creation/capability.ts";
import {
  createCompetitionReadTools,
  type CompetitionReadDependencies,
} from "#src/explore/tools/competition-read-tools.ts";
import { createCompetitionFixture } from "#src/testing/competition-fixtures.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { testAccountId, testGuildId } from "#src/testing/test-ids.ts";
import {
  passthroughTracker as track,
  runExploreTool as run,
} from "#src/testing/explore-tool-runner.ts";

const { prisma } = createTestDatabase("explore-competition-reads");
afterAll(async () => {
  await prisma.$disconnect();
});

const READABLE = testGuildId("701");
const UNREADABLE = testGuildId("702");
const REQUESTER = testAccountId("799");

const SummarySchema = z.object({
  competitionId: z.number(),
  guildId: z.string(),
  title: z.string(),
  leader: z.object({ player: z.string() }).nullable().optional(),
});

/** The user reads competitions in READABLE and is only a member of UNREADABLE. */
function access(): CreationAccess {
  return {
    kind: "resolved",
    guilds: [
      {
        guildId: READABLE,
        name: "Readable",
        permissions: createPermissionSet([P("competitions", "read")]),
      },
      {
        guildId: UNREADABLE,
        name: "Member only",
        permissions: createPermissionSet([]),
      },
    ],
  };
}

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
      requesterId: REQUESTER,
      guildIds: [READABLE, UNREADABLE],
      track,
    },
    {
      resolveAccess: () => Promise.resolve(access()),
      loadLeaderboard: (id) => Promise.resolve(board(id)),
      ...overrides,
    },
  );
}

let readableId = 0;
let unreadableId = 0;
beforeEach(async () => {
  await prisma.competition.deleteMany();
  const readable = await createCompetitionFixture(prisma, {
    serverId: READABLE,
    title: "Readable cup",
  });
  const unreadable = await createCompetitionFixture(prisma, {
    serverId: UNREADABLE,
    title: "Hidden cup",
  });
  readableId = readable.id;
  unreadableId = unreadable.id;
});

describe("list_competitions", () => {
  test("lists only servers where the user holds competitions:read", async () => {
    const result = await run(tools().list_competitions.execute, {});
    const listed = z.array(SummarySchema).parse(result.data);
    expect(listed.map((entry) => entry.title)).toEqual(["Readable cup"]);
    // The model is told some servers were skipped, and why.
    expect(result.message).toContain("competitions:read");
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

  test("an unreachable Discord is never reported as a refusal", async () => {
    const result = await run(
      tools({
        resolveAccess: () =>
          Promise.resolve({
            kind: "verification_unavailable",
            message: "could not reach Discord",
          }),
      }).list_competitions.execute,
      {},
    );
    expect(result.kind).toBe("competitions_unverified");
    expect(result.message).toBe("could not reach Discord");
    expect(result.data).toEqual([]);
  });
});

describe("get_competition_standings", () => {
  test("reads a competition the user may see", async () => {
    const result = await run(tools().get_competition_standings.execute, {
      competitionId: CompetitionIdSchema.parse(readableId),
    });
    expect(result.kind).toBe("competition_standings");
    expect(JSON.stringify(result.data)).toContain("Alice");
  });

  test("an unreadable competition looks exactly like a missing one", async () => {
    // Confirming it exists would leak a competition the user cannot see.
    const hidden = await run(tools().get_competition_standings.execute, {
      competitionId: CompetitionIdSchema.parse(unreadableId),
    });
    const missing = await run(tools().get_competition_standings.execute, {
      competitionId: CompetitionIdSchema.parse(
        unreadableId + readableId + 1000,
      ),
    });
    expect(hidden).toEqual(missing);
    expect(hidden.kind).toBe("competition_not_found");
  });

  test("says standings are not computed rather than that nobody plays", async () => {
    const result = await run(
      tools({ loadLeaderboard: () => Promise.resolve(null) })
        .get_competition_standings.execute,
      { competitionId: CompetitionIdSchema.parse(readableId) },
    );
    expect(result.message).toContain("have not been computed");
  });
});
