import { beforeEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { NotificationIntentKeySchema } from "@scout-for-lol/domain/identity/brands.ts";
import type * as NotificationArtifactModule from "#src/temporal/notification/notification-artifact.ts";
import { hallBreakRecords } from "#src/temporal/notification/hall-record-break.test-fixtures.ts";
import {
  attemptRef,
  CHANNEL_ID,
  intentKey,
  intentRecord,
} from "#src/temporal/notification-lane/notification-delivery.test-fixtures.ts";

/**
 * The delivery boundary for the match-subject announcement kinds.
 *
 * The postmatch/prematch suite pins the ambiguity boundary; this one pins
 * what a `settlement` intent does at the send: no artifact, no report
 * generator, the reply-target fallback v1 makes, and the DM refusal. The arms
 * themselves are mocked — their own suites cover them — so what is asserted
 * here is only the delivery contract around them. The DM chokepoint is not
 * stubbed: the kind is refused before it could be reached, and the refusal
 * test asserts that no send of any shape happened.
 */

const stubs = vi.hoisted(() => ({
  requireIntentRecord: vi.fn(),
  resolveNotificationGate: vi.fn(),
  buildSettlementNotificationMessage: vi.fn(),
  readAttestedReportArtifact: vi.fn(),
  readAttestedPrematchArtifact: vi.fn(),
  resolveScoutObservedMatchContext: vi.fn(),
  generateMatchReport: vi.fn(),
  fetchChannelForDelivery: vi.fn(),
  send: vi.fn(),
  isPolicyEnabled: vi.fn(),
  hallInstallationRetirementOf: vi.fn(),
  freshBotMember: vi.fn(),
}));

vi.mock("#src/configuration/flags.ts", async () => ({
  ...(await vi.importActual<Record<string, unknown>>(
    "#src/configuration/flags.ts",
  )),
  isPolicyEnabled: stubs.isPolicyEnabled,
}));

vi.mock("#src/temporal/notification-lane/notification-reads.ts", () => ({
  requireIntentRecord: stubs.requireIntentRecord,
}));
vi.mock("#src/temporal/notification/notification-policy.ts", () => ({
  resolveNotificationGate: stubs.resolveNotificationGate,
}));
vi.mock("#src/temporal/notification/settlement-notification.ts", () => ({
  buildSettlementNotificationMessage: stubs.buildSettlementNotificationMessage,
}));
vi.mock("#src/temporal/notification/prematch-notification.ts", () => ({
  buildPrematchNotificationMessage: vi.fn(),
}));
vi.mock("#src/temporal/notification/notification-artifact.ts", async () => {
  // The readers are stubbed so an announcement that touched one is visible;
  // the error class stays real because the delivery narrows on `instanceof`.
  const actual = await vi.importActual<typeof NotificationArtifactModule>(
    "#src/temporal/notification/notification-artifact.ts",
  );
  return {
    MalformedRenderReceiptError: actual.MalformedRenderReceiptError,
    readAttestedReportArtifact: stubs.readAttestedReportArtifact,
    readAttestedPrematchArtifact: stubs.readAttestedPrematchArtifact,
  };
});
vi.mock("#src/temporal/match/match-context.ts", () => ({
  resolveScoutObservedMatchContext: stubs.resolveScoutObservedMatchContext,
}));
vi.mock("#src/league/tasks/postmatch/match-report-generator.ts", () => ({
  generateMatchReport: stubs.generateMatchReport,
}));
vi.mock("#src/discord/utils/channel.ts", () => ({
  fetchChannelForDelivery: stubs.fetchChannelForDelivery,
}));
vi.mock("#src/discord/client.ts", () => ({ client: {} }));
vi.mock("#src/temporal/notification/intent-audience.ts", () => ({
  hallInstallationRetirementOf: stubs.hallInstallationRetirementOf,
}));
vi.mock("#src/lib/discord/bot-rest.ts", () => ({
  freshBotMember: stubs.freshBotMember,
}));
vi.mock("#src/league/discord/channel.ts", async () => {
  const { channelModuleWithSend } =
    await import("#src/temporal/notification-lane/notification-delivery.test-fixtures.ts");
  return await channelModuleWithSend(stubs.send);
});

const { ChannelSendError, markReplyPermissionError } =
  await import("#src/league/discord/channel.ts");
const { MalformedAnnouncementIntentError } =
  await import("#src/temporal/notification/announcement-codecs.ts");
const { deliverNotification } =
  await import("#src/temporal/notification-lane/notification-delivery.ts");

beforeEach(() => {
  vi.clearAllMocks();
  stubs.fetchChannelForDelivery.mockResolvedValue({ guildId: undefined });
  stubs.isPolicyEnabled.mockResolvedValue(true);
  stubs.hallInstallationRetirementOf.mockResolvedValue(undefined);
  stubs.freshBotMember.mockResolvedValue({
    joined_at: "2026-09-01T00:00:00.000Z",
  });
  stubs.buildSettlementNotificationMessage.mockResolvedValue({
    content: "the pool settled",
    embeds: [],
    allowedMentions: { parse: [] },
    reply: { messageReference: "400000000000000777", failIfNotExists: false },
  });
});

/** A permission failure `send` HANDLED on a reply, exactly as v1 raises it. */
function replyRefused(): InstanceType<typeof ChannelSendError> {
  return markReplyPermissionError(
    new ChannelSendError(
      "Bot does not have 'Read Message History' permission for this reply",
      CHANNEL_ID,
      true,
    ),
  );
}

function gateFor(kind: "settlement", target: "channel" | "dm") {
  stubs.requireIntentRecord.mockResolvedValue(intentRecord(target, kind));
  stubs.resolveNotificationGate.mockResolvedValue({
    kind,
    target,
    policy: "normal",
    decision: "permitted",
  });
}

describe("the settlement-shaped path", () => {
  test("delivers the settlement recap as a reply to the report, without an artifact", async () => {
    gateFor("settlement", "channel");
    stubs.send.mockResolvedValue({ id: "100000000000000778" });

    const result = await deliverNotification(attemptRef());

    expect(result).toMatchObject({ outcome: "delivered" });
    expect(stubs.buildSettlementNotificationMessage).toHaveBeenCalledTimes(1);
    expect(stubs.readAttestedReportArtifact).not.toHaveBeenCalled();
    expect(stubs.readAttestedPrematchArtifact).not.toHaveBeenCalled();
    expect(stubs.generateMatchReport).not.toHaveBeenCalled();
    const sent = SentOptionsSchema.parse(stubs.send.mock.calls[0]?.[0]);
    expect(sent.reply).toEqual({
      messageReference: "400000000000000777",
      failIfNotExists: false,
    });
    expect(sent.allowedMentions).toEqual({ parse: [] });
  });

  test("falls back to one plain send when the reply is refused", async () => {
    // v1's fallback: a refused reply is a failure `send` HANDLED before the
    // request left, so the nonce is unspent and a second, reply-less send is
    // a first send — not a duplicate.
    gateFor("settlement", "channel");
    stubs.send
      .mockRejectedValueOnce(replyRefused())
      .mockResolvedValueOnce({ id: "100000000000000779" });

    const result = await deliverNotification(attemptRef());

    expect(result).toEqual({
      outcome: "delivered",
      messageId: "100000000000000779",
    });
    expect(stubs.send).toHaveBeenCalledTimes(2);
    const first = SentOptionsSchema.parse(stubs.send.mock.calls[0]?.[0]);
    const second = SentOptionsSchema.parse(stubs.send.mock.calls[1]?.[0]);
    expect(first.reply).toBeDefined();
    expect(second.reply).toBeUndefined();
    expect(second.content).toBe(first.content);
  });

  test("does not fall back when a plain send's permission is refused", async () => {
    // Only a REPLY refusal earns the second send; a plain send refused for
    // permissions is terminal exactly as before.
    gateFor("settlement", "channel");
    stubs.buildSettlementNotificationMessage.mockResolvedValue({
      content: "the pool settled",
      embeds: [],
    });
    stubs.send.mockRejectedValue(replyRefused());

    const result = await deliverNotification(attemptRef());

    expect(result).toMatchObject({ outcome: "failed" });
    expect(stubs.send).toHaveBeenCalledTimes(1);
  });

  test("refuses a DM target for a settlement intent as terminal without building anything", async () => {
    gateFor("settlement", "dm");

    const result = await deliverNotification(attemptRef());

    expect(result).toEqual({
      outcome: "failed",
      failure: { classification: "terminal", reason: "target-not-found" },
    });
    expect(stubs.buildSettlementNotificationMessage).not.toHaveBeenCalled();
    expect(stubs.send).not.toHaveBeenCalled();
  });
});

describe("an announcement whose payload cannot produce a message", () => {
  test.each(["settlement"] as const)(
    "parks a malformed %s intent as terminal, not retryable",
    async (kind) => {
      // The same laundering the render-receipt finding named, on the other
      // kind of persisted evidence. An announcement minted with no payload, or
      // one describing a resolution that has no message, is fixed at mint and
      // re-reads identically forever — so a retryable failure would hand it
      // back to reconciliation to re-drive every sweep with nobody told.
      gateFor(kind, "channel");
      const malformed = new MalformedAnnouncementIntentError({
        intentKey,
        detail: "the test says so",
      });
      stubs.buildSettlementNotificationMessage.mockRejectedValue(malformed);

      const result = await deliverNotification(attemptRef());

      expect(result).toEqual({
        outcome: "failed",
        failure: { classification: "terminal", reason: "content-unavailable" },
      });
      expect(stubs.send).not.toHaveBeenCalled();
    },
  );
});

const HALL_INTENT_KEY = NotificationIntentKeySchema.parse(
  "hall-record-break:NA1_9301:100000000000000001",
);

function hallAttemptRef() {
  return { ...attemptRef(), intentKey: HALL_INTENT_KEY };
}

function hallRecordWith(records: unknown[]): unknown {
  return {
    matchId: "NA1_9301",
    intent: {
      key: HALL_INTENT_KEY,
      kind: "hall-record-break",
      origin: { kind: "live" },
      createdAt: "2026-09-12T00:00:00.000Z",
      target: { kind: "channel", channelId: CHANNEL_ID },
      announcement: {
        kind: "scout-hall-record-break-announcement",
        version: 1,
        data: {
          guildId: "100000000000000001",
          riotMatchId: "NA1_9301",
          records,
        },
      },
    },
  };
}

describe("the hall-shaped path", () => {
  // The hall arm is NOT mocked here: what is pinned is the real arm's
  // refusal reaching the delivery as a definite, terminal non-send.
  test("delivers a Hall record only to its resolved guild", async () => {
    stubs.requireIntentRecord.mockResolvedValue(
      hallRecordWith(hallBreakRecords()),
    );
    stubs.resolveNotificationGate.mockResolvedValue({
      decision: "permitted",
    });
    stubs.fetchChannelForDelivery.mockResolvedValue({
      guildId: "100000000000000001",
    });
    stubs.send.mockResolvedValue({ id: "100000000000000779" });

    expect(await deliverNotification(hallAttemptRef())).toEqual({
      outcome: "delivered",
      messageId: "100000000000000779",
    });
    expect(stubs.send).toHaveBeenCalledTimes(1);
  });

  test("an announcement whose every record was retired parks as content-unavailable, unsent", async () => {
    stubs.requireIntentRecord.mockResolvedValue(
      hallRecordWith([
        {
          matchId: "NA1_9301",
          gameEndAt: "2026-09-04T00:00:00.000Z",
          value: 1,
          holder: {
            playerId: 1,
            playerAlias: "Alice",
            accountId: 1,
            accountAlias: "Main",
            puuid: "hall-delivery-puuid",
          },
          queueFamilyId: "retired-anyway",
          recordId: "largest_multikill",
          holders: [],
        },
      ]),
    );
    stubs.resolveNotificationGate.mockResolvedValue({
      kind: "hall-record-break",
      target: "channel",
      policy: "normal",
      decision: "permitted",
    });

    const result = await deliverNotification(hallAttemptRef());

    expect(result).toEqual({
      outcome: "failed",
      failure: { classification: "terminal", reason: "content-unavailable" },
    });
    expect(stubs.send).not.toHaveBeenCalled();
  });

  test("records a late guild opt-out as a definite non-send", async () => {
    stubs.requireIntentRecord.mockResolvedValue(
      hallRecordWith(hallBreakRecords()),
    );
    stubs.resolveNotificationGate.mockResolvedValue({
      decision: "permitted",
    });
    stubs.fetchChannelForDelivery.mockResolvedValue({
      guildId: "100000000000000001",
    });
    stubs.isPolicyEnabled.mockResolvedValue(false);

    expect(await deliverNotification(hallAttemptRef())).toEqual({
      outcome: "suppressed",
      reason: "feature-disabled",
    });
    expect(stubs.send).not.toHaveBeenCalled();
  });

  test("refuses a Hall target resolved in another guild", async () => {
    stubs.requireIntentRecord.mockResolvedValue(
      hallRecordWith(hallBreakRecords()),
    );
    stubs.resolveNotificationGate.mockResolvedValue({
      decision: "permitted",
    });
    stubs.fetchChannelForDelivery.mockResolvedValue({
      guildId: "100000000000000002",
    });

    expect(await deliverNotification(hallAttemptRef())).toEqual({
      outcome: "failed",
      failure: { classification: "terminal", reason: "content-unavailable" },
    });
    expect(stubs.send).not.toHaveBeenCalled();
  });
});

const SentOptionsSchema = z.object({
  content: z.string().optional(),
  reply: z.unknown().optional(),
  allowedMentions: z.unknown().optional(),
});
