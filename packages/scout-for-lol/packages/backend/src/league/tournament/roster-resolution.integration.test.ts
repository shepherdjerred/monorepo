import { afterAll, beforeEach, describe, expect, test } from "vitest";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  LeaguePuuidSchema,
  RegionSchema,
} from "@scout-for-lol/data/index.ts";
import {
  createTestDatabase,
  deleteIfExists,
} from "#src/testing/test-database.ts";
import { resolveLobbyRosters } from "#src/league/tournament/roster-resolution.ts";

const { prisma: testPrisma } = createTestDatabase("tournament-rosters");
const SERVER = DiscordGuildIdSchema.parse("1337623164146155593");
const CREATOR = DiscordAccountIdSchema.parse("160509172704739328");

function puuid(seed: string) {
  return LeaguePuuidSchema.parse(`puuid-${seed}`.padEnd(78, "0"));
}

async function trackPlayer(
  alias: string,
  options: { region?: string; withAccount?: boolean } = {},
) {
  const now = new Date();
  const player = await testPrisma.player.create({
    data: {
      alias,
      serverId: SERVER,
      creatorDiscordId: CREATOR,
      createdTime: now,
      updatedTime: now,
    },
  });
  if (options.withAccount !== false) {
    await testPrisma.account.create({
      data: {
        alias,
        puuid: puuid(alias),
        region: RegionSchema.parse(options.region ?? "AMERICA_NORTH"),
        playerId: player.id,
        serverId: SERVER,
        creatorDiscordId: CREATOR,
        createdTime: now,
        updatedTime: now,
      },
    });
  }
}

beforeEach(async () => {
  await deleteIfExists(() => testPrisma.account.deleteMany());
  await deleteIfExists(() => testPrisma.player.deleteMany());
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe("resolveLobbyRosters", () => {
  test("resolves tracked players on both sides", async () => {
    await trackPlayer("Blue");
    await trackPlayer("Red");

    const result = await resolveLobbyRosters(testPrisma, SERVER, "Blue", "Red");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.blue.puuids).toEqual([puuid("Blue")]);
    expect(result.red.puuids).toEqual([puuid("Red")]);
  });

  test("refuses an untracked player and names them", async () => {
    // This is what guarantees the post-match cursor picks the game up: the
    // per-player match-history poll is the only ingest path, so an untracked
    // lobby would produce a code, a game, and no report.
    await trackPlayer("Blue");

    const result = await resolveLobbyRosters(
      testPrisma,
      SERVER,
      "Blue",
      "Nobody",
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("Nobody");
    expect(result.reason).toContain("/track");
  });

  test("refuses a tracked player with no linked account", async () => {
    await trackPlayer("Blue");
    await trackPlayer("Accountless", { withAccount: false });

    const result = await resolveLobbyRosters(
      testPrisma,
      SERVER,
      "Blue",
      "Accountless",
    );

    expect(result.ok).toBe(false);
  });

  test("refuses uneven sides", async () => {
    await trackPlayer("Blue");
    await trackPlayer("BlueTwo");
    await trackPlayer("Red");

    const result = await resolveLobbyRosters(
      testPrisma,
      SERVER,
      "Blue, BlueTwo",
      "Red",
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Uneven is a legitimate outcome (someone dodges) but not a legitimate
    // intent, and Riot mints a code for one team size.
    expect(result.reason).toContain("same number");
  });

  test("refuses the same player on both sides", async () => {
    await trackPlayer("Blue");

    const result = await resolveLobbyRosters(
      testPrisma,
      SERVER,
      "Blue",
      "Blue",
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("twice");
  });

  test("refuses a mixed-region lobby", async () => {
    await trackPlayer("Blue", { region: "AMERICA_NORTH" });
    await trackPlayer("Red", { region: "EU_WEST" });

    const result = await resolveLobbyRosters(testPrisma, SERVER, "Blue", "Red");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("same region");
  });

  test("refuses more than five per side", async () => {
    const names = ["A", "B", "C", "D", "E", "F"];
    for (const name of names) await trackPlayer(name);

    const result = await resolveLobbyRosters(
      testPrisma,
      SERVER,
      names.join(","),
      names.join(","),
    );

    expect(result.ok).toBe(false);
  });
});
