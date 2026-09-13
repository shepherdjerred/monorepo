import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { MatchIdSchema } from "@scout-for-lol/data";
import { createTestDatabase } from "#src/testing/test-database.ts";
import {
  testAccountId,
  testGuildId,
  testPuuid,
} from "#src/testing/test-ids.ts";
import { advanceAccountCursor } from "#src/database/durable/account-cursor-repository.ts";

const { prisma } = createTestDatabase("durable-account-cursor");

afterAll(async () => {
  await prisma.$disconnect();
});

const PUUID = testPuuid("cursor-race");
const GUILD = testGuildId("7301");
const OWNER = testAccountId("7301");

const OLDER_MATCH = MatchIdSchema.parse("NA1_8001");
const NEWER_MATCH = MatchIdSchema.parse("NA1_8002");
const OLDER_AT = new Date("2026-09-12T09:00:00.000Z");
const NEWER_AT = new Date("2026-09-12T11:00:00.000Z");

async function seedAccount(): Promise<void> {
  await prisma.account.deleteMany({ where: { puuid: PUUID } });
  await prisma.player.deleteMany({ where: { serverId: GUILD } });
  const player = await prisma.player.create({
    data: {
      alias: "cursor-race",
      serverId: GUILD,
      creatorDiscordId: OWNER,
      createdTime: OLDER_AT,
      updatedTime: OLDER_AT,
    },
  });
  await prisma.account.create({
    data: {
      alias: "cursor-race",
      puuid: PUUID,
      region: "AMERICA_NORTH",
      playerId: player.id,
      serverId: GUILD,
      creatorDiscordId: OWNER,
      createdTime: OLDER_AT,
      updatedTime: OLDER_AT,
    },
  });
}

async function storedCursor(): Promise<{
  lastProcessedMatchId: string | null;
  lastMatchTime: Date | null;
}> {
  const account = await prisma.account.findFirstOrThrow({
    where: { puuid: PUUID },
    select: { lastProcessedMatchId: true, lastMatchTime: true },
  });
  return account;
}

beforeEach(seedAccount);

describe("advanceAccountCursor", () => {
  test("advances an account whose cursor has never been set", async () => {
    expect(
      await advanceAccountCursor(prisma, {
        puuid: PUUID,
        matchId: OLDER_MATCH,
        matchTime: OLDER_AT,
      }),
    ).toEqual({ outcome: "applied" });
    expect(await storedCursor()).toEqual({
      lastProcessedMatchId: OLDER_MATCH,
      lastMatchTime: OLDER_AT,
    });
  });

  test("refuses to rewind when an older match resumes after a newer one", async () => {
    // The V2 race this guard exists for: each match is its own Workflow, so a
    // retry of the OLDER match's cursor Activity can be scheduled after the
    // NEWER match already moved the same account.
    await advanceAccountCursor(prisma, {
      puuid: PUUID,
      matchId: NEWER_MATCH,
      matchTime: NEWER_AT,
    });

    const late = await advanceAccountCursor(prisma, {
      puuid: PUUID,
      matchId: OLDER_MATCH,
      matchTime: OLDER_AT,
    });

    // `already-applied`, not `conflict`: a newer cursor is progress, not two
    // producers disagreeing about this match.
    expect(late).toEqual({ outcome: "already-applied" });
    // The cursor is what `calculatePollingInterval` and `recoveryStartAt` read,
    // so a rewind here would re-open processed matches for re-ingestion and
    // re-announcement.
    expect(await storedCursor()).toEqual({
      lastProcessedMatchId: NEWER_MATCH,
      lastMatchTime: NEWER_AT,
    });
  });

  test("answers already-applied for a replay of the same match", async () => {
    await advanceAccountCursor(prisma, {
      puuid: PUUID,
      matchId: OLDER_MATCH,
      matchTime: OLDER_AT,
    });
    expect(
      await advanceAccountCursor(prisma, {
        puuid: PUUID,
        matchId: OLDER_MATCH,
        matchTime: OLDER_AT,
      }),
    ).toEqual({ outcome: "already-applied" });
  });

  test("still advances a puuid registered in more than one guild", async () => {
    const second = testGuildId("7302");
    const player = await prisma.player.create({
      data: {
        alias: "cursor-race-2",
        serverId: second,
        creatorDiscordId: OWNER,
        createdTime: OLDER_AT,
        updatedTime: OLDER_AT,
      },
    });
    await prisma.account.create({
      data: {
        alias: "cursor-race-2",
        puuid: PUUID,
        region: "AMERICA_NORTH",
        playerId: player.id,
        serverId: second,
        creatorDiscordId: OWNER,
        createdTime: OLDER_AT,
        updatedTime: OLDER_AT,
      },
    });

    expect(
      await advanceAccountCursor(prisma, {
        puuid: PUUID,
        matchId: NEWER_MATCH,
        matchTime: NEWER_AT,
      }),
    ).toEqual({ outcome: "applied" });
    const rows = await prisma.account.findMany({
      where: { puuid: PUUID },
      select: { lastMatchTime: true },
    });
    expect(rows.map((row) => row.lastMatchTime)).toEqual([NEWER_AT, NEWER_AT]);
    await prisma.account.deleteMany({ where: { serverId: second } });
    await prisma.player.deleteMany({ where: { serverId: second } });
  });
});
