import { afterAll, describe, expect, test } from "vitest";
import {
  NotificationIntentKeySchema,
  type NotificationIntentKey,
} from "@scout-for-lol/domain/identity/brands.ts";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import {
  testAccountId,
  testChannelId,
  testGuildId,
  testPuuid,
} from "#src/testing/test-ids.ts";
import {
  getObservation,
  getProcessingState,
} from "#src/database/durable/observation-repository.ts";
import { listReceipts } from "#src/database/durable/receipt-repository.ts";
import { listTrackedAccounts } from "#src/database/durable/tracked-account-repository.ts";
import { getIntent } from "#src/database/durable/intent-repository.ts";
import { getWorkflowStart } from "#src/database/durable/workflow-start-repository.ts";
import { scoutDurableDualwriteFailuresTotal } from "#src/metrics/durable.ts";
import type { DurableFacts } from "#src/durable/match/durable-facts.ts";
import {
  recordObservedMatch,
  requestMatchArchive,
} from "#src/durable/match/archive-facts.ts";
import { commitMatchSettlement } from "#src/durable/match/settlement-facts.ts";
import {
  recordCursorAdvanced,
  runMatchProgressionStage,
} from "#src/durable/match/progression-facts.ts";
import {
  createChannelDeliveryRecorder,
  deliveredMessagesByGuild,
  deliveryAttemptNonce,
  recordDeliveryReceipts,
} from "#src/durable/match/delivery-intents.ts";
import { withRecordedWorkflowStart } from "#src/durable/match/workflow-start-facts.ts";
import {
  deliveryEvidenceCodec,
  settlementEvidenceCodec,
  type SettlementEvidence,
} from "#src/durable/match/receipt-evidence.ts";
import { toRiotMatchId } from "#src/durable/match/match-identity.ts";

const { prisma } = createTestDatabase("durable-dualwrite");

afterAll(async () => {
  await prisma.$disconnect();
});

const NOW = new Date("2026-09-12T10:00:00.000Z");
const GAME_CREATION = Date.parse("2026-09-12T09:00:00.000Z");
const FRESHNESS_DEADLINE = new Date("2026-09-12T12:00:00.000Z");

const REGISTERED_PUUID = testPuuid("registered");
const UNREGISTERED_PUUID = testPuuid("stranger");
const OWNER_ID = testAccountId("9000");
const GUILD_ONE = testGuildId("9001");
const GUILD_TWO = testGuildId("9002");
const CHANNEL_ONE = testChannelId("9001");
const CHANNEL_TWO = testChannelId("9002");
const MESSAGE_ID = "300000000000000001";

const facts: DurableFacts = { db: prisma, now: () => NOW };

function matchId(gameId: number): string {
  return `NA1_${String(gameId)}`;
}

/** The intent key one channel's send is recorded under. */
function intentKey(
  keyPrefix: string,
  channelId: string,
): NotificationIntentKey {
  return NotificationIntentKeySchema.parse(`${keyPrefix}:${channelId}`);
}

/**
 * A client whose durable tables are unreachable. Every other model still
 * works, so a test can prove the v1 path is unaffected while the durable
 * writes fail.
 */
function databaseWithBrokenDurableTables(): ExtendedPrismaClient {
  return new Proxy(prisma, {
    get(target, property) {
      if (typeof property === "string" && property.startsWith("match")) {
        throw new Error("durable table is unreachable");
      }
      return Reflect.get(target, property);
    },
  });
}

async function failureCount(writeKind: string): Promise<number> {
  const metric = await scoutDurableDualwriteFailuresTotal.get();
  return (
    metric.values.find((value) => value.labels.write_kind === writeKind)
      ?.value ?? 0
  );
}

async function seedRegisteredAccount(): Promise<{
  playerId: number;
  accountId: number;
}> {
  const player = await prisma.player.create({
    data: {
      alias: "registered",
      serverId: GUILD_ONE,
      creatorDiscordId: OWNER_ID,
      createdTime: NOW,
      updatedTime: NOW,
    },
  });
  const account = await prisma.account.create({
    data: {
      alias: "registered",
      puuid: REGISTERED_PUUID,
      region: "AMERICA_NORTH",
      playerId: player.id,
      serverId: GUILD_ONE,
      creatorDiscordId: OWNER_ID,
      createdTime: NOW,
      updatedTime: NOW,
    },
  });
  return { playerId: player.id, accountId: account.id };
}

