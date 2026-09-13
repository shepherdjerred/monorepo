import { AttachmentBuilder } from "discord.js";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { NotificationIntentKeySchema } from "@scout-for-lol/domain/identity/brands.ts";
import { NotificationAttemptNonceSchema } from "@scout-for-lol/domain/notifications/intent.ts";
import type { ScoutIntentAttemptRefV2 } from "@scout-for-lol/temporal/contracts-v2";
import type * as DiscordChannelModule from "#src/league/discord/channel.ts";

/**
 * Which side of the send a failure happened on, and why the line is where it is.
 *
 * `deliverNotificationV2` runs with `maximumAttempts: 1`, so the Workflow
 * treats a THROW as an unobserved send and parks the intent in
 * `unknown-delivery` — a dead end only an operator leaves. That is right for a
 * request that may have reached Discord and wrong for everything else: a Riot
 * fetch that timed out or a renderer that fell over means the message
 * definitely did not go out, and calling that ambiguous costs the user their
 * notification while an operator investigates a send that never happened.
 *
 * So the Activity decides every failure it can see and only genuinely
 * unanswerable ones escape as throws. These tests pin the line: each pre-send
 * flavour must come back as `failed`, must never be `unknown`, and must not
 * have touched Discord. They are also the mutation proof — move any of these
 * causes past the boundary and the matching case flips to `unknown` and fails.
 */

const intentKey = NotificationIntentKeySchema.parse(
  "postmatch-discord:NA1_9301:100000000000000001",
);
const CHANNEL_ID = "100000000000000001";
const ACCOUNT_ID = "200000000000000002";

const stubs = vi.hoisted(() => ({
  requireIntentRecordV2: vi.fn(),
  resolveScoutV2MatchContext: vi.fn(),
  generateMatchReport: vi.fn(),
  fetchChannelForDelivery: vi.fn(),
  send: vi.fn(),
  sendDM: vi.fn(),
}));

vi.mock("#src/temporal/v2/notification-reads.ts", () => ({
  requireIntentRecordV2: stubs.requireIntentRecordV2,
}));
vi.mock("#src/temporal/v2/match-context.ts", () => ({
  resolveScoutV2MatchContext: stubs.resolveScoutV2MatchContext,
}));
vi.mock("#src/league/tasks/postmatch/match-report-generator.ts", () => ({
  generateMatchReport: stubs.generateMatchReport,
}));
vi.mock("#src/discord/utils/channel.ts", () => ({
  fetchChannelForDelivery: stubs.fetchChannelForDelivery,
}));
vi.mock("#src/discord/utils/dm.ts", () => ({ sendDM: stubs.sendDM }));
vi.mock("#src/discord/client.ts", () => ({ client: {} }));
vi.mock("#src/league/discord/channel.ts", async () => {
  // The real error class, because the classifier narrows on `instanceof` and a
  // fake one would make every send failure look unclassifiable.
  const actual = await vi.importActual<typeof DiscordChannelModule>(
    "#src/league/discord/channel.ts",
  );
  return { ChannelSendError: actual.ChannelSendError, send: stubs.send };
});

const { deliverNotificationV2 } =
  await import("#src/temporal/v2/notification-delivery.ts");

function attemptRef(): ScoutIntentAttemptRefV2 {
  return {
    stage: "dev",
    intentKey,
    attemptNonce: NotificationAttemptNonceSchema.parse("attempt-nonce-1"),
  };
}

function intentRecord(target: "channel" | "dm"): unknown {
  return {
    matchId: "NA1_9301",
    intent: {
      key: intentKey,
      target:
        target === "channel"
          ? { kind: "channel", channelId: CHANNEL_ID }
          : { kind: "dm", accountId: ACCOUNT_ID },
    },
  };
}

/** A rendered report, exactly as the generator returns one: image attached. */
function reportWithImage(): unknown {
  return {
    files: [new AttachmentBuilder(Buffer.from([1, 2, 3])).setName("m.png")],
    embeds: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  stubs.requireIntentRecordV2.mockResolvedValue(intentRecord("channel"));
  stubs.resolveScoutV2MatchContext.mockResolvedValue({
    matchData: { info: { queueId: 420 } },
    trackedPlayers: [],
  });
  stubs.generateMatchReport.mockResolvedValue(reportWithImage());
  stubs.fetchChannelForDelivery.mockResolvedValue({ guildId: undefined });
});

describe("a failure before the request could have left", () => {
  test.each([
    {
      name: "the intent read",
      arrange: () => {
        stubs.requireIntentRecordV2.mockRejectedValue(new Error("db down"));
      },
    },
    {
      name: "the Riot payload fetch",
      arrange: () => {
        stubs.resolveScoutV2MatchContext.mockRejectedValue(
          new Error("riot timeout"),
        );
      },
    },
    {
      name: "the report render",
      arrange: () => {
        stubs.generateMatchReport.mockRejectedValue(
          new Error("satori blew up"),
        );
      },
    },
    {
      name: "the guild lookup",
      arrange: () => {
        stubs.fetchChannelForDelivery.mockRejectedValue(new Error("rest 500"));
      },
    },
  ])(
    "reports $name as a retryable failure, never unknown",
    async (scenario) => {
      scenario.arrange();

      const result = await deliverNotificationV2(attemptRef());

      // `failed` + retryable is what returns the intent to `ready` so the
      // Workflow's send loop tries again. `unknown` here would strand a
      // notification that was never sent behind an operator resolution.
      expect(result).toEqual({
        outcome: "failed",
        failure: { classification: "retryable", reason: "service-unavailable" },
      });
      expect(stubs.send).not.toHaveBeenCalled();
      expect(stubs.sendDM).not.toHaveBeenCalled();
    },
  );

  test("reports an unbuildable report as retryable, never unknown", async () => {
    // The generator answers `undefined` when it finds no tracked player it can
    // render. Nothing was sent, so the intent stays retryable.
    stubs.generateMatchReport.mockResolvedValue(undefined);

    const result = await deliverNotificationV2(attemptRef());

    expect(result).toMatchObject({
      outcome: "failed",
      failure: { classification: "retryable" },
    });
    expect(stubs.send).not.toHaveBeenCalled();
  });

  test("refuses a DM that would need an attachment without contacting Discord", async () => {
    // Terminal rather than retryable: no retry teaches `sendDM` to carry files.
    // Decided in the pre-send phase, so it can never look like an ambiguous
    // send — which is what it would have been when this check threw.
    stubs.requireIntentRecordV2.mockResolvedValue(intentRecord("dm"));

    const result = await deliverNotificationV2(attemptRef());

    expect(result).toEqual({
      outcome: "failed",
      failure: { classification: "terminal", reason: "target-not-found" },
    });
    expect(stubs.sendDM).not.toHaveBeenCalled();
  });
});

describe("a failure once the request may have left", () => {
  test("reports an unclassifiable send failure as unknown", async () => {
    // The other side of the line. `send` threw something that is not a
    // `ChannelSendError`, so nobody can say whether Discord saw the request —
    // and only this side of the boundary is allowed to say `unknown`.
    stubs.send.mockRejectedValue(new Error("socket hang up"));

    const result = await deliverNotificationV2(attemptRef());

    expect(result).toEqual({ outcome: "unknown" });
    expect(stubs.send).toHaveBeenCalledTimes(1);
  });

  test("still reports a delivered send", async () => {
    stubs.send.mockResolvedValue({ id: "100000000000000777" });

    const result = await deliverNotificationV2(attemptRef());

    expect(result).toMatchObject({ outcome: "delivered" });
  });
});
