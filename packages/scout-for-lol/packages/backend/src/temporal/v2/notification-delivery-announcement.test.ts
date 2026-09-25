import { beforeEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import type * as NotificationArtifactModule from "#src/temporal/v2/notification/notification-artifact.ts";
import {
  attemptRef,
  CHANNEL_ID,
  intentKey,
  intentRecord,
} from "#src/temporal/v2/notification-delivery.test-fixtures.ts";

/**
 * The delivery boundary for the two announcement kinds.
 *
 * The postmatch/prematch suite pins the ambiguity boundary; this one pins
 * what a `settlement` and a `dare-summary` intent do at the send: no
 * artifact, no report generator, the reply-target fallback v1 makes, the DM
 * refusal, and the post-delivery callout refresh that can never change an
 * outcome. The arms themselves are mocked — their own suites cover them —
 * so what is asserted here is only the delivery contract around them. The DM
 * chokepoint is not stubbed: both kinds are refused before it could be
 * reached, and the refusal test asserts that no send of any shape happened.
 */

const stubs = vi.hoisted(() => ({
  requireIntentRecordV2: vi.fn(),
  resolveNotificationGateV2: vi.fn(),
  buildSettlementNotificationMessageV2: vi.fn(),
  buildDareSummaryNotificationMessageV2: vi.fn(),
  afterDareSummaryDeliveredV2: vi.fn(),
  readAttestedReportArtifactV2: vi.fn(),
  readAttestedPrematchArtifactV2: vi.fn(),
  resolveScoutV2ObservedMatchContext: vi.fn(),
  generateMatchReport: vi.fn(),
  fetchChannelForDelivery: vi.fn(),
  send: vi.fn(),
}));

vi.mock("#src/temporal/v2/notification-reads.ts", () => ({
  requireIntentRecordV2: stubs.requireIntentRecordV2,
}));
vi.mock("#src/temporal/v2/notification/notification-policy.ts", () => ({
  resolveNotificationGateV2: stubs.resolveNotificationGateV2,
}));
vi.mock("#src/temporal/v2/notification/settlement-notification.ts", () => ({
  buildSettlementNotificationMessageV2:
    stubs.buildSettlementNotificationMessageV2,
}));
vi.mock("#src/temporal/v2/notification/dare-summary-notification.ts", () => ({
  buildDareSummaryNotificationMessageV2:
    stubs.buildDareSummaryNotificationMessageV2,
  afterDareSummaryDeliveredV2: stubs.afterDareSummaryDeliveredV2,
}));
vi.mock("#src/temporal/v2/notification/prematch-notification.ts", () => ({
  buildPrematchNotificationMessageV2: vi.fn(),
}));
vi.mock("#src/temporal/v2/notification/notification-artifact.ts", async () => {
  // The readers are stubbed so an announcement that touched one is visible;
  // the error class stays real because the delivery narrows on `instanceof`.
  const actual = await vi.importActual<typeof NotificationArtifactModule>(
    "#src/temporal/v2/notification/notification-artifact.ts",
  );
  return {
    MalformedRenderReceiptError: actual.MalformedRenderReceiptError,
    readAttestedReportArtifactV2: stubs.readAttestedReportArtifactV2,
    readAttestedPrematchArtifactV2: stubs.readAttestedPrematchArtifactV2,
  };
});
vi.mock("#src/temporal/v2/match-context.ts", () => ({
  resolveScoutV2ObservedMatchContext: stubs.resolveScoutV2ObservedMatchContext,
}));
vi.mock("#src/league/tasks/postmatch/match-report-generator.ts", () => ({
  generateMatchReport: stubs.generateMatchReport,
}));
vi.mock("#src/discord/utils/channel.ts", () => ({
  fetchChannelForDelivery: stubs.fetchChannelForDelivery,
}));
vi.mock("#src/discord/client.ts", () => ({ client: {} }));
vi.mock("#src/league/discord/channel.ts", async () => {
  const { channelModuleWithSend } =
    await import("#src/temporal/v2/notification-delivery.test-fixtures.ts");
  return await channelModuleWithSend(stubs.send);
});

const { ChannelSendError, markReplyPermissionError } =
  await import("#src/league/discord/channel.ts");
const { MalformedAnnouncementIntentError } =
  await import("#src/temporal/v2/notification/announcement-codecs.ts");
const { deliverNotificationV2 } =
  await import("#src/temporal/v2/notification-delivery.ts");

beforeEach(() => {
  vi.clearAllMocks();
  stubs.fetchChannelForDelivery.mockResolvedValue({ guildId: undefined });
  stubs.buildSettlementNotificationMessageV2.mockResolvedValue({
    content: "the pool settled",
    embeds: [],
    allowedMentions: { parse: [] },
    reply: { messageReference: "400000000000000777", failIfNotExists: false },
  });
  stubs.buildDareSummaryNotificationMessageV2.mockReturnValue({
    content: "the dare resolved",
    allowedMentions: { parse: [], users: ["200000000000000002"] },
  });
  stubs.afterDareSummaryDeliveredV2.mockResolvedValue(undefined);
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

function gateFor(
  kind: "settlement" | "dare-summary",
  target: "channel" | "dm",
) {
  stubs.requireIntentRecordV2.mockResolvedValue(intentRecord(target, kind));
  stubs.resolveNotificationGateV2.mockResolvedValue({
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

    const result = await deliverNotificationV2(attemptRef());

    expect(result).toMatchObject({ outcome: "delivered" });
    expect(stubs.buildSettlementNotificationMessageV2).toHaveBeenCalledTimes(1);
    expect(stubs.readAttestedReportArtifactV2).not.toHaveBeenCalled();
    expect(stubs.readAttestedPrematchArtifactV2).not.toHaveBeenCalled();
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

    const result = await deliverNotificationV2(attemptRef());

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
    stubs.buildSettlementNotificationMessageV2.mockResolvedValue({
      content: "the pool settled",
      embeds: [],
    });
    stubs.send.mockRejectedValue(replyRefused());

    const result = await deliverNotificationV2(attemptRef());

    expect(result).toMatchObject({ outcome: "failed" });
    expect(stubs.send).toHaveBeenCalledTimes(1);
  });

  test.each(["settlement", "dare-summary"] as const)(
    "refuses a DM target for a %s intent as terminal without building anything",
    async (kind) => {
      gateFor(kind, "dm");

      const result = await deliverNotificationV2(attemptRef());

      expect(result).toEqual({
        outcome: "failed",
        failure: { classification: "terminal", reason: "target-not-found" },
      });
      expect(stubs.buildSettlementNotificationMessageV2).not.toHaveBeenCalled();
      expect(
        stubs.buildDareSummaryNotificationMessageV2,
      ).not.toHaveBeenCalled();
      expect(stubs.send).not.toHaveBeenCalled();
    },
  );
});

describe("an announcement whose payload cannot produce a message", () => {
  test.each(["settlement", "dare-summary"] as const)(
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
      if (kind === "settlement") {
        stubs.buildSettlementNotificationMessageV2.mockRejectedValue(malformed);
      } else {
        stubs.buildDareSummaryNotificationMessageV2.mockImplementation(() => {
          throw malformed;
        });
      }

      const result = await deliverNotificationV2(attemptRef());

      expect(result).toEqual({
        outcome: "failed",
        failure: { classification: "terminal", reason: "content-unavailable" },
      });
      expect(stubs.send).not.toHaveBeenCalled();
    },
  );
});

describe("the dare-summary-shaped path", () => {
  test("delivers the result with its mention allowlist", async () => {
    gateFor("dare-summary", "channel");
    stubs.send.mockResolvedValue({ id: "100000000000000780" });

    const result = await deliverNotificationV2(attemptRef());

    expect(result).toMatchObject({ outcome: "delivered" });
    const sent = SentOptionsSchema.parse(stubs.send.mock.calls[0]?.[0]);
    expect(sent.content).toBe("the dare resolved");
    expect(sent.allowedMentions).toEqual({
      parse: [],
      users: ["200000000000000002"],
    });
    expect(stubs.generateMatchReport).not.toHaveBeenCalled();
  });

  test("refreshes no callout of its own, whatever the send did", async () => {
    // The finding this closes: the refresh ran at the tail of THIS Activity,
    // where it waits behind its serialized queue and then edits a Discord
    // message. Either wait can outlive the ten-second heartbeat timeout, and
    // that timeout fires at the Temporal server — outside every try/catch this
    // process can write — so the already-decided `delivered` result never
    // reached the Workflow and a message Discord accepted was recorded as an
    // ambiguous send. It is `afterNotificationDeliveredV2`'s work now, after
    // the outcome is durably recorded.
    gateFor("dare-summary", "channel");
    stubs.send.mockResolvedValue({ id: "100000000000000781" });

    const result = await deliverNotificationV2(attemptRef());

    expect(result).toEqual({
      outcome: "delivered",
      messageId: "100000000000000781",
    });
    expect(stubs.afterDareSummaryDeliveredV2).not.toHaveBeenCalled();
  });
});

const SentOptionsSchema = z.object({
  content: z.string().optional(),
  reply: z.unknown().optional(),
  allowedMentions: z.unknown().optional(),
});
