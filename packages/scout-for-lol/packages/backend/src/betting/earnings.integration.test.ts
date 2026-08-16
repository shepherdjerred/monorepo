import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  LeaguePuuidSchema,
  RawMatchSchema,
  type DiscordAccountId,
  type DiscordGuildId,
  type RawMatch,
} from "@scout-for-lol/data/index.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { awardBucksForMatch } from "#src/betting/earnings.ts";
import { computeMvp } from "#src/betting/mvp.ts";
import {
  addFlagOverride,
  clearFlagOverrides,
  resetFlagOverrides,
} from "#src/configuration/flags.ts";
import { SEED_GRANT } from "#src/betting/constants.ts";

const { prisma: db } = createTestDatabase("bucks-earnings");

const fixture = RawMatchSchema.parse(
  await Bun.file(
    new URL("../../../../testdata/rift.json", import.meta.url),
  ).json(),
);

const CREATOR = DiscordAccountIdSchema.parse("160509172704739328");
const ENABLED_GUILD = DiscordGuildIdSchema.parse("1337623164146155593");
const DISABLED_GUILD = DiscordGuildIdSchema.parse("2337623164146155593");
const MATCH_ID = fixture.metadata.matchId;

const mvpPuuid = computeMvp(fixture.info.participants)?.puuid;
if (mvpPuuid === undefined) {
  throw new Error("the rift fixture should produce an MVP");
}

const mvpParticipant = fixture.info.participants.find(
  (p) => p.puuid === mvpPuuid,
);
/** A winner who is definitively not the MVP, so the award is exactly 2. */
const plainWinner = fixture.info.participants.find(
  (p) => p.win && p.puuid !== mvpPuuid,
);
/** A loser, so the award is exactly 1. */
const plainLoser = fixture.info.participants.find((p) => !p.win);

if (
  mvpParticipant === undefined ||
  plainWinner === undefined ||
  plainLoser === undefined
) {
  throw new Error("fixture should contain an MVP, another winner, and a loser");
}

async function trackPlayer(input: {
  serverId: DiscordGuildId;
  discordId: DiscordAccountId | null;
  alias: string;
  puuid: string;
}) {
  const now = new Date();
  await db.player.create({
    data: {
      alias: input.alias,
      discordId: input.discordId,
      serverId: input.serverId,
      creatorDiscordId: CREATOR,
      createdTime: now,
      updatedTime: now,
      accounts: {
        create: {
          alias: input.alias,
          puuid: LeaguePuuidSchema.parse(input.puuid),
          region: "AMERICA_NORTH",
          serverId: input.serverId,
          creatorDiscordId: CREATOR,
          createdTime: now,
          updatedTime: now,
        },
      },
    },
  });
}

async function clearAll() {
  await db.bucksLedgerEntry.deleteMany();
  await db.bucksMatchEarning.deleteMany();
  await db.bucksAccount.deleteMany();
  await db.account.deleteMany();
  await db.player.deleteMany();
}

function withQueue(queueId: number): RawMatch {
  return RawMatchSchema.parse({
    ...fixture,
    info: { ...fixture.info, queueId },
  });
}

function withDuration(seconds: number): RawMatch {
  return RawMatchSchema.parse({
    ...fixture,
    info: { ...fixture.info, gameDuration: seconds },
  });
}

beforeEach(async () => {
  await clearAll();
  clearFlagOverrides("betting_enabled");
  addFlagOverride("betting_enabled", true, { server: ENABLED_GUILD });
});

afterEach(() => {
  // Restore, don't just clear: the flag registry is process-wide, so leaving it
  // empty would switch Bryan Bucks off for every test file that runs later.
  resetFlagOverrides("betting_enabled");
});

afterAll(async () => {
  await clearAll();
  await db.$disconnect();
});

