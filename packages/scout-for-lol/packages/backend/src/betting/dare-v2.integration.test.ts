import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import {
  DareCompiledPlanV2Schema,
  type DareTargetBindingV2,
} from "@scout-for-lol/data";
import { SEED_GRANT } from "#src/betting/constants.ts";
import {
  createDareDraftV2,
  reviseDareDraftV2,
} from "#src/betting/dare-draft-v2.ts";
import { postDareV2Callout } from "#src/betting/dare-callout-v2.ts";
import {
  inspectVisibleDareV2,
  listVisibleDaresV2,
} from "#src/betting/dare-view-v2.ts";
import { consumeDareV2ConfirmationIntent } from "#src/betting/dare-intent-consume-v2.ts";
import { createDareV2ConfirmationIntent } from "#src/betting/dare-intent-v2.ts";
import {
  addFlagOverride,
  clearFlagOverrides,
  resetFlagOverrides,
} from "#src/configuration/flags.ts";
import { reconcileBucksBalances } from "#src/betting/reconcile.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import {
  testAccountId,
  testChannelId,
  testGuildId,
} from "#src/testing/test-ids.ts";

const { prisma: db } = createTestDatabase("bucks-dare-v2");
const SERVER = testGuildId("921");
const CHANNEL = testChannelId("922");
const CHALLENGER = testAccountId("923");
const TARGET = testAccountId("924");
const T0 = new Date("2026-09-01T12:00:00.000Z");

const TARGET_BINDING: DareTargetBindingV2 = {
  key: "virmel",
  discordId: TARGET,
  playerId: 1,
  alias: "Virmel",
  accounts: [
    {
      puuid: "virmel-puuid",
      trackingStartedAt: "2026-01-01T00:00:00.000Z",
    },
  ],
};

const PLAN = DareCompiledPlanV2Schema.parse({
  version: 2,
  maxEligibleGames: 100,
  gameSets: [
    {
      name: "qualifying_game",
      targetKeys: ["virmel"],
      relationship: "independent",
      queues: ["solo", "flex", "ranked 5s"],
      predicate: {
        kind: "and",
        operands: [
          {
            kind: "comparison",
            value: {
              kind: "participant",
              target: "virmel",
              field: "champion_name",
            },
            operator: "eq",
            threshold: "Twisted Fate",
          },
          {
            kind: "comparison",
            value: {
              kind: "participant_rate",
              target: "virmel",
              field: "cs_per_minute",
            },
            operator: "gte",
            threshold: 8,
          },
          {
            kind: "comparison",
            value: {
              kind: "participant",
              target: "virmel",
              field: "time_played",
            },
            operator: "gte",
            threshold: 1200,
          },
        ],
      },
      projections: [],
      orderBy: "game_end_at_asc_match_id_asc",
      limit: 100,
    },
  ],
  result: {
    kind: "matching_games",
    gameSet: "qualifying_game",
    operator: "gte",
    threshold: 1,
  },
});

const deps = {
  prismaClient: db,
  isPolicyEnabled: async (name: Parameters<typeof addFlagOverride>[0]) =>
    name === "betting_enabled" ||
    name === "dare_v2" ||
    name === "scoutql_relational_enabled",
};

async function clearAll(): Promise<void> {
  await db.bucksDareV2ConfirmationIntent.deleteMany();
  await db.bucksDareV2Evidence.deleteMany();
  await db.bucksDareV2Contribution.deleteMany();
  await db.bucksDareV2Target.deleteMany();
  await db.bucksDareV2Revision.deleteMany();
  await db.bucksDareV2.deleteMany();
  await db.bucksLedgerEntry.deleteMany();
  await db.bucksAccount.deleteMany();
}

beforeEach(async () => {
  await clearAll();
  for (const flag of [
    "betting_enabled",
    "dare_v2",
    "scoutql_relational_enabled",
  ] as const) {
    clearFlagOverrides(flag);
    addFlagOverride(flag, true, { server: SERVER });
  }
});

afterAll(async () => {
  resetFlagOverrides("betting_enabled");
  resetFlagOverrides("dare_v2");
  resetFlagOverrides("scoutql_relational_enabled");
  await clearAll();
  await db.$disconnect();
});