const SETTLEMENT_EVIDENCE: SettlementEvidence = {
  closedBetIds: [11, 12],
  settledBetIds: [21],
  resolvedDareIds: [31, 32],
  settledParlayGuildIds: [GUILD_TWO],
  earnedDiscordIds: [OWNER_ID],
};

describe("a v1 match-processing pass", () => {
  test("records the observation and the tracked accounts", async () => {
    const registration = await seedRegisteredAccount();
    const id = matchId(9001);

    const archived = await requestMatchArchive({
      facts,
      match: {
        matchId: id,
        gameCreation: GAME_CREATION,
        trackedPuuids: [REGISTERED_PUUID, UNREGISTERED_PUUID],
        source: "postmatch_live",
      },
      archive: async () => ({ staged: true, stored: true }),
    });

    // The v1 caller gets its own value back untouched; the gate still reads
    // exactly as it did before the bridge existed.
    expect(archived).toEqual({ staged: true, stored: true });

    const state = await getProcessingState(prisma, {
      matchId: toRiotMatchId(id),
    });
    expect(state?.policy).toBe("FULL");
    expect(state?.owner).toEqual({ kind: "legacy-v1" });
    expect(state?.promotion).toBeNull();

    const tracked = await listTrackedAccounts(prisma, {
      matchId: toRiotMatchId(id),
    });
    expect(tracked).toHaveLength(2);
    expect(tracked.find((row) => row.puuid === REGISTERED_PUUID)).toMatchObject(
      {
        playerId: registration.playerId,
        accountId: registration.accountId,
        cursorAdvancedAt: null,
      },
    );
    expect(
      tracked.find((row) => row.puuid === UNREGISTERED_PUUID),
    ).toMatchObject({ playerId: null, accountId: null });

    // `raw-archive` and `lake-staging` belong to the receipted lake
    // projection, which records them from the writer that knows the object
    // key and digest. This service places only the observation they hang off.
    expect(state?.receipts).toEqual([]);
  });

  test("stamps the observation with the artifact identity when the archive returns one", async () => {
    const id = matchId(9005);
    const key = "games/2026/09/12/NA1_9005/match.json";
    const digest = "b".repeat(64);

    await requestMatchArchive({
      facts,
      match: {
        matchId: id,
        gameCreation: GAME_CREATION,
        trackedPuuids: [REGISTERED_PUUID],
        source: "postmatch_live",
      },
      archive: async () => ({
        staged: true,
        stored: true,
        artifact: { key, digest },
      }),
    });

    const observation = await getObservation(prisma, {
      matchId: toRiotMatchId(id),
    });
    expect(observation?.artifacts.match).toEqual({ key, digest });
    expect(observation?.artifacts.timeline).toBeNull();
  });

  test("records the observation alone when the archive was already completed", async () => {
    const id = matchId(9004);
    await recordObservedMatch({
      facts,
      match: {
        matchId: id,
        gameCreation: GAME_CREATION,
        trackedPuuids: [REGISTERED_PUUID],
        source: "postmatch_live",
      },
    });

    const state = await getProcessingState(prisma, {
      matchId: toRiotMatchId(id),
    });
    expect(state?.owner).toEqual({ kind: "legacy-v1" });
    expect(
      await listTrackedAccounts(prisma, { matchId: toRiotMatchId(id) }),
    ).toHaveLength(1);

    const observation = await getObservation(prisma, {
      matchId: toRiotMatchId(id),
    });
    // No archive ran this pass, so there is no artifact identity to stamp.
    expect(observation?.artifacts.match).toBeNull();
  });

  test("records the settlement receipt naming the ledger rows it moved", async () => {
    const id = matchId(9002);
    const settled = await commitMatchSettlement({
      facts,
      matchId: id,
      settle: async () => ({ announced: true }),
      evidence: () => SETTLEMENT_EVIDENCE,
    });
    expect(settled).toEqual({ announced: true });

    const receipts = await listReceipts(prisma, { matchId: toRiotMatchId(id) });
    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.receipt.scope).toEqual({ kind: "global" });
    expect(
      settlementEvidenceCodec.parse(
        JSON.parse(receipts[0]?.evidence ?? "null"),
      ),
    ).toEqual(SETTLEMENT_EVIDENCE);
  });

  test("records the progression receipt and each account's cursor advance", async () => {
    const id = matchId(9003);
    await requestMatchArchive({
      facts,
      match: {
        matchId: id,
        gameCreation: GAME_CREATION,
        trackedPuuids: [REGISTERED_PUUID],
        source: "postmatch_live",
      },
      archive: async () => ({ staged: true, stored: true }),
    });

    await runMatchProgressionStage({
      facts,
      matchId: id,
      evidence: { participantCount: 10, trackedAccountCount: 1 },
      advance: async () => "progressed",
    });
    await recordCursorAdvanced({ facts, matchId: id, puuid: REGISTERED_PUUID });

    const receipts = await listReceipts(prisma, { matchId: toRiotMatchId(id) });
    expect(receipts.map((entry) => entry.receipt.kind)).toContain(
      "progression",
    );

    const tracked = await listTrackedAccounts(prisma, {
      matchId: toRiotMatchId(id),
    });
    expect(tracked[0]?.cursorAdvancedAt).toBe(NOW.toISOString());
  });
});

