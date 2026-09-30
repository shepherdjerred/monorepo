import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  DareContractV3Schema,
  DareSqlV3EvidenceSchema,
  RawMatchSchema,
  type DareContractV3,
  type DareSqlV3Evidence,
  type RawMatch,
} from "@scout-for-lol/data";
import { DiscordAccountIdSchema, PlayerIdSchema } from "@scout-for-lol/data";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { testChannelId, testGuildId } from "#src/testing/test-ids.ts";
import {
  dareSqlV3ContractCore,
  makeTwistedFateMatch,
} from "#src/betting/dares/dare-v2-test-fixtures.ts";

/**
 * The version-3 silence gate's WIRING.
 *
 * Version 3 cannot run in production — the whole Bryan Bucks surface is
 * hard-disabled there ahead of Flipt, and version 3 needs two further flags
 * besides — but in beta it is one operator toggle away, and it delivers to
 * individuals by DM. What is worth proving is not the logic, which is the
 * same branch the version-2 settler uses fed by the same decision, but that
 * the decision REACHES this writer at all.
 *
 * So the contract's SQL evidence machinery is stubbed and everything from
 * the capture entry down is real. The Dare resolves UNACHIEVED with an empty
 * pot, which is what lets this exercise the notify branch without a funded
 * wallet: the refund path has nothing to move, and an achieved Dare would
 * need a proof and a payout that prove nothing about the wiring.
 */

const { prisma: db } = createTestDatabase("bucks-dare-v3-silence");
const SERVER = testGuildId("931");
const CHANNEL = testChannelId("932");
const HASH = "b".repeat(64);
const TARGET_PUUID = "virmel-puuid";
const T0 = new Date("2026-09-01T12:00:00.000Z");
const MATCH_ID = "NA1_7100000001";

const evidence: DareSqlV3Evidence = DareSqlV3EvidenceSchema.parse({
  // Unachieved AND final: the game cap is reached, so the contract resolves
  // on this match rather than waiting for its deadline.
  achieved: false,
  results: [],
  targetDependencies: ["T1"],
  coverage: "complete",
  sourceMatchIds: [MATCH_ID],
  queryHash: HASH,
  timelineEvents: [],
});

vi.mock("#src/betting/dares/sql/dare-sql-v3.ts", () => ({
  executeDareSqlV3: () => Promise.resolve(evidence),
  decisiveTargetDependenciesV3: () => Promise.resolve(["T1"]),
}));

const { captureDareSqlV3ForMatch } =
  await import("#src/betting/dares/settlement/dare-settle-v3.ts");

function contract(): DareContractV3 {
  return DareContractV3Schema.parse({
    ...dareSqlV3ContractCore({ queryHash: HASH, maxEligibleGames: 1 }),
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
  await db.bucksDareV2Evidence.deleteMany();
  await db.bucksDareV2Target.deleteMany();
  await db.bucksDareV2.deleteMany();
});

/** An active version-3 Dare with an empty pot and one target. */
async function activeV3Dare() {
  const parsed = contract();
  const created = await db.bucksDareV2.create({
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
  const fixture = RawMatchSchema.parse(
    await Bun.file(
      new URL("../../../../../testdata/rift.json", import.meta.url),
    ).json(),
  );
  return makeTwistedFateMatch(fixture, {
    matchId: MATCH_ID,
    timePlayed: 25 * 60,
    creepScore: 10,
    gameStartTimestamp: T0.getTime() + 60 * 60 * 1000,
  });
}

describe("the version-3 Dare notification gate", () => {
  test("writes no outbox row when the match is owed no public delivery", async () => {
    const { dare, contract: parsed } = await activeV3Dare();

    await captureDareSqlV3ForMatch({
      dare,
      contract: parsed,
      matchData: await qualifyingMatch(),
      prismaClient: db,
      now: new Date(T0.getTime() + 2 * 60 * 60 * 1000),
      notify: "withhold",
    });

    expect(
      await db.bucksDareNotificationEvent.findMany({
        where: { dareId: dare.id },
      }),
    ).toEqual([]);
    // And the callout it would have posted is retired with the settlement.
    expect(
      await db.bucksDareV2.findUniqueOrThrow({
        where: { id: dare.id },
        select: { calloutRefreshPending: true },
      }),
    ).toEqual({ calloutRefreshPending: false });
  });

  test("writes one when the match is owed one", async () => {
    const { dare, contract: parsed } = await activeV3Dare();

    await captureDareSqlV3ForMatch({
      dare,
      contract: parsed,
      matchData: await qualifyingMatch(),
      prismaClient: db,
      now: new Date(T0.getTime() + 2 * 60 * 60 * 1000),
      notify: "enqueue",
    });

    expect(
      await db.bucksDareNotificationEvent.findMany({
        where: { dareId: dare.id },
      }),
    ).not.toEqual([]);
  });
});