describe("awardBucksForMatch", () => {
  test("awards three Bucks for a win as MVP, as three separate rows", async () => {
    await trackPlayer({
      serverId: ENABLED_GUILD,
      discordId: DiscordAccountIdSchema.parse("16050917270473100"),
      alias: "mvp",
      puuid: mvpPuuid,
    });

    const awards = await awardBucksForMatch(fixture, db);
    expect(awards).toHaveLength(1);
    expect(awards[0]?.reasons.toSorted()).toEqual(
      mvpParticipant.win ? ["mvp", "played", "win"] : ["mvp", "played"],
    );

    const entries = await db.bucksLedgerEntry.findMany({
      where: { kind: { startsWith: "earn_" } },
      orderBy: { id: "asc" },
    });
    // Separate rows, because "how did they get these" is the requirement.
    expect(entries.map((e) => e.kind)).toEqual(
      mvpParticipant.win
        ? ["earn_game", "earn_win", "earn_mvp"]
        : ["earn_game", "earn_mvp"],
    );
    expect(entries.every((e) => e.delta === 1)).toBe(true);
    expect(entries.every((e) => e.matchId === MATCH_ID)).toBe(true);
  });

  test("awards two Bucks for a win that is not MVP", async () => {
    await trackPlayer({
      serverId: ENABLED_GUILD,
      discordId: DiscordAccountIdSchema.parse("16050917270473101"),
      alias: "winner",
      puuid: plainWinner.puuid,
    });

    const awards = await awardBucksForMatch(fixture, db);
    expect(awards[0]?.reasons).toEqual(["played", "win"]);
    expect(awards[0]?.total).toBe(2);

    const account = await db.bucksAccount.findFirstOrThrow();
    expect(account.balance).toBe(SEED_GRANT + 2);
  });

  test("awards one Buck for playing and losing", async () => {
    await trackPlayer({
      serverId: ENABLED_GUILD,
      discordId: DiscordAccountIdSchema.parse("16050917270473102"),
      alias: "loser",
      puuid: plainLoser.puuid,
    });

    const awards = await awardBucksForMatch(fixture, db);
    expect(awards[0]?.reasons).toEqual(["played"]);

    const account = await db.bucksAccount.findFirstOrThrow();
    expect(account.balance).toBe(SEED_GRANT + 1);
  });

  test("awarding the same match twice does not pay twice", async () => {
    // The regression guard for recoverMissedMatches and gap-detection replays.
    await trackPlayer({
      serverId: ENABLED_GUILD,
      discordId: DiscordAccountIdSchema.parse("16050917270473103"),
      alias: "winner",
      puuid: plainWinner.puuid,
    });

    await awardBucksForMatch(fixture, db);
    const second = await awardBucksForMatch(fixture, db);

    expect(second).toEqual([]);
    const account = await db.bucksAccount.findFirstOrThrow();
    expect(account.balance).toBe(SEED_GRANT + 2);
    expect(
      await db.bucksLedgerEntry.count({
        where: { kind: { startsWith: "earn_" } },
      }),
    ).toBe(2);
  });

  test("pays a player tracked in two enabled guilds once in each", async () => {
    addFlagOverride("betting_enabled", true, { server: DISABLED_GUILD });
    await trackPlayer({
      serverId: ENABLED_GUILD,
      discordId: DiscordAccountIdSchema.parse("16050917270473104"),
      alias: "winner",
      puuid: plainWinner.puuid,
    });
    await trackPlayer({
      serverId: DISABLED_GUILD,
      discordId: DiscordAccountIdSchema.parse("16050917270473104"),
      alias: "winner",
      puuid: plainWinner.puuid,
    });

    const awards = await awardBucksForMatch(fixture, db);
    expect(awards).toHaveLength(2);

    // Wallets are per guild, so this is two independent balances, not a
    // double payment into one.
    const accounts = await db.bucksAccount.findMany({ orderBy: { id: "asc" } });
    expect(accounts).toHaveLength(2);
    expect(accounts.map((a) => a.balance)).toEqual([
      SEED_GRANT + 2,
      SEED_GRANT + 2,
    ]);
  });

  test("pays nothing in a guild where betting is disabled", async () => {
    await trackPlayer({
      serverId: DISABLED_GUILD,
      discordId: DiscordAccountIdSchema.parse("16050917270473105"),
      alias: "winner",
      puuid: plainWinner.puuid,
    });

    expect(await awardBucksForMatch(fixture, db)).toEqual([]);
    expect(await db.bucksAccount.count()).toBe(0);
  });

  test("pays nothing to a player with no linked Discord account", async () => {
    await trackPlayer({
      serverId: ENABLED_GUILD,
      discordId: null,
      alias: "unlinked",
      puuid: plainWinner.puuid,
    });

    expect(await awardBucksForMatch(fixture, db)).toEqual([]);
    expect(await db.bucksAccount.count()).toBe(0);
  });

  test("pays nothing for a non-earning queue", async () => {
    await trackPlayer({
      serverId: ENABLED_GUILD,
      discordId: DiscordAccountIdSchema.parse("16050917270473106"),
      alias: "winner",
      puuid: plainWinner.puuid,
    });

    // 450 is ARAM: a real game, but deliberately outside the economy.
    expect(await awardBucksForMatch(withQueue(450), db)).toEqual([]);
    expect(await db.bucksMatchEarning.count()).toBe(0);
  });

  test("pays nothing for a remake", async () => {
    await trackPlayer({
      serverId: ENABLED_GUILD,
      discordId: DiscordAccountIdSchema.parse("16050917270473107"),
      alias: "winner",
      puuid: plainWinner.puuid,
    });

    expect(await awardBucksForMatch(withDuration(120), db)).toEqual([]);
    expect(await db.bucksMatchEarning.count()).toBe(0);
  });

  test("records the earning marker with a matching entry count", async () => {
    await trackPlayer({
      serverId: ENABLED_GUILD,
      discordId: DiscordAccountIdSchema.parse("16050917270473108"),
      alias: "winner",
      puuid: plainWinner.puuid,
    });
    await awardBucksForMatch(fixture, db);

    const marker = await db.bucksMatchEarning.findUniqueOrThrow({
      where: {
        matchId_serverId: { matchId: MATCH_ID, serverId: ENABLED_GUILD },
      },
    });
    expect(marker.entryCount).toBe(2);
    expect(
      await db.bucksLedgerEntry.count({
        where: { kind: { startsWith: "earn_" } },
      }),
    ).toBe(marker.entryCount);
  });
});
