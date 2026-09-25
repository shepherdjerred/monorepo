import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { z } from "zod";
import {
  ChallengeContractV1Schema,
  type DiscordAccountId,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import {
  createChallengeReadTools,
  progressSummary,
} from "#src/explore/tools/challenge-read-tools.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { testAccountId, testGuildId } from "#src/testing/test-ids.ts";
import {
  passthroughTracker as track,
  runExploreTool as run,
} from "#src/testing/explore-tool-runner.ts";

const { prisma } = createTestDatabase("explore-challenge-reads");
afterAll(async () => {
  await prisma.$disconnect();
});

const IN_SCOPE = testGuildId("711");
const OUT_OF_SCOPE = testGuildId("712");
const ALICE = testAccountId("711");
const BOB = testAccountId("712");
const CAROL = testAccountId("713");

async function member(
  discordId: DiscordAccountId,
  alias: string,
  serverId: DiscordGuildId,
) {
  await prisma.user.create({
    data: { discordId, discordUsername: alias.toLowerCase() },
  });
  await prisma.player.create({
    data: {
      alias,
      discordId,
      serverId,
      creatorDiscordId: discordId,
      createdTime: new Date(),
      updatedTime: new Date(),
    },
  });
}

function contract(title: string): string {
  return JSON.stringify(
    ChallengeContractV1Schema.parse({
      version: 1,
      evaluatorVersion: "challenge-evaluator-1",
      title,
      summary: `${title} summary`,
      explanation: ["Count completed wins."],
      matchPredicate: { kind: "result", result: "win" },
      progressGoal: { kind: "count", target: 2 },
    }),
  );
}

async function template(title: string) {
  const created = await prisma.challengeTemplate.create({
    data: { authorDiscordId: ALICE },
  });
  const version = await prisma.challengeTemplateVersion.create({
    data: {
      templateId: created.id,
      version: 1,
      title,
      summary: `${title} summary`,
      contractJson: contract(title),
      authorDiscordId: ALICE,
    },
  });
  return { templateId: created.id, versionId: version.id };
}

async function run_(
  owner: DiscordAccountId,
  ids: { templateId: string; versionId: string },
  runState: "active" | "completed",
) {
  await prisma.challengeRun.create({
    data: {
      ownerDiscordId: owner,
      templateId: ids.templateId,
      templateVersionId: ids.versionId,
      runState,
      originalStartAt: new Date("2026-09-01T00:00:00.000Z"),
      frozenContractJson: contract("frozen"),
      recomputing: false,
      completedAt:
        runState === "completed" ? new Date("2026-09-10T00:00:00.000Z") : null,
    },
  });
}

let wins = { templateId: "", versionId: "" };
let pentas = { templateId: "", versionId: "" };

beforeAll(async () => {
  await member(ALICE, "Alice", IN_SCOPE);
  await member(BOB, "Bob", IN_SCOPE);
  // Carol completes more than anyone, in a server the asker is not scoped to.
  await member(CAROL, "Carol", OUT_OF_SCOPE);
  wins = await template("Win ten games");
  pentas = await template("Land a pentakill");
  await run_(ALICE, wins, "completed");
  await run_(ALICE, pentas, "completed");
  await run_(BOB, wins, "completed");
  await run_(BOB, pentas, "active");
  for (let index = 0; index < 3; index++) {
    await run_(CAROL, wins, "completed");
  }
});

function tools(requesterId: DiscordAccountId) {
  return createChallengeReadTools({
    db: prisma,
    requesterId,
    guildIds: [IN_SCOPE],
    track,
  });
}

const LeaderboardSchema = z.array(
  z.object({ player: z.string(), completed: z.number() }),
);
const CatalogSchema = z.array(
  z.object({
    title: z.string(),
    startedInScope: z.number(),
    completedInScope: z.number(),
  }),
);

describe("challenge_leaderboard", () => {
  test("ranks only players registered in the servers in scope", async () => {
    const result = await run(tools(BOB).challenge_leaderboard.execute, {});
    // Carol's three completions are in another server and must not appear.
    expect(LeaderboardSchema.parse(result.data)).toEqual([
      { player: "Alice", completed: 2 },
      { player: "Bob", completed: 1 },
    ]);
  });
});

describe("list_challenge_catalog", () => {
  test("counts starts and completions from players in scope only", async () => {
    const result = await run(tools(BOB).list_challenge_catalog.execute, {});
    const byTitle = new Map(
      CatalogSchema.parse(result.data).map((entry) => [entry.title, entry]),
    );
    expect(byTitle.get("Win ten games")).toMatchObject({
      startedInScope: 2,
      completedInScope: 2,
    });
    expect(byTitle.get("Land a pentakill")).toMatchObject({
      startedInScope: 2,
      completedInScope: 1,
    });
  });
});

describe("list_my_challenge_runs", () => {
  test("returns the requester's own runs and nobody else's", async () => {
    const result = await run(tools(BOB).list_my_challenge_runs.execute, {});
    const runs = z
      .array(z.object({ title: z.string(), status: z.string() }))
      .parse(result.data);
    expect(runs.map((entry) => entry.status).toSorted()).toEqual([
      "active",
      "completed",
    ]);
  });
});

describe("progressSummary", () => {
  test("states a count goal as current of target", () => {
    expect(
      progressSummary({
        kind: "scalar",
        reducer: "count",
        current: 3,
        target: 10,
        completed: false,
      }),
    ).toBe("3 of 10");
  });

  test("summarises a boolean goal by conditions met, not the whole tree", () => {
    expect(
      progressSummary({
        kind: "boolean",
        operator: "all",
        completed: false,
        children: [
          {
            kind: "scalar",
            reducer: "count",
            current: 1,
            target: 1,
            completed: true,
          },
          {
            kind: "scalar",
            reducer: "count",
            current: 0,
            target: 2,
            completed: false,
          },
        ],
      }),
    ).toBe("1 of 2 conditions met (all required)");
  });
});
