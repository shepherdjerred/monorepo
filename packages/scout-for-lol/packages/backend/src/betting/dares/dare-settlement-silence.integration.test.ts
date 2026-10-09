import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  DareContractSchema,
  type DareContract,
  type RawMatch,
  DiscordAccountIdSchema,
  PlayerIdSchema,
} from "@scout-for-lol/data";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { testChannelId, testGuildId } from "#src/testing/test-ids.ts";
import {
  dareSqlContractCore,
  loadRiftFixture,
  targetMatchAt,
} from "#src/betting/dares/dare-test-fixtures.ts";

/**
 * The Dare settlement silence gate's WIRING.
 *
 * Dares cannot run in production — the whole Bryan Bucks surface is
 * hard-disabled there ahead of Flipt — but in beta they are one operator
 * toggle away, and they deliver to individuals by DM. What is worth proving is
 * not the logic, but that the disposition the settlement was handed REACHES
 * this writer at all.
 *
 * So the contract's SQL evidence machinery is stubbed and everything from
 * the capture entry down is real. The Dare resolves UNACHIEVED with an empty
 * pot, which is what lets this exercise the notify branch without a funded
 * wallet: the refund path has nothing to move, and an achieved Dare would
 * need a proof and a payout that prove nothing about the wiring.
 */

const { prisma: db } = createTestDatabase("bucks-dare-settlement-silence");
const SERVER = testGuildId("931");
const CHANNEL = testChannelId("932");
const HASH = "b".repeat(64);
const TARGET_PUUID =
  "virmel-puuid000000000000000000000000000000000000000000000000000000000000000000";
const T0 = new Date("2026-09-01T12:00:00.000Z");
const MATCH_ID = RiotMatchIdSchema.parse("NA1_7100000001");

// Every execution resolves the Dare unachieved on this match: the one-game
// cap is reached.
vi.mock("#src/betting/dares/sql/dare-sql.ts", async () => {
  const { finalUnachievedDareSqlModule } =
    await import("#src/betting/dares/dare-test-fixtures.ts");
  return finalUnachievedDareSqlModule({
    matchId: MATCH_ID,
    queryHash: HASH,
  });
});

const { captureDareSqlForMatch } =
  await import("#src/betting/dares/settlement/dare-settle-contract.ts");

function contract(): DareContract {
  return DareContractSchema.parse({
    ...dareSqlContractCore({ queryHash: HASH, maxEligibleGames: 1 }),
    activation: { kind: "immediate" },
    activationSnapshot: null,
    originalText: "I bet Virmel cannot do it",
    plainLanguage: "Virmel cannot do it",
    targets: [
      {
        key: "T1",
        discordId: "100000000000000931",
        playerId: 1,
        alias: "Virmel",
        accounts: [
          {
            puuid: TARGET_PUUID,
            trackingStartedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      },
    ],
    openingStake: 5,
    serverId: SERVER,
    channelId: CHANNEL,
    revision: 1,
    activationAt: T0.toISOString(),
    deadlineAt: new Date(T0.getTime() + 7 * 86_400_000).toISOString(),
    deadlineSpec: { kind: "relative", days: 7 },
  });
}

beforeEach(async () => {
  await db.bucksDareNotificationEvent.deleteMany();
  await db.bucksDareEvidence.deleteMany();
  await db.bucksDareTarget.deleteMany();
  await db.bucksDare.deleteMany();
});

/** An active Dare with an empty pot and one target. */
async function activeDare() {
  const parsed = contract();
  const created = await db.bucksDare.create({
    data: {
      serverId: SERVER,
      channelId: CHANNEL,
      challengerDiscordId: "100000000000000930",
      dareState: "active",
      currentRevision: 1,
      fundedRevision: 1,
      contractJson: JSON.stringify(parsed),
      openingStake: 5,
      potTotal: 0,
      activatedAt: T0,
      deadlineAt: new Date(T0.getTime() + 7 * 86_400_000),
      targets: {
        create: [
          {
            targetKey: "T1",
            discordId: DiscordAccountIdSchema.parse("100000000000000931"),
            playerId: PlayerIdSchema.parse(1),
            alias: "Virmel",
            accounts: JSON.stringify(parsed.targets[0]?.accounts ?? []),
            acceptedAt: T0,
          },
        ],
      },
    },
    include: { targets: true },
  });
  return { dare: created, contract: parsed };
}

async function qualifyingMatch(): Promise<RawMatch> {
  return targetMatchAt(
    await loadRiftFixture(),
    MATCH_ID,
    new Date(T0.getTime() + 60 * 60 * 1000),
    10,
  );
}

describe("the Dare settlement notification gate", () => {
  test("writes no outbox row when the match is owed no public delivery", async () => {
    const { dare, contract: parsed } = await activeDare();

    await captureDareSqlForMatch({
      dare,
      contract: parsed,
      matchData: await qualifyingMatch(),
      prismaClient: db,
      now: new Date(T0.getTime() + 2 * 60 * 60 * 1000),
      notify: "withhold",
    });

    expect(
      await db.matchNotificationIntent.findMany({
        where: { subjectKind: "dare", subjectId: dare.id.toString() },
      }),
    ).toEqual([]);
    // And the callout it would have posted is retired with the settlement.
    expect(
      await db.bucksDare.findUniqueOrThrow({
        where: { id: dare.id },
        select: { calloutRefreshPending: true },
      }),
    ).toEqual({ calloutRefreshPending: false });
  });

  test("writes one when the match is owed one", async () => {
    const { dare, contract: parsed } = await activeDare();

    await captureDareSqlForMatch({
      dare,
      contract: parsed,
      matchData: await qualifyingMatch(),
      prismaClient: db,
      now: new Date(T0.getTime() + 2 * 60 * 60 * 1000),
      notify: "enqueue",
    });

    expect(
      await db.matchNotificationIntent.findMany({
        where: { subjectKind: "dare", subjectId: dare.id.toString() },
      }),
    ).not.toEqual([]);
  });
});
