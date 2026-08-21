import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
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
import {
  awardBucksForMatch,
  type EarnedAwardReason,
} from "#src/betting/earnings.ts";
import { retryPendingBucksEarnings } from "#src/betting/earnings-retry.ts";
import { computeMvp } from "#src/betting/mvp.ts";
import {
  addFlagOverride,
  clearFlagOverrides,
  resetFlagOverrides,
} from "#src/configuration/flags.ts";
import {
  HOUSE_ACCOUNT_DISCORD_ID,
  HOUSE_BANKROLL,
  SEED_GRANT,
} from "#src/betting/constants.ts";
import { ensureBucksAccount } from "#src/betting/accounts.ts";

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

const plainLoserPuuid = plainLoser.puuid;

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

async function assertRanked5sParticipationBonus() {
  await trackPlayer({
    serverId: ENABLED_GUILD,
    discordId: DiscordAccountIdSchema.parse("16050917270473109"),
    alias: "ranked-5s-player",
    puuid: plainLoserPuuid,
  });

  const awards = await awardBucksForMatch(withQueue(710), db);
  expect(awards[0]?.reasons).toEqual(["played", "ranked 5s bonus"]);
  expect(awards[0]?.total).toBe(2);

  const entries = await db.bucksLedgerEntry.findMany({
    where: { kind: { startsWith: "earn_" } },
    orderBy: { id: "asc" },
  });
  expect(entries.map((entry) => entry.kind)).toEqual([
    "earn_game",
    "earn_ranked_5s_bonus",
  ]);
  expect(entries.map((entry) => entry.delta)).toEqual([1, 1]);

  const account = await db.bucksAccount.findFirstOrThrow({
    where: { isHouse: false },
  });
  expect(account.balance).toBe(SEED_GRANT + 2);
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

  test("awards the normal Bucks for League Classic", async () => {
    await trackPlayer({
      serverId: ENABLED_GUILD,
      discordId: DiscordAccountIdSchema.parse("16050917270473910"),
      alias: "classic-mvp",
      puuid: mvpPuuid,
    });

    const awards = await awardBucksForMatch(withQueue(4310), db);

    expect(awards[0]?.reasons.toSorted()).toEqual(
      mvpParticipant.win ? ["mvp", "played", "win"] : ["mvp", "played"],
    );
    expect(awards[0]?.total).toBe(mvpParticipant.win ? 3 : 2);
    const account = await db.bucksAccount.findFirstOrThrow({
      where: { isHouse: false },
    });
    expect(account.balance).toBe(SEED_GRANT + (mvpParticipant.win ? 3 : 2));
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

    const account = await db.bucksAccount.findFirstOrThrow({
      where: { isHouse: false },
    });
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

    const account = await db.bucksAccount.findFirstOrThrow({
      where: { isHouse: false },
    });
    expect(account.balance).toBe(SEED_GRANT + 1);
  });

  test(
    "awards the Ranked 5s participation bonus as a distinct ledger row",
    assertRanked5sParticipationBonus,
  );
});

