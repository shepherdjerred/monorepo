import { describe, expect, test } from "vitest";
import { loadWeeklyParlaySubjects } from "#src/betting/weekly-parlay-subjects.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import {
  trackedPlayerFactory,
  usePlayerAccountCleanup,
} from "#src/testing/bucks-fixtures.ts";
import {
  testAccountId,
  testGuildId,
  testPuuid,
} from "#src/testing/test-ids.ts";

const { prisma } = createTestDatabase("weekly-parlay-subjects");
const SERVER_ID = testGuildId("701");
const OTHER_SERVER_ID = testGuildId("702");
const CREATOR_ID = testAccountId("701");
const CREATED_AT = new Date("2026-08-24T12:00:00.000Z");

const createPlayer = trackedPlayerFactory(prisma, CREATOR_ID, CREATED_AT);

usePlayerAccountCleanup(prisma);

describe("loadWeeklyParlaySubjects", () => {
  test("loads deterministic eligible subjects solely from database links", async () => {
    const firstDiscordId = testAccountId("711");
    const secondDiscordId = testAccountId("712");
    const firstPuuid = testPuuid("weekly-first");
    const secondPuuid = testPuuid("weekly-second");
    const thirdPuuid = testPuuid("weekly-third");
    const firstPlayerId = await createPlayer({
      alias: "first",
      serverId: SERVER_ID,
      discordId: firstDiscordId,
      accounts: [firstPuuid, secondPuuid],
    });
    await createPlayer({
      alias: "missing-discord",
      serverId: SERVER_ID,
      accounts: [testPuuid("missing-discord")],
    });
    await createPlayer({
      alias: "missing-account",
      serverId: SERVER_ID,
      discordId: testAccountId("713"),
      accounts: [],
    });
    await createPlayer({
      alias: "other-server",
      serverId: OTHER_SERVER_ID,
      discordId: testAccountId("714"),
      accounts: [testPuuid("other-server")],
    });
    const secondPlayerId = await createPlayer({
      alias: "second",
      serverId: SERVER_ID,
      discordId: secondDiscordId,
      accounts: [thirdPuuid],
    });

    await expect(loadWeeklyParlaySubjects(SERVER_ID, prisma)).resolves.toEqual([
      {
        key: "P1",
        playerId: firstPlayerId,
        alias: "first",
        discordId: firstDiscordId,
        accounts: [
          {
            puuid: firstPuuid,
            trackingStartedAt: CREATED_AT.toISOString(),
          },
          {
            puuid: secondPuuid,
            trackingStartedAt: new Date(
              CREATED_AT.getTime() + 60_000,
            ).toISOString(),
          },
        ],
      },
      {
        key: "P1",
        playerId: secondPlayerId,
        alias: "second",
        discordId: secondDiscordId,
        accounts: [
          {
            puuid: thirdPuuid,
            trackingStartedAt: CREATED_AT.toISOString(),
          },
        ],
      },
    ]);
  });
});
