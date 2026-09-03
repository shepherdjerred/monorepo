import { afterAll, beforeEach, describe, expect, test } from "vitest";
import {
  DareSqlV3CompilationSchema,
  DareSqlV3EvidenceSchema,
  PlayerIdSchema,
  type DareActivationV3,
  type DareTargetBindingV2,
} from "@scout-for-lol/data";
import { activatePendingDaresV3 } from "#src/betting/dare-activation-v3.ts";
import {
  bucksTestDiscordId,
  bucksTestPuuid,
  createTrackedTestPlayer,
} from "#src/testing/bucks-fixtures.ts";
import {
  createTestDatabase,
  dropTestDatabase,
} from "#src/testing/test-database.ts";
import { testChannelId, testGuildId } from "#src/testing/test-ids.ts";

const database = createTestDatabase("dare_activation_v3");
const db = database.prisma;
const SERVER = testGuildId("731");
const CHANNEL = testChannelId("732");
const CHALLENGER = bucksTestDiscordId(71);
const TARGET = bucksTestDiscordId(72);
const PUUID = bucksTestPuuid(71);
const LATER_PUUID = bucksTestPuuid(72);
const NOW = new Date("2026-09-03T12:00:00.000Z");
const HASH = "b".repeat(64);

function compilation(activation: DareActivationV3) {
  return DareSqlV3CompilationSchema.parse({
    compilerVersion: "dare-scoutql-3",
    canonicalSql: "SELECT FALSE AS achieved",
    immutableAst: "{}",
    queryHash: HASH,
    maxEligibleGames: 100,
    facts: {
      cteCount: 0,
      joinedRelations: 0,
      predicates: 0,
      maxExpressionDepth: 1,
      physicalSources: ["match_participants"],
      functions: [],
      targetKeys: ["T1"],
    },
    resultStructure: { gameSets: [] },
    finality: "deadline_only",
    competition: { kind: "standard" },
    activation,
  });
}

async function seedActivatingDare(
  activation: DareActivationV3,
  requestedAt = NOW,
) {
  const playerId = PlayerIdSchema.parse(
    await createTrackedTestPlayer(db, {
      alias: "Activation Player",
      serverId: SERVER,
      discordId: TARGET,
      accounts: [PUUID],
      creatorDiscordId: CHALLENGER,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    }),
  );
  const target: DareTargetBindingV2 = {
    key: "T1",
    discordId: TARGET,
    playerId,
    alias: "Activation Player",
    accounts: [{ puuid: PUUID, trackingStartedAt: "2026-01-01T00:00:00.000Z" }],
  };
  return await db.bucksDareV2.create({
    data: {
      serverId: SERVER,
      channelId: CHANNEL,
      challengerDiscordId: CHALLENGER,
      dareState: "activating",
      currentRevision: 1,
      fundedRevision: 1,
      openingStake: 10,
      potTotal: 0,
      revisions: {
        create: {
          revision: 1,
          originalText: "Gain rank",
          canonicalScoutQl: "SELECT FALSE AS achieved",
          compiledPlan: JSON.stringify(compilation(activation)),
          scoutQlImmutableAst: "{}",
          scoutQlPlanHash: HASH,
          compilerVersion: "dare-scoutql-3",
          evaluatorVersion: "dare-evaluator-3",
          targetsJson: JSON.stringify([target]),
          deadlineSpecJson: JSON.stringify({ kind: "relative", days: 7 }),
          openingStake: 10,
          plainLanguage: "Gain rank",
          semanticProofPlan: "Compare normalized LP.",
        },
      },
      targets: {
        create: {
          targetKey: target.key,
          discordId: TARGET,
          playerId,
          alias: target.alias,
          accounts: JSON.stringify(target.accounts),
          acceptedAt: requestedAt,
        },
      },
      activation: {
        create: {
          revision: 1,
          requestedAt,
          nextAttemptAt: requestedAt,
        },
      },
    },
  });
}

const NO_SQL_EVIDENCE = DareSqlV3EvidenceSchema.parse({
  achieved: false,
  results: [],
  targetDependencies: ["T1"],
  coverage: "not_required",
  sourceMatchIds: [],
  queryHash: HASH,
});

beforeEach(async () => {
  await db.bucksDareV2.deleteMany();
  await db.account.deleteMany();
  await db.player.deleteMany();
});

afterAll(async () => {
  await dropTestDatabase(db, database.dbPath);
});

