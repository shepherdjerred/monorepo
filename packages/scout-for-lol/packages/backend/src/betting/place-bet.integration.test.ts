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
} from "@scout-for-lol/data/index.ts";
import {
  bucksTestPuuid,
  bucksTestRoster,
} from "#src/testing/bucks-fixtures.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { placeBet, type PlaceBetInput } from "#src/betting/place-bet.ts";
import { MAX_STAKE, SEED_GRANT } from "#src/betting/constants.ts";
import {
  addFlagOverride,
  clearFlagOverrides,
  resetFlagOverrides,
} from "#src/configuration/flags.ts";

const { prisma: db } = createTestDatabase("bucks-place-bet");

const SERVER_ID = DiscordGuildIdSchema.parse("1337623164146155593");
const BETTOR = DiscordAccountIdSchema.parse("160509172704739328");
const STRANGER = DiscordAccountIdSchema.parse("160509172704739399");
const MATCH_ID = "NA1_5000000001";

const SUBJECT_PUUID = bucksTestPuuid(0);
const ENEMY_PUUID = bucksTestPuuid(5);

/** Place a bet with the standard fixture values, overriding what the test
 * cares about. */
function bet(overrides: Partial<PlaceBetInput> = {}) {
  return placeBet(
    {
      matchId: MATCH_ID,
      serverId: SERVER_ID,
      discordId: BETTOR,
      subjectPuuid: SUBJECT_PUUID,
      subjectWins: true,
      stake: 1,
      ...overrides,
    },
    db,
  );
}

async function clearAll() {
  await db.bucksLedgerEntry.deleteMany();
  await db.bucksBet.deleteMany();
  await db.bucksMatchPool.deleteMany();
  await db.bucksAccount.deleteMany();
  await db.player.deleteMany();
}

async function countLedger(kind: string) {
  return await db.bucksLedgerEntry.count({ where: { kind } });
}

/** The refusal reason alone, for the many tests that assert only that. */
async function betKind(overrides: Partial<PlaceBetInput> = {}) {
  const result = await bet(overrides);
  return result.kind;
}

beforeEach(async () => {
  await clearAll();
  // This suite's fixture guild is not the one in the registry, so the allowlist
  // has to be pointed at it explicitly.
  clearFlagOverrides("betting_enabled");
  addFlagOverride("betting_enabled", true, { server: SERVER_ID });
  const now = new Date();
  await db.player.create({
    data: {
      alias: "jerred",
      discordId: BETTOR,
      serverId: SERVER_ID,
      creatorDiscordId: BETTOR,
      createdTime: now,
      updatedTime: now,
    },
  });
  await db.bucksMatchPool.create({
    data: {
      matchId: MATCH_ID,
      serverId: SERVER_ID,
      detectedAt: new Date(Date.now() - 60_000),
      closesAt: new Date(Date.now() + 5 * 60_000),
      queueType: "solo",
      roster: JSON.stringify({ participants: bucksTestRoster() }),
    },
  });
});

afterEach(() => {
  // Restore rather than clear: the flag registry is process-wide.
  resetFlagOverrides("betting_enabled");
});

afterAll(async () => {
  await clearAll();
  await db.$disconnect();
});

describe("placeBet — accepting a position", () => {
  test("debits the stake, records one ledger row, and seeds the wallet", async () => {
    const result = await bet({ stake: 5 });

    if (result.kind !== "placed") {
      throw new Error(`expected the bet to be placed, got ${result.kind}`);
    }
    expect(result.totalStake).toBe(5);
    expect(result.balanceAfter).toBe(SEED_GRANT - 5);
    expect(result.side).toBe(100);

    const bets = await db.bucksBet.findMany();
    expect(bets).toHaveLength(1);
    expect(bets[0]?.predictedTeamId).toBe(100);

    // One seed row plus one stake row, and nothing else.
    const entries = await db.bucksLedgerEntry.findMany({
      orderBy: { id: "asc" },
    });
    expect(entries.map((e) => e.kind)).toEqual(["seed", "bet_stake"]);
    expect(entries[1]?.delta).toBe(-5);
    expect(entries[1]?.balanceAfter).toBe(SEED_GRANT - 5);
  });

  test("betting a loss resolves to the opposing team", async () => {
    const result = await bet({ subjectWins: false });
    if (result.kind !== "placed") {
      throw new Error("expected the bet to be placed");
    }
    // The subject is on team 100, so "Jerred loses" is a position on team 200.
    expect(result.side).toBe(200);
  });

  test("betting the same side again increments the position", async () => {
    await bet({ stake: 1 });
    const second = await bet({ stake: 5 });

    if (second.kind !== "placed") {
      throw new Error("expected the second bet to be placed");
    }
    expect(second.totalStake).toBe(6);
    expect(second.balanceAfter).toBe(SEED_GRANT - 6);

    expect(await db.bucksBet.count()).toBe(1);
    // Each increment gets its own ledger row, so the history stays readable.
    expect(await countLedger("bet_stake")).toBe(2);
  });

  test("the ledger explains the bet without re-deriving it", async () => {
    await bet({ subjectWins: false, stake: 3 });

    const entry = await db.bucksLedgerEntry.findFirstOrThrow({
      where: { kind: "bet_stake" },
    });
    expect(entry.matchId).toBe(MATCH_ID);
    expect(entry.predictedTeamId).toBe(200);
    // Unknown at bet time, and the column says so rather than guessing.
    expect(entry.actualWinningTeamId).toBeNull();

    const context: unknown = JSON.parse(entry.context);
    expect(context).toMatchObject({
      type: "stake",
      subjectAlias: "jerred",
      backedAliases: ["bryan"],
      opposingAliases: ["jerred"],
    });
  });
});

