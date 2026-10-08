import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import {
  NotificationIntentKeySchema,
  RiotMatchIdSchema,
  type NotificationIntentKey,
} from "@scout-for-lol/domain/identity/brands.ts";
import {
  NotificationAttemptNonceSchema,
  NotificationIntentSchema,
  type NotificationIntentKind,
} from "@scout-for-lol/domain/notifications/intent.ts";
import { ScoutStageSchema } from "@scout-for-lol/temporal/contracts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { testChannelId } from "#src/testing/test-ids.ts";
import {
  getIntent,
  upsertIntent,
} from "#src/database/durable/intent-repository.ts";
import { hallRecordBreakIntentKey } from "#src/durable/match/delivery-intents.ts";
import { hallRecordBreakAnnouncementEnvelope } from "#src/temporal/notification/announcement-codecs.ts";
import {
  hallBreakRecords,
  hallGuildId,
} from "#src/temporal/notification/hall-record-break.test-fixtures.ts";

/**
 * The Hall policy at the lane's two write boundaries, against real rows.
 *
 * `hall_of_fame_enabled` is the only thing stubbed (and the audience check,
 * which would otherwise ask Discord): the transitions, the repository and the
 * domain machine are the production code. A guild that turned the Hall off
 * after its record break was minted must have the announcement suppressed
 * `feature-disabled` — before it is readied, or, if the flag flipped between
 * the ready and the send, before an attempt is minted — and nothing about any
 * other kind may read the flag at all.
 */
const stubs = vi.hoisted(() => ({
  isPolicyEnabled: vi.fn(),
  fetchChannelForDelivery: vi.fn(),
  retireIfAudienceGone: vi.fn(),
}));

vi.mock("#src/configuration/flags.ts", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "#src/configuration/flags.ts",
  );
  return { ...actual, isPolicyEnabled: stubs.isPolicyEnabled };
});
vi.mock("#src/discord/utils/channel.ts", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "#src/discord/utils/channel.ts",
  );
  return { ...actual, fetchChannelForDelivery: stubs.fetchChannelForDelivery };
});
vi.mock("#src/temporal/notification/intent-audience.ts", () => ({
  retireIfAudienceGone: stubs.retireIfAudienceGone,
}));

const testDatabase = createTestDatabase("temporal-v2-notification-kind-policy");
Bun.env["DATABASE_URL"] = testDatabase.dbUrl;
const { prisma } = testDatabase;

const { prisma: activityPrisma } = await import("#src/database/index.ts");
const {
  beginNotificationSend,
  markNotificationReady,
  recordNotificationOutcome,
} = await import("#src/temporal/notification-lane/notification-transitions.ts");

afterAll(async () => {
  await prisma.$disconnect();
  await activityPrisma.$disconnect();
});

const STAGE = ScoutStageSchema.parse("dev");
const NONCE = NotificationAttemptNonceSchema.parse("kind-policy-attempt");

beforeEach(() => {
  vi.clearAllMocks();
  stubs.fetchChannelForDelivery.mockResolvedValue({ guildId: hallGuildId });
  stubs.retireIfAudienceGone.mockResolvedValue(undefined);
});

let seq = 0;

async function mint(
  kind: Extract<NotificationIntentKind, "hall-record-break" | "postmatch">,
  state: "pending" | "ready",
): Promise<NotificationIntentKey> {
  seq += 1;
  const matchId = RiotMatchIdSchema.parse(`NA1_9301${String(seq)}`);
  const key = NotificationIntentKeySchema.parse(
    kind === "hall-record-break"
      ? hallRecordBreakIntentKey(matchId, hallGuildId)
      : `postmatch-discord:${matchId}:${testChannelId(String(seq))}`,
  );
  const outcome = await upsertIntent(prisma, {
    matchId,
    intent: NotificationIntentSchema.parse({
      key,
      kind,
      origin: { kind: "live" },
      target: { kind: "channel", channelId: testChannelId("8400") },
      freshnessDeadline: "2099-01-01T00:00:00.000Z",
      createdAt: "2026-09-12T10:00:00.000Z",
      attemptCount: 0,
      ...(kind === "hall-record-break"
        ? {
            announcement: hallRecordBreakAnnouncementEnvelope({
              guildId: hallGuildId,
              riotMatchId: matchId,
              records: hallBreakRecords().map((record) => ({
                ...record,
                matchId,
              })),
            }),
          }
        : {}),
      state: { kind: state },
    }),
  });
  expect(outcome).toEqual({ outcome: "applied" });
  return key;
}