async function makeDraft() {
  const result = await createDareDraftV2(
    {
      serverId: SERVER,
      channelId: CHANNEL,
      challengerDiscordId: CHALLENGER,
      originalText:
        "I bet Virmel can't get 8 CS/m on Twisted Fate in a game at least 20m",
      plan: PLAN,
      targets: [TARGET_BINDING],
      deadlineSpec: { kind: "relative", days: 7 },
      openingStake: 20,
    },
    deps,
    T0,
  );
  if (result.kind !== "created")
    throw new Error("Expected Dare v2 draft creation.");
  return result.dareId;
}

async function intent(input: {
  dareId: number;
  actor: typeof CHALLENGER;
  action: "fund" | "accept" | "decline" | "cancel";
  key: string;
}) {
  const result = await createDareV2ConfirmationIntent(
    {
      dareId: input.dareId,
      serverId: SERVER,
      actorDiscordId: input.actor,
      expectedRevision: 1,
      payload: { action: input.action },
      idempotencyKey: input.key,
    },
    deps,
    T0,
  );
  if (result.kind !== "intent_created")
    throw new Error("Expected confirmation intent.");
  return result.intentId;
}

async function consume(intentId: string, actor: typeof CHALLENGER) {
  return await consumeDareV2ConfirmationIntent(
    { intentId, serverId: SERVER, actorDiscordId: actor },
    deps,
    T0,
  );
}

describe("Dare v2 draft and lifecycle", () => {
  test("keeps drafts private while exposing their frozen targets to the owner", async () => {
    const dareId = await makeDraft();
    const mine = await listVisibleDaresV2(
      {
        serverId: SERVER,
        viewerDiscordId: CHALLENGER,
        scope: "mine",
      },
      db,
    );
    expect(mine).toHaveLength(1);
    expect(mine[0]?.targetAliases).toEqual(["Virmel"]);
    const inspected = await inspectVisibleDareV2(
      {
        dareId,
        serverId: SERVER,
        viewerDiscordId: CHALLENGER,
      },
      db,
    );
    expect(inspected?.plan).toEqual(PLAN);
    expect(inspected?.targets.map((target) => target.alias)).toEqual([
      "Virmel",
    ]);
    await expect(
      inspectVisibleDareV2(
        { dareId, serverId: SERVER, viewerDiscordId: TARGET },
        db,
      ),
    ).resolves.toBeNull();
    await expect(
      listVisibleDaresV2(
        { serverId: SERVER, viewerDiscordId: TARGET, scope: "guild" },
        db,
      ),
    ).resolves.toEqual([]);
  });

  test("funds once, freezes the revision, and binds the deadline on acceptance", async () => {
    const dareId = await makeDraft();
    const fundIntent = await intent({
      dareId,
      actor: CHALLENGER,
      action: "fund",
      key: "fund-1",
    });
    const results = await Promise.all([
      consume(fundIntent, CHALLENGER),
      consume(fundIntent, CHALLENGER),
    ]);
    expect(results.filter((result) => result.kind === "funded")).toHaveLength(
      1,
    );
    expect(await db.bucksDareV2Contribution.count({ where: { dareId } })).toBe(
      1,
    );

    const acceptIntent = await intent({
      dareId,
      actor: TARGET,
      action: "accept",
      key: "accept-1",
    });
    const accepted = await consume(acceptIntent, TARGET);
    expect(accepted.kind).toBe("accepted");
    const active = await db.bucksDareV2.findUniqueOrThrow({
      where: { id: dareId },
    });
    expect(active.dareState).toBe("active");
    expect(active.fundedRevision).toBe(1);
    expect(active.deadlineAt?.toISOString()).toBe("2026-09-08T12:00:00.000Z");
    expect(active.contractJson).not.toBeNull();
    await expect(reconcileBucksBalances(db)).resolves.toEqual([]);
  });

  test("rejects a stale funding revision after an immutable revision append", async () => {
    const dareId = await makeDraft();
    const revised = await reviseDareDraftV2(
      {
        dareId,
        serverId: SERVER,
        challengerDiscordId: CHALLENGER,
        expectedRevision: 1,
        definition: {
          originalText: "same dare, clarified to mean one game",
          plan: PLAN,
          targets: [TARGET_BINDING],
          deadlineSpec: { kind: "relative", days: 7 },
          openingStake: 25,
        },
      },
      deps,
      T0,
    );
    expect(revised.kind).toBe("revised");
    expect(await db.bucksDareV2Revision.count({ where: { dareId } })).toBe(2);
    const stale = await createDareV2ConfirmationIntent(
      {
        dareId,
        serverId: SERVER,
        actorDiscordId: CHALLENGER,
        expectedRevision: 1,
        payload: { action: "fund" },
        idempotencyKey: "stale-fund",
      },
      deps,
      T0,
    );
    expect(stale).toEqual({ kind: "stale_revision", currentRevision: 2 });
  });

  test("binds an idempotency key to the complete confirmation payload", async () => {
    const dareId = await makeDraft();
    const first = await createDareV2ConfirmationIntent(
      {
        dareId,
        serverId: SERVER,
        actorDiscordId: CHALLENGER,
        expectedRevision: 1,
        payload: { action: "contribute", amount: 5 },
        idempotencyKey: "contribute-payload",
      },
      deps,
      T0,
    );
    expect(first.kind).toBe("intent_created");

    const conflict = await createDareV2ConfirmationIntent(
      {
        dareId,
        serverId: SERVER,
        actorDiscordId: CHALLENGER,
        expectedRevision: 1,
        payload: { action: "contribute", amount: 10 },
        idempotencyKey: "contribute-payload",
      },
      deps,
      T0,
    );
    expect(conflict).toEqual({ kind: "idempotency_conflict" });
  });

  test("creates one stable confirmation intent under concurrent retries", async () => {
    const dareId = await makeDraft();
    const input = {
      dareId,
      serverId: SERVER,
      actorDiscordId: CHALLENGER,
      expectedRevision: 1,
      payload: { action: "fund" } as const,
      idempotencyKey: "concurrent-fund-intent",
    };

    const [first, second] = await Promise.all([
      createDareV2ConfirmationIntent(input, deps, T0),
      createDareV2ConfirmationIntent(input, deps, T0),
    ]);

    expect(first.kind).toBe("intent_created");
    expect(second.kind).toBe("intent_created");
    if (first.kind !== "intent_created" || second.kind !== "intent_created") {
      throw new Error("Expected concurrent retries to return an intent.");
    }
    expect(second.intentId).toBe(first.intentId);
    expect(
      await db.bucksDareV2ConfirmationIntent.count({
        where: { idempotencyKey: input.idempotencyKey },
      }),
    ).toBe(1);
  });

  test("challenger cancellation during acceptance refunds the full stake", async () => {
    const dareId = await makeDraft();
    const fundIntent = await intent({
      dareId,
      actor: CHALLENGER,
      action: "fund",
      key: "fund-cancel",
    });
    await consume(fundIntent, CHALLENGER);
    const cancelIntent = await intent({
      dareId,
      actor: CHALLENGER,
      action: "cancel",
      key: "cancel-1",
    });
    const cancelled = await consume(cancelIntent, CHALLENGER);
    expect(cancelled.kind).toBe("cancelled");
    const wallet = await db.bucksAccount.findUniqueOrThrow({
      where: {
        serverId_discordId: { serverId: SERVER, discordId: CHALLENGER },
      },
    });
    expect(wallet.balance).toBe(SEED_GRANT);
    await expect(reconcileBucksBalances(db)).resolves.toEqual([]);
  });
});