describe("placeBet — refusing a position", () => {
  test("refuses the opposing side and leaves the balance untouched", async () => {
    await bet({ stake: 5 });
    const conflict = await bet({ subjectPuuid: ENEMY_PUUID, stake: 5 });

    expect(conflict.kind).toBe("side_conflict");

    // The rollback is the point: a refused hedge must not have charged anything.
    const account = await db.bucksAccount.findFirstOrThrow();
    expect(account.balance).toBe(SEED_GRANT - 5);
    expect(await countLedger("bet_stake")).toBe(1);
  });

  test("refuses a bet after the window closes", async () => {
    await db.bucksMatchPool.updateMany({
      data: { closesAt: new Date(Date.now() - 1000) },
    });

    expect(await betKind()).toBe("window_closed");
    expect(await db.bucksBet.count()).toBe(0);
  });

  test("refuses a bet on a pool that is no longer open", async () => {
    await db.bucksMatchPool.updateMany({ data: { poolState: "settled" } });
    expect(await betKind()).toBe("window_closed");
  });

  test("refuses a Discord user with no linked player in this guild", async () => {
    expect(await betKind({ discordId: STRANGER })).toBe("not_eligible");
    // No wallet should have been created for an ineligible user.
    expect(await db.bucksAccount.count()).toBe(0);
  });

  test("refuses a subject who is not in this game", async () => {
    const result = await bet({ subjectPuuid: bucksTestPuuid(42) });
    if (result.kind !== "unknown_subject") {
      throw new Error("expected an unknown subject");
    }
    expect(result.validAliases.toSorted()).toEqual(["bryan", "jerred"]);
  });

  test("refuses a stake the wallet cannot cover", async () => {
    expect(await betKind({ stake: SEED_GRANT + 1 })).toBe("insufficient");
    expect(await db.bucksBet.count()).toBe(0);

    const account = await db.bucksAccount.findFirstOrThrow();
    expect(account.balance).toBe(SEED_GRANT);
  });

  test("refuses a stake outside the allowed range", async () => {
    for (const stake of [0, -5, 1_000_000, 1.5]) {
      expect(await betKind({ stake })).toBe("invalid_stake");
    }
    expect(await db.bucksBet.count()).toBe(0);
  });

  test("refuses a top-up that would take the position past MAX_STAKE", async () => {
    await bet({ stake: 1 });
    // Fund the wallet well past the cap so the refusal below can only be the
    // cap: a per-position bound that only holds while you are too poor to
    // exceed it is not a bound.
    await db.bucksAccount.updateMany({ data: { balance: 10 * MAX_STAKE } });

    const result = await bet({ stake: MAX_STAKE });
    if (result.kind !== "stake_cap") {
      throw new Error(`expected the cap to refuse it, got ${result.kind}`);
    }
    expect(result.existingStake).toBe(1);
    expect(result.max).toBe(MAX_STAKE);

    // Nothing charged, and the position is exactly as it was.
    const account = await db.bucksAccount.findFirstOrThrow();
    expect(account.balance).toBe(10 * MAX_STAKE);
    const position = await db.bucksBet.findFirstOrThrow();
    expect(position.stake).toBe(1);
    expect(await countLedger("bet_stake")).toBe(1);
  });

  test("allows a top-up that lands exactly on MAX_STAKE", async () => {
    await bet({ stake: 1 });
    await db.bucksAccount.updateMany({ data: { balance: 10 * MAX_STAKE } });

    const result = await bet({ stake: MAX_STAKE - 1 });
    if (result.kind !== "placed") {
      throw new Error(`expected the bet to be placed, got ${result.kind}`);
    }
    expect(result.totalStake).toBe(MAX_STAKE);
  });

  test("refuses a bet in a guild with no pool", async () => {
    const other = DiscordGuildIdSchema.parse("999999999999999999");
    addFlagOverride("betting_enabled", true, { server: other });
    expect(await betKind({ serverId: other })).toBe("no_pool");
  });

  test("refuses a bet once the guild leaves the allowlist", async () => {
    // The pool still exists — removing the flag must stop it taking new stakes
    // rather than relying on the pool disappearing.
    clearFlagOverrides("betting_enabled");

    expect(await betKind({ stake: 5 })).toBe("feature_disabled");
    expect(await db.bucksBet.count()).toBe(0);
    expect(await db.bucksAccount.count()).toBe(0);
  });
});

describe("placeBet — concurrency", () => {
  test("concurrent clicks cannot overdraw the wallet", async () => {
    // Two clicks that each fit the balance alone but not together. Exactly one
    // must win: this is the double-spend guard, and it is the reason the
    // affordability check is a single guarded UPDATE rather than a read
    // followed by a write.
    const stake = SEED_GRANT - 1;
    const results = await Promise.all([bet({ stake }), bet({ stake })]);

    expect(results.filter((r) => r.kind === "placed")).toHaveLength(1);
    expect(results.filter((r) => r.kind === "insufficient")).toHaveLength(1);

    const account = await db.bucksAccount.findFirstOrThrow();
    expect(account.balance).toBe(SEED_GRANT - stake);
    expect(account.balance).toBeGreaterThanOrEqual(0);

    expect(await db.bucksBet.count()).toBe(1);
    expect(await countLedger("bet_stake")).toBe(1);
  });

  test("a racing first bet seeds exactly one wallet", async () => {
    // Both clicks find no wallet and try to create one; the unique constraint
    // must collapse that into a single seed grant rather than granting twice.
    await Promise.all([bet({ stake: 1 }), bet({ stake: 1 })]);

    expect(await db.bucksAccount.count()).toBe(1);
    expect(await countLedger("seed")).toBe(1);

    const account = await db.bucksAccount.findFirstOrThrow();
    expect(account.balance).toBe(SEED_GRANT - 2);
  });
});