async function storedState(key: NotificationIntentKey) {
  const stored = await getIntent(prisma, { intentKey: key });
  if (stored === null) throw new Error(`${key} vanished`);
  return {
    state: stored.intent.state,
    attemptCount: stored.intent.attemptCount,
  };
}

describe("markNotificationReady under the Hall policy", () => {
  test("suppresses a hall intent as feature-disabled when the guild turned the Hall off", async () => {
    stubs.isPolicyEnabled.mockResolvedValue(false);
    const key = await mint("hall-record-break", "pending");

    const result = await markNotificationReady({
      stage: STAGE,
      intentKey: key,
    });

    expect(result.commit).toEqual({ outcome: "applied" });
    expect(result.state).toEqual({
      kind: "suppressed",
      reason: "feature-disabled",
    });
    expect(await storedState(key)).toEqual({
      state: { kind: "suppressed", reason: "feature-disabled" },
      attemptCount: 0,
    });
    expect(stubs.isPolicyEnabled).toHaveBeenCalledWith("hall_of_fame_enabled", {
      server: hallGuildId,
    });
  });

  test("readies a hall intent while the guild has the Hall on", async () => {
    stubs.isPolicyEnabled.mockResolvedValue(true);
    const key = await mint("hall-record-break", "pending");

    const result = await markNotificationReady({
      stage: STAGE,
      intentKey: key,
    });

    expect(result.state).toEqual({ kind: "ready" });
  });

  test("never reads the Hall flag for another kind", async () => {
    stubs.isPolicyEnabled.mockResolvedValue(false);
    const key = await mint("postmatch", "pending");

    const result = await markNotificationReady({
      stage: STAGE,
      intentKey: key,
    });

    expect(result.state).toEqual({ kind: "ready" });
    expect(stubs.isPolicyEnabled).not.toHaveBeenCalled();
  });
});

describe("beginNotificationSend under the Hall policy", () => {
  test("a flag turned off after the ready suppresses before any attempt is minted", async () => {
    stubs.isPolicyEnabled.mockResolvedValue(false);
    const key = await mint("hall-record-break", "ready");

    const result = await beginNotificationSend({
      stage: STAGE,
      intentKey: key,
      attemptNonce: NONCE,
    });

    expect(result.state).toEqual({
      kind: "suppressed",
      reason: "feature-disabled",
    });
    expect(result.attemptCount).toBe(0);
    expect(await storedState(key)).toEqual({
      state: { kind: "suppressed", reason: "feature-disabled" },
      attemptCount: 0,
    });
    // Suppressed before the audience is asked: the policy needs no Discord read.
    expect(stubs.retireIfAudienceGone).not.toHaveBeenCalled();
  });

  test("begins the send while the guild has the Hall on", async () => {
    stubs.isPolicyEnabled.mockResolvedValue(true);
    const key = await mint("hall-record-break", "ready");

    const result = await beginNotificationSend({
      stage: STAGE,
      intentKey: key,
      attemptNonce: NONCE,
    });

    expect(result.state).toMatchObject({
      kind: "sending",
      attemptNonce: NONCE,
    });
    expect(result.attemptCount).toBe(1);
    expect(stubs.retireIfAudienceGone).toHaveBeenCalledTimes(1);
    expect(stubs.fetchChannelForDelivery).not.toHaveBeenCalled();
  });

  test("records a guild opt-out discovered after the attempt began", async () => {
    stubs.isPolicyEnabled.mockResolvedValue(true);
    const key = await mint("hall-record-break", "ready");
    await beginNotificationSend({
      stage: STAGE,
      intentKey: key,
      attemptNonce: NONCE,
    });

    const result = await recordNotificationOutcome({
      stage: STAGE,
      intentKey: key,
      attemptNonce: NONCE,
      delivery: { outcome: "suppressed", reason: "feature-disabled" },
    });

    expect(result.state).toEqual({
      kind: "suppressed",
      reason: "feature-disabled",
    });
    expect(await storedState(key)).toEqual({
      state: { kind: "suppressed", reason: "feature-disabled" },
      attemptCount: 1,
    });
  });
});