describe("Dare v3 activation worker", () => {
  test("freezes rank, then starts eligibility and the deadline", async () => {
    const dare = await seedActivatingDare({
      kind: "rank",
      queue: "solo",
      goal: { kind: "gain", normalizedLp: 100 },
    });
    const target = await db.bucksDareV2Target.findFirstOrThrow({
      where: { dareId: dare.id, targetKey: "T1" },
    });
    await db.account.create({
      data: {
        alias: "Linked after funding",
        puuid: LATER_PUUID,
        region: "AMERICA_NORTH",
        playerId: target.playerId,
        serverId: SERVER,
        creatorDiscordId: CHALLENGER,
        createdTime: NOW,
        updatedTime: NOW,
      },
    });
    const requestedPuuids: string[] = [];
    await expect(
      activatePendingDaresV3(
        {
          prismaClient: db,
          getRank: async (puuid) => {
            requestedPuuids.push(puuid);
            return {
              status: "available",
              ranks: {
                solo: {
                  tier: "gold",
                  division: 4,
                  lp: 20,
                  wins: 4,
                  losses: 3,
                },
                flex: undefined,
                ranked5s: undefined,
              },
            };
          },
          executeSql: async () => NO_SQL_EVIDENCE,
          clock: () => NOW,
        },
        NOW,
      ),
    ).resolves.toEqual({ activated: 1, voided: 0, retrying: 0 });
    expect(requestedPuuids).toEqual([PUUID]);
    const stored = await db.bucksDareV2.findUniqueOrThrow({
      where: { id: dare.id },
      include: { activation: true },
    });
    expect(stored).toMatchObject({
      dareState: "active",
      activatedAt: NOW,
      deadlineAt: new Date("2026-09-10T12:00:00.000Z"),
      activation: { attemptCount: 1, completedAt: NOW, errorCode: null },
    });
    expect(JSON.parse(stored.contractJson ?? "null")).toMatchObject({
      activationAt: NOW.toISOString(),
      activationSnapshot: {
        targets: [{ targetKey: "T1", sourcePuuid: PUUID }],
      },
    });
  });

  test("persists a retry without activating after a transient Riot failure", async () => {
    const dare = await seedActivatingDare({
      kind: "rank",
      queue: "solo",
      goal: { kind: "gain", normalizedLp: 100 },
    });
    await expect(
      activatePendingDaresV3(
        {
          prismaClient: db,
          getRank: async () => ({ status: "error" }),
          executeSql: async () => NO_SQL_EVIDENCE,
          clock: () => NOW,
        },
        NOW,
      ),
    ).resolves.toEqual({ activated: 0, voided: 0, retrying: 1 });
    const stored = await db.bucksDareV2.findUniqueOrThrow({
      where: { id: dare.id },
      include: { activation: true },
    });
    expect(stored).toMatchObject({
      dareState: "activating",
      activatedAt: null,
      deadlineAt: null,
      activation: {
        attemptCount: 1,
        errorCode: "source_unavailable",
        nextAttemptAt: new Date("2026-09-03T12:05:00.000Z"),
      },
    });
  });

  test("voids an unranked target and a snapshot that cannot finish in 24 hours", async () => {
    const unranked = await seedActivatingDare({
      kind: "rank",
      queue: "flex",
      goal: { kind: "reach", tier: "silver", division: 4 },
    });
    await activatePendingDaresV3(
      {
        prismaClient: db,
        getRank: async () => ({
          status: "available",
          ranks: { solo: undefined, flex: undefined, ranked5s: undefined },
        }),
        executeSql: async () => NO_SQL_EVIDENCE,
        clock: () => NOW,
      },
      NOW,
    );
    expect(
      await db.bucksDareV2.findUniqueOrThrow({ where: { id: unranked.id } }),
    ).toMatchObject({ dareState: "voided", voidReason: "target_unavailable" });

    await db.account.deleteMany();
    await db.player.deleteMany();
    const timedOut = await seedActivatingDare(
      {
        kind: "rank",
        queue: "solo",
        goal: { kind: "gain", normalizedLp: 10 },
      },
      new Date(NOW.getTime() - 24 * 60 * 60 * 1000),
    );
    await activatePendingDaresV3(
      {
        prismaClient: db,
        getRank: async () => ({ status: "error" }),
        executeSql: async () => NO_SQL_EVIDENCE,
        clock: () => NOW,
      },
      NOW,
    );
    expect(
      await db.bucksDareV2.findUniqueOrThrow({ where: { id: timedOut.id } }),
    ).toMatchObject({ dareState: "voided", voidReason: "activation_timeout" });
  });
});