describe("the fail-open boundary", () => {
  test("a broken durable repository leaves the v1 pass unaffected", async () => {
    const id = matchId(9010);
    const before = await failureCount("observation");

    const archived = await requestMatchArchive({
      facts: { db: databaseWithBrokenDurableTables(), now: () => NOW },
      match: {
        matchId: id,
        gameCreation: GAME_CREATION,
        trackedPuuids: [REGISTERED_PUUID],
        source: "postmatch_live",
      },
      archive: async () => ({ staged: true, stored: false }),
    });

    // v1's own result is returned, and nothing about the pass changed.
    expect(archived).toEqual({ staged: true, stored: false });
    expect(await failureCount("observation")).toBe(before + 1);
    expect(
      await getProcessingState(prisma, { matchId: toRiotMatchId(id) }),
    ).toBeNull();
  });

  test("a match id that cannot be a durable identity is counted, not thrown", async () => {
    const before = await failureCount("match-identity");
    const settled = await commitMatchSettlement({
      facts,
      matchId: "not-a-riot-match-id",
      settle: async () => "settled anyway",
      evidence: () => SETTLEMENT_EVIDENCE,
    });
    expect(settled).toBe("settled anyway");
    expect(await failureCount("match-identity")).toBe(before + 1);
  });
});

describe("notification intents", () => {
  test("records a delivered send through its whole lifecycle", async () => {
    const id = matchId(9020);
    const keyPrefix = `postmatch-discord:${id}`;
    const record = createChannelDeliveryRecorder({
      facts,
      matchId: toRiotMatchId(id),
      keyPrefix,
      freshnessDeadline: FRESHNESS_DEADLINE,
    });

    await record({ kind: "prepared", channelId: CHANNEL_ONE });
    await record({ kind: "send-started", channelId: CHANNEL_ONE });
    await record({
      kind: "delivered",
      channelId: CHANNEL_ONE,
      messageId: MESSAGE_ID,
    });

    const stored = await getIntent(prisma, {
      intentKey: intentKey(keyPrefix, CHANNEL_ONE),
    });
    expect(stored?.intent.target).toEqual({
      kind: "channel",
      channelId: CHANNEL_ONE,
    });
    expect(stored?.intent.attemptCount).toBe(1);
    expect(stored?.intent.state).toEqual({
      kind: "delivered",
      messageId: MESSAGE_ID,
      deliveredAt: NOW.toISOString(),
    });
  });

  test("the recorded attempt nonce is the one v1 sends to Discord", async () => {
    const id = matchId(9021);
    const keyPrefix = `postmatch-discord:${id}`;
    const effectKey = `${keyPrefix}:${CHANNEL_ONE}`;
    const record = createChannelDeliveryRecorder({
      facts,
      matchId: toRiotMatchId(id),
      keyPrefix,
      freshnessDeadline: FRESHNESS_DEADLINE,
    });

    await record({ kind: "prepared", channelId: CHANNEL_ONE });
    await record({ kind: "send-started", channelId: CHANNEL_ONE });

    const stored = await getIntent(prisma, {
      intentKey: NotificationIntentKeySchema.parse(effectKey),
    });
    expect(stored?.intent.state).toEqual({
      kind: "sending",
      attemptNonce: deliveryAttemptNonce(effectKey),
      startedAt: NOW.toISOString(),
    });
  });

  test("records a permission failure as a terminal denial", async () => {
    const id = matchId(9022);
    const keyPrefix = `prematch-discord:${id}`;
    const record = createChannelDeliveryRecorder({
      facts,
      matchId: toRiotMatchId(id),
      keyPrefix,
      freshnessDeadline: FRESHNESS_DEADLINE,
    });

    await record({ kind: "prepared", channelId: CHANNEL_ONE });
    await record({ kind: "send-started", channelId: CHANNEL_ONE });
    await record({
      kind: "failed",
      channelId: CHANNEL_ONE,
      permissionError: true,
    });

    const stored = await getIntent(prisma, {
      intentKey: intentKey(keyPrefix, CHANNEL_ONE),
    });
    expect(stored?.intent.state).toEqual({ kind: "permission-denied" });
    expect(stored?.intent.lastFailure).toEqual({
      classification: "terminal",
      reason: "permission-denied",
    });
  });

  test("a failure raised before the send records no attempt", async () => {
    const id = matchId(9023);
    const keyPrefix = `postmatch-discord:${id}`;
    const record = createChannelDeliveryRecorder({
      facts,
      matchId: toRiotMatchId(id),
      keyPrefix,
      freshnessDeadline: FRESHNESS_DEADLINE,
    });

    await record({ kind: "prepared", channelId: CHANNEL_ONE });
    await record({
      kind: "failed",
      channelId: CHANNEL_ONE,
      permissionError: false,
    });

    const stored = await getIntent(prisma, {
      intentKey: intentKey(keyPrefix, CHANNEL_ONE),
    });
    expect(stored?.intent.state).toEqual({ kind: "ready" });
    expect(stored?.intent.attemptCount).toBe(0);
  });

  test("records one delivery receipt per guild, naming the messages it delivered", async () => {
    const id = matchId(9024);
    // CHANNEL_TWO was targeted but came back without a message id, so its
    // guild received nothing and gets no receipt.
    const messages = deliveredMessagesByGuild(
      [
        { channel: CHANNEL_ONE, serverId: GUILD_ONE },
        { channel: CHANNEL_TWO, serverId: GUILD_TWO },
      ],
      new Map([[CHANNEL_ONE, MESSAGE_ID]]),
    );
    expect([...messages.keys()]).toEqual([GUILD_ONE]);

    await recordDeliveryReceipts({
      facts,
      kind: "reportDelivery",
      matchId: id,
      messagesByGuild: messages,
    });

    const receipts = await listReceipts(prisma, { matchId: toRiotMatchId(id) });
    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.receipt.kind).toBe("report-delivery");
    expect(receipts[0]?.receipt.scope).toEqual({
      kind: "guild",
      guildId: GUILD_ONE,
    });
    // The evidence names the Discord message, so the receipt can be checked
    // against Discord rather than merely counted.
    expect(
      deliveryEvidenceCodec.parse(JSON.parse(receipts[0]?.evidence ?? "null")),
    ).toEqual({
      deliveries: [{ channelId: CHANNEL_ONE, messageId: MESSAGE_ID }],
    });
  });
});