describe("Dare v2 callout delivery", () => {
  test("concurrent funding replays publish one durable public callout", async () => {
    const dareId = await makeDraft();
    const fundIntent = await intent({
      dareId,
      actor: CHALLENGER,
      action: "fund",
      key: "fund-callout",
    });
    await consume(fundIntent, CHALLENGER);
    const sendMessage = vi.fn(() =>
      Promise.resolve({ channelId: CHANNEL, id: "callout-message" }),
    );
    const calloutDependencies = {
      prismaClient: db,
      sendMessage,
      editMessage: vi.fn(() => Promise.resolve()),
    };

    const results = await Promise.all([
      postDareV2Callout(dareId, calloutDependencies),
      postDareV2Callout(dareId, calloutDependencies),
    ]);

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        nonce: `dare-v2-${dareId.toString()}`,
        enforceNonce: true,
      }),
      CHANNEL,
      SERVER,
    );
    expect(results.map((result) => result.kind).sort()).toEqual([
      "existing",
      "posted",
    ]);
    const dare = await db.bucksDareV2.findUniqueOrThrow({
      where: { id: dareId },
    });
    expect(JSON.parse(dare.messageRef ?? "null")).toEqual({
      channelId: CHANNEL,
      messageId: "callout-message",
    });
    expect(dare.calloutClaimId).toBeNull();
    expect(dare.calloutClaimedAt).toBeNull();
  });
});
