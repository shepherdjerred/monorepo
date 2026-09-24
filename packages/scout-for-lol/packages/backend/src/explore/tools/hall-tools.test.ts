import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { z } from "zod";
import {
  addFlagOverride,
  clearFlagOverrides,
  resetFlagOverrides,
} from "#src/configuration/flags.ts";
import {
  createHallExploreTools,
  resolveHallCapability,
} from "#src/explore/tools/hall-tools.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { testGuildId, testPuuid } from "#src/testing/test-ids.ts";
import {
  passthroughTracker as track,
  runExploreTool as run,
} from "#src/testing/explore-tool-runner.ts";

const { prisma } = createTestDatabase("explore-hall-reads");
afterAll(async () => {
  await prisma.$disconnect();
});

const HALL_GUILD = testGuildId("721");
const OTHER_GUILD = testGuildId("722");

const holder = {
  playerId: 1,
  playerAlias: "Alice",
  accountId: 1,
  accountAlias: "AliceSmurf",
  puuid: testPuuid("hall-alice"),
};

beforeAll(async () => {
  await prisma.hallSettings.create({
    data: {
      guildId: HALL_GUILD,
      catalogVersion: 1,
      enabledQueueFamilies: JSON.stringify(["ranked_sr", "aram"]),
      enabledRecords: JSON.stringify(["kills", "vision_score"]),
      updatedByDiscordId: "210000000000000000",
    },
  });
  await prisma.hallRecordCell.create({
    data: {
      guildId: HALL_GUILD,
      queueFamilyId: "ranked_sr",
      recordId: "kills",
      baselineStatus: "ready",
      baselineRevision: 1,
      currentValue: 24,
      holdersJson: JSON.stringify([holder]),
      evidenceJson: JSON.stringify([
        {
          matchId: "NA1_1",
          gameEndAt: "2026-09-01T00:00:00.000Z",
          value: 24,
          holder,
        },
      ]),
    },
  });
  await prisma.hallRecordCell.create({
    data: {
      guildId: HALL_GUILD,
      queueFamilyId: "aram",
      recordId: "vision_score",
      baselineStatus: "building",
      baselineRevision: 1,
    },
  });
});

const GuildsSchema = z.array(
  z.object({
    enabledQueueFamilies: z.array(z.string()),
    cells: z.array(
      z.object({
        queueFamily: z.string(),
        record: z.string(),
        status: z.string(),
        value: z.number().nullable(),
        holders: z.array(z.string()),
      }),
    ),
  }),
);

function tools() {
  return createHallExploreTools({
    db: prisma,
    capability: { guildIds: [HALL_GUILD] },
    track,
  });
}

describe("get_hall_of_fame", () => {
  test("reads the board with catalog labels and the holder's names", async () => {
    const result = await run(tools().get_hall_of_fame.execute, {});
    const [guild] = GuildsSchema.parse(result.data);
    expect(guild?.enabledQueueFamilies).toEqual([
      "Ranked Summoner's Rift",
      "ARAM",
    ]);
    expect(guild?.cells).toContainEqual({
      queueFamily: "Ranked Summoner's Rift",
      record: "Most kills",
      status: "ready",
      value: 24,
      holders: ["Alice (AliceSmurf)"],
    });
  });

  test("a board still building is reported as building, not as empty", async () => {
    const result = await run(tools().get_hall_of_fame.execute, {});
    expect(result.message).toContain("still being built");
    const [guild] = GuildsSchema.parse(result.data);
    expect(guild?.cells).toContainEqual(
      expect.objectContaining({
        record: "Highest vision score",
        status: "building",
      }),
    );
  });

  test("filters to one queue family", async () => {
    const result = await run(tools().get_hall_of_fame.execute, {
      queueFamily: "aram",
    });
    const [guild] = GuildsSchema.parse(result.data);
    expect(guild?.cells.map((cell) => cell.queueFamily)).toEqual(["ARAM"]);
  });

  test("a server without the Hall has no board to read", async () => {
    const result = await run(tools().get_hall_of_fame.execute, {
      guildId: OTHER_GUILD,
    });
    expect(result.data).toEqual([]);
    expect(result.message).toContain("does not have the Hall of Fame");
  });
});

describe("resolveHallCapability", () => {
  afterEach(() => {
    resetFlagOverrides("hall_of_fame_enabled");
  });

  test("keeps only the servers whose Hall is switched on", async () => {
    clearFlagOverrides("hall_of_fame_enabled");
    addFlagOverride("hall_of_fame_enabled", true, { server: HALL_GUILD });
    await expect(
      resolveHallCapability([HALL_GUILD, OTHER_GUILD]),
    ).resolves.toEqual({ guildIds: [HALL_GUILD] });
  });

  test("is null when no server in scope has it", async () => {
    clearFlagOverrides("hall_of_fame_enabled");
    await expect(resolveHallCapability([OTHER_GUILD])).resolves.toBeNull();
  });
});