describe("workflow starts", () => {
  test("records the request before the start and the acceptance after", async () => {
    const requestedWorkflowId = "scout-detached-work-parlay-9030";
    const observed: string[] = [];

    const handle = await withRecordedWorkflowStart({
      facts,
      request: {
        requestedWorkflowId,
        workflowType: "scoutDetachedWork",
        requestSource: "detached-work:parlay-generation",
        requestedBy: null,
        input: { workId: "parlay:NA1_9030" },
      },
      start: async () => {
        const pending = await getWorkflowStart(prisma, {
          requestedWorkflowId,
        });
        observed.push(pending?.acceptance === null ? "requested" : "accepted");
        return { firstExecutionRunId: "run-9030" };
      },
      runIdOf: (started) => started.firstExecutionRunId,
    });

    expect(handle).toEqual({ firstExecutionRunId: "run-9030" });
    // The request row already existed while the start was in flight.
    expect(observed).toEqual(["requested"]);

    const stored = await getWorkflowStart(prisma, { requestedWorkflowId });
    expect(stored?.workflowType).toBe("scoutDetachedWork");
    expect(stored?.inputPayload).toEqual({
      kind: "scoutDetachedWork",
      version: 1,
      data: { workId: "parlay:NA1_9030" },
    });
    expect(stored?.acceptance).toEqual({
      acceptedAt: NOW.toISOString(),
      runId: "run-9030",
    });
  });
});