describe("awardBucksForMatch additional cases", () => {
  test("stacks the Clash bonus with the win and MVP rewards", async () => {
    await trackPlayer({
      serverId: ENABLED_GUILD,
      discordId: DiscordAccountIdSchema.parse("16050917270473110"),
      alias: "clash-mvp",
      puuid: mvpPuuid,
    });

    const awards = await awardBucksForMatch(withQueue(700), db);
    const expectedReasons: EarnedAwardReason[] = ["played", "clash bonus"];
    if (mvpParticipant.win) {
      expectedReasons.push("win");
    }
    expectedReasons.push("mvp");

    expect(awards[0]?.reasons).toEqual(expectedReasons);
    expect(awards[0]?.total).toBe(12 + (mvpParticipant.win ? 1 : 0));

    const entries = await db.bucksLedgerEntry.findMany({
      where: { kind: { startsWith: "earn_" } },
      orderBy: { id: "asc" },
    });
    const expectedKinds = ["earn_game", "earn_clash_bonus"];
    const expectedDeltas = [1, 10];
    if (mvpParticipant.win) {
      expectedKinds.push("earn_win");
      expectedDeltas.push(1);
    }
    expectedKinds.push("earn_mvp");
    expectedDeltas.push(1);
    expect(entries.map((entry) => entry.kind)).toEqual(expectedKinds);
    expect(entries.map((entry) => entry.delta)).toEqual(expectedDeltas);

    const account = await db.bucksAccount.findFirstOrThrow({
      where: { isHouse: false },
    });
    expect(account.balance).toBe(
      SEED_GRANT + 12 + (mvpParticipant.win ? 1 : 0),
    );
  });

  test("awarding the same match twice does not pay twice", async () => {
    // The regression guard for recoverMissedMatches and gap-detection replays.
    await trackPlayer({
      serverId: ENABLED_GUILD,
      discordId: DiscordAccountIdSchema.parse("16050917270473103"),
      alias: "winner",
      puuid: plainWinner.puuid,
    });

    const clashMatch = withQueue(700);
    await awardBucksForMatch(clashMatch, db);
    const second = await awardBucksForMatch(clashMatch, db);

    expect(second).toEqual([]);
    const account = await db.bucksAccount.findFirstOrThrow({
      where: { isHouse: false },
    });
    expect(account.balance).toBe(SEED_GRANT + 12);
    expect(
      await db.bucksLedgerEntry.count({
        where: { kind: { startsWith: "earn_" } },
      }),
    ).toBe(3);
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
    const accounts = await db.bucksAccount.findMany({
      where: { isHouse: false },
      orderBy: { id: "asc" },
    });
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

  test("pays nothing for Classic ARAM Mayhem", async () => {
    await trackPlayer({
      serverId: ENABLED_GUILD,
      discordId: DiscordAccountIdSchema.parse("16050917270473911"),
      alias: "classic-mayhem",
      puuid: plainWinner.puuid,
    });

    expect(await awardBucksForMatch(withQueue(2450), db)).toEqual([]);
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

describe("earning retry", () => {
  test("retains an exhausted-house earning for a later retry", async () => {
    const seeded = await ensureBucksAccount(
      {
        serverId: ENABLED_GUILD,
        discordId: DiscordAccountIdSchema.parse("16050917270473110"),
      },
      db,
    );
    const house = await db.bucksAccount.findUniqueOrThrow({
      where: {
        serverId_discordId: {
          serverId: ENABLED_GUILD,
          discordId: HOUSE_ACCOUNT_DISCORD_ID,
        },
      },
    });
    await db.bucksAccount.delete({ where: { id: seeded.id } });
    await db.bucksAccount.update({
      where: { id: house.id },
      data: { balance: 0 },
    });
    await trackPlayer({
      serverId: ENABLED_GUILD,
      discordId: DiscordAccountIdSchema.parse("16050917270473111"),
      alias: "retry-player",
      puuid: plainWinner.puuid,
    });

    expect(await awardBucksForMatch(fixture, db)).toEqual([]);
    const pending = await db.bucksMatchEarning.findUniqueOrThrow({
      where: {
        matchId_serverId: { matchId: MATCH_ID, serverId: ENABLED_GUILD },
      },
    });
    expect(pending.state).toBe("pending");
    expect(pending.entryCount).toBe(0);

    await db.bucksAccount.update({
      where: { id: house.id },
      data: { balance: HOUSE_BANKROLL },
    });
    await db.bucksMatchEarning.update({
      where: {
        matchId_serverId: { matchId: MATCH_ID, serverId: ENABLED_GUILD },
      },
      data: { retryAt: new Date(0) },
    });
    let loadedMatchId: string | undefined;
    await retryPendingBucksEarnings(db, async (matchId) => {
      loadedMatchId = matchId;
      return fixture;
    });
    expect(loadedMatchId).toBe(MATCH_ID);
    const awards = await db.bucksLedgerEntry.findMany({
      where: { kind: { startsWith: "earn_" } },
    });
    expect(awards).toHaveLength(2);

    const completed = await db.bucksMatchEarning.findUniqueOrThrow({
      where: {
        matchId_serverId: { matchId: MATCH_ID, serverId: ENABLED_GUILD },
      },
    });
    expect(completed.state).toBe("complete");
    expect(completed.entryCount).toBe(2);
  });

  test("normal replays keep the original recipient snapshot", async () => {
    const originalDiscordId = DiscordAccountIdSchema.parse("16050917270473111");
    const replacementDiscordId =
      DiscordAccountIdSchema.parse("16050917270473112");
    const seeded = await ensureBucksAccount(
      { serverId: ENABLED_GUILD, discordId: originalDiscordId },
      db,
    );
    const house = await db.bucksAccount.findUniqueOrThrow({
      where: {
        serverId_discordId: {
          serverId: ENABLED_GUILD,
          discordId: HOUSE_ACCOUNT_DISCORD_ID,
        },
      },
    });
    await db.bucksAccount.delete({ where: { id: seeded.id } });
    await db.bucksAccount.update({
      where: { id: house.id },
      data: { balance: 0 },
    });
    await trackPlayer({
      serverId: ENABLED_GUILD,
      discordId: originalDiscordId,
      alias: "retry-player",
      puuid: plainWinner.puuid,
    });

    expect(await awardBucksForMatch(fixture, db)).toEqual([]);
    const player = await db.player.findFirstOrThrow({
      where: { alias: "retry-player" },
    });
    await db.player.update({
      where: { id: player.id },
      data: { discordId: replacementDiscordId },
    });
    await db.bucksAccount.update({
      where: { id: house.id },
      data: { balance: HOUSE_BANKROLL },
    });

    const awards = await awardBucksForMatch(fixture, db);
    expect(awards).toHaveLength(1);
    expect(awards[0]?.discordId).toBe(originalDiscordId);
    expect(
      await db.bucksAccount.findUnique({
        where: {
          serverId_discordId: {
            serverId: ENABLED_GUILD,
            discordId: replacementDiscordId,
          },
        },
      }),
    ).toBeNull();
    expect(
      await db.bucksAccount.findUniqueOrThrow({
        where: {
          serverId_discordId: {
            serverId: ENABLED_GUILD,
            discordId: originalDiscordId,
          },
        },
      }),
    ).toMatchObject({ balance: SEED_GRANT + 2 });
  });
});
