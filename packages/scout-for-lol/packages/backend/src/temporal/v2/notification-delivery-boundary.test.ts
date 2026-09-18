import { AttachmentBuilder } from "discord.js";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";
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
  readAttestedNotificationArtifactV2: vi.fn(),
  resolveNotificationGateV2: vi.fn(),
  buildPrematchNotificationMessageV2: vi.fn(),
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
vi.mock("#src/temporal/v2/notification/notification-artifact.ts", () => ({
  readAttestedNotificationArtifactV2: stubs.readAttestedNotificationArtifactV2,
}));
vi.mock("#src/temporal/v2/notification/notification-policy.ts", () => ({
  resolveNotificationGateV2: stubs.resolveNotificationGateV2,
}));
vi.mock("#src/temporal/v2/notification/prematch-notification.ts", () => ({
  buildPrematchNotificationMessageV2: stubs.buildPrematchNotificationMessageV2,
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

const { ArchivedObjectUnusableError } =
  await import("#src/report-store/s3-raw-source.ts");
const { deliverNotificationV2 } =
  await import("#src/temporal/v2/notification-delivery.ts");

/** The bytes the render Activity attested, as the read-back hands them over. */
const ARTIFACT_BYTES = new Uint8Array([137, 80, 78, 71, 7, 7, 7]);

function attemptRef(): ScoutIntentAttemptRefV2 {
  return {
    stage: "dev",
    intentKey,
    attemptNonce: NotificationAttemptNonceSchema.parse("attempt-nonce-1"),
  };
}

function intentRecord(
  target: "channel" | "dm",
  kind: "postmatch" | "prematch" = "postmatch",
): unknown {
  return {
    matchId: "NA1_9301",
    intent: {
      key: intentKey,
      kind,
      origin: { kind: "live" },
      target:
        target === "channel"
          ? { kind: "channel", channelId: CHANNEL_ID }
          : { kind: "dm", accountId: ACCOUNT_ID },
    },
  };
}

/**
 * A report exactly as the generator builds one around a pre-rendered image:
 * the attachment carries the bytes it was handed.
 */
function reportAround(image: Uint8Array | undefined): unknown {
  return {
    files: [
      new AttachmentBuilder(Buffer.from(image ?? [1, 2, 3])).setName("m.png"),
    ],
    embeds: [],
  };
}

const GeneratorOptionsSchema = z.object({
  prerenderedImage: z.instanceof(Uint8Array).optional(),
});

beforeEach(() => {
  vi.clearAllMocks();
  stubs.requireIntentRecordV2.mockResolvedValue(intentRecord("channel"));
  stubs.resolveScoutV2MatchContext.mockResolvedValue({
    matchData: { info: { queueId: 420 } },
    trackedPlayers: [],
  });
  stubs.resolveNotificationGateV2.mockResolvedValue({
    kind: "postmatch",
    target: "channel",
    policy: "normal",
    decision: "permitted",
  });
  stubs.buildPrematchNotificationMessageV2.mockResolvedValue({
    content: "someone started a game",
    files: [
      new AttachmentBuilder(Buffer.from(ARTIFACT_BYTES)).setName("l.png"),
    ],
    embeds: [],
  });
  stubs.readAttestedNotificationArtifactV2.mockResolvedValue({
    artifact: "image",
    bytes: ARTIFACT_BYTES,
    evidence: {
      artifact: "image",
      riotMatchId: "NA1_9301",
      objectKey: "games/2026/09/16/NA1_9301/report.png",
      digest: "f".repeat(64),
      bytes: ARTIFACT_BYTES.byteLength,
      contentType: "image/png",
    },
  });
  stubs.generateMatchReport.mockImplementation(
    (_match: unknown, _players: unknown, options: unknown) =>
      Promise.resolve(
        reportAround(GeneratorOptionsSchema.parse(options).prerenderedImage),
      ),
  );
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
    {
      name: "the artifact read-back's transport",
      arrange: () => {
        stubs.readAttestedNotificationArtifactV2.mockRejectedValue(
          new Error("seaweedfs timed out"),
        );
      },
    },
    {
      name: "a missing render receipt",
      arrange: () => {
        stubs.readAttestedNotificationArtifactV2.mockRejectedValue(
          new Error("No render receipt stands"),
        );
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

  test("refuses to send an intent its policy holds, without contacting Discord", async () => {
    // `beginNotificationSendV2` already refused a held intent before this
    // attempt was minted, so reaching here held is a broken contract — and
    // still "no-external permits no external sends" holds at the send itself.
    stubs.resolveNotificationGateV2.mockResolvedValue({
      kind: "postmatch",
      target: "channel",
      policy: "no-external",
      decision: "held",
    });

    const result = await deliverNotificationV2(attemptRef());

    expect(result).toEqual({
      outcome: "failed",
      failure: { classification: "retryable", reason: "service-unavailable" },
    });
    expect(stubs.readAttestedNotificationArtifactV2).not.toHaveBeenCalled();
    expect(stubs.send).not.toHaveBeenCalled();
    expect(stubs.sendDM).not.toHaveBeenCalled();
  });

  test("reports a post-match intent whose receipt attests no image as retryable", async () => {
    // Only the prematch renderer can attest `none`; a post-match report has
    // nothing to be delivered without. A broken contract, decided pre-send.
    stubs.readAttestedNotificationArtifactV2.mockResolvedValue({
      artifact: "none",
      evidence: {
        artifact: "none",
        riotMatchId: "NA1_9301",
        reason: "unsupported-queue",
      },
    });

    const result = await deliverNotificationV2(attemptRef());

    expect(result).toMatchObject({
      outcome: "failed",
      failure: { classification: "retryable" },
    });
    expect(stubs.send).not.toHaveBeenCalled();
  });

  test.each(["missing", "digest-mismatch"] as const)(
    "reports an artifact that is %s as terminal content-unavailable",
    async (reason) => {
      // The receipt stands and its bytes do not. That is a fact about
      // storage: retrying reads the same broken object, and sending a
      // freshly rendered image instead would attest bytes nobody attested.
      stubs.readAttestedNotificationArtifactV2.mockRejectedValue(
        new ArchivedObjectUnusableError({
          key: "games/2026/09/16/NA1_9301/report.png",
          reason,
          detail: "the test says so",
        }),
      );

      const result = await deliverNotificationV2(attemptRef());

      expect(result).toEqual({
        outcome: "failed",
        failure: { classification: "terminal", reason: "content-unavailable" },
      });
      expect(stubs.generateMatchReport).not.toHaveBeenCalled();
      expect(stubs.send).not.toHaveBeenCalled();
    },
  );

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

describe("the prematch-shaped path", () => {
  test("builds a prematch intent's message from the prematch arm, never the report", async () => {
    // The finding this closes: a prematch intent driven after its game ended
    // must never resolve a MatchV5 payload and send a post-match report. The
    // prematch arm reads only the archived spectator snapshot, so neither the
    // Riot context nor the report generator is touched.
    stubs.requireIntentRecordV2.mockResolvedValue(
      intentRecord("channel", "prematch"),
    );
    stubs.resolveNotificationGateV2.mockResolvedValue({
      kind: "prematch",
      target: "channel",
      policy: "normal",
      decision: "permitted",
    });
    stubs.send.mockResolvedValue({ id: "100000000000000778" });

    const result = await deliverNotificationV2(attemptRef());

    expect(result).toMatchObject({ outcome: "delivered" });
    expect(stubs.buildPrematchNotificationMessageV2).toHaveBeenCalledTimes(1);
    expect(stubs.buildPrematchNotificationMessageV2.mock.calls[0]?.[0]).toBe(
      "NA1_9301",
    );
    expect(stubs.generateMatchReport).not.toHaveBeenCalled();
    expect(stubs.resolveScoutV2MatchContext).not.toHaveBeenCalled();
    const sent = SentMessageSchema.parse(stubs.send.mock.calls[0]?.[0]);
    expect(sent.content).toBe("someone started a game");
  });
});

describe("what the send attaches", () => {
  test("delivers exactly the bytes the render receipt attested", async () => {
    // The seam's whole promise: the artifact read back and verified against
    // its receipt is the image on the message, so the receipt never attests
    // bytes the send did not deliver. The generator is handed the verified
    // bytes as its pre-rendered image and renders nothing.
    stubs.send.mockResolvedValue({ id: "100000000000000777" });

    await deliverNotificationV2(attemptRef());

    expect(stubs.generateMatchReport).toHaveBeenCalledTimes(1);
    const options = GeneratorOptionsSchema.parse(
      stubs.generateMatchReport.mock.calls[0]?.[2],
    );
    expect(options.prerenderedImage).toBe(ARTIFACT_BYTES);

    const sent = SentMessageSchema.parse(stubs.send.mock.calls[0]?.[0]);
    const attachment = sent.files[0]?.attachment;
    expect(attachment).toBeInstanceOf(Uint8Array);
    expect(new Uint8Array(z.instanceof(Uint8Array).parse(attachment))).toEqual(
      ARTIFACT_BYTES,
    );
  });

  test("reads the artifact before it spends a Riot read", async () => {
    // A broken artifact ends the attempt without fetching the match: the
    // cheaper read, and the one whose failure is a fact rather than a wait.
    stubs.readAttestedNotificationArtifactV2.mockRejectedValue(
      new ArchivedObjectUnusableError({
        key: "games/2026/09/16/NA1_9301/report.png",
        reason: "missing",
        detail: "gone",
      }),
    );

    await deliverNotificationV2(attemptRef());

    expect(stubs.resolveScoutV2MatchContext).not.toHaveBeenCalled();
  });
});

const SentMessageSchema = z.object({
  content: z.string().optional(),
  files: z.array(z.object({ attachment: z.unknown() })),
});
