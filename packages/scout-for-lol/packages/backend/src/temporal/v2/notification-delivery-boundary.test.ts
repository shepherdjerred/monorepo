import { AttachmentBuilder } from "discord.js";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import type * as NotificationArtifactModule from "#src/temporal/v2/notification/notification-artifact.ts";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { NOTIFICATION_PRE_SEND_BUDGET_MS } from "@scout-for-lol/temporal/activity-contracts-v2";
import {
  attemptRef,
  intentRecord,
} from "#src/temporal/v2/notification-delivery.test-fixtures.ts";

/**
 * Which side of the send a failure happened on, and why the line is where it is.
 *
 * `deliverNotificationV2` runs with `maximumAttempts: 1`, so the Workflow
 * treats a THROW as an unobserved send and parks the intent in
 * `unknown-delivery` — a dead end only an operator leaves. That is right for a
 * request that may have reached Discord and wrong for everything else: an
 * object store that timed out or a database that fell over means the message
 * definitely did not go out, and calling that ambiguous costs the user their
 * notification while an operator investigates a send that never happened.
 *
 * So the Activity decides every failure it can see and only genuinely
 * unanswerable ones escape as throws. These tests pin the line: each pre-send
 * flavour must come back as `failed`, must never be `unknown`, and must not
 * have touched Discord. They are also the mutation proof — move any of these
 * causes past the boundary and the matching case flips to `unknown` and fails.
 *
 * The second property they pin is what the delivery may do at all. It
 * assembles the message from the render receipt and the objects it names, and
 * nothing else: no Riot read, no report generator, no model call. Those ran
 * once, on the background queue, when the artifact was rendered — the
 * generator is what rewrites this match's `MatchRankHistory` and what spends
 * the single AI review a match is allowed, and neither may happen again, per
 * channel, inside a thirty-second single-attempt send.
 */

const stubs = vi.hoisted(() => ({
  requireIntentRecordV2: vi.fn(),
  resolveScoutV2ObservedMatchContext: vi.fn(),
  generateMatchReport: vi.fn(),
  generateAiReviewIfEnabled: vi.fn(),
  readAttestedReportArtifactV2: vi.fn(),
  readAttestedPrematchArtifactV2: vi.fn(),
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
  resolveScoutV2ObservedMatchContext: stubs.resolveScoutV2ObservedMatchContext,
}));
vi.mock("#src/league/tasks/postmatch/match-report-generator.ts", () => ({
  generateMatchReport: stubs.generateMatchReport,
}));
vi.mock("#src/league/tasks/postmatch/match-report-ai-review.ts", () => ({
  generateAiReviewIfEnabled: stubs.generateAiReviewIfEnabled,
}));
vi.mock("#src/temporal/v2/notification/notification-artifact.ts", async () => {
  // The readers are stubbed; the error class is the real one, because the
  // delivery narrows on `instanceof` and a fake class would let a routing
  // regression pass here while production still mis-classified the throw.
  const actual = await vi.importActual<typeof NotificationArtifactModule>(
    "#src/temporal/v2/notification/notification-artifact.ts",
  );
  return {
    RenderReceiptViolationError: actual.RenderReceiptViolationError,
    MalformedRenderReceiptError: actual.MalformedRenderReceiptError,
    InconsistentAttestedObjectError: actual.InconsistentAttestedObjectError,
    readAttestedReportArtifactV2: stubs.readAttestedReportArtifactV2,
    readAttestedPrematchArtifactV2: stubs.readAttestedPrematchArtifactV2,
  };
});
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
  const { channelModuleWithSend } =
    await import("#src/temporal/v2/notification-delivery.test-fixtures.ts");
  return await channelModuleWithSend(stubs.send);
});

const { ArchivedObjectUnusableError } =
  await import("#src/report-store/s3-raw-source.ts");
const { InconsistentAttestedObjectError, MalformedRenderReceiptError } =
  await import("#src/temporal/v2/notification/notification-artifact.ts");
const { deliverNotificationV2 } =
  await import("#src/temporal/v2/notification-delivery.ts");

/** The bytes the render Activity attested, as the read-back hands them over. */
const ARTIFACT_BYTES = new Uint8Array([137, 80, 78, 71, 7, 7, 7]);
const REVIEW_BYTES = new Uint8Array([137, 80, 78, 71, 9, 9]);
const REPORT_CONTENT = "jerred finished a solo game\n\nA clean carry.";

/** The report the render attested, as the post-match reader hands it over. */
function attestedReport(review: Uint8Array | undefined): unknown {
  return {
    image: ARTIFACT_BYTES,
    review,
    evidence: {
      artifact: "report",
      riotMatchId: "NA1_9301",
      image: {
        objectKey: "games/2026/09/16/NA1_9301/report.png",
        digest: "f".repeat(64),
        bytes: ARTIFACT_BYTES.byteLength,
        contentType: "image/png",
      },
      content: REPORT_CONTENT,
      components: "match-link",
      ...(review === undefined
        ? {}
        : {
            review: {
              objectKey: "games/2026/09/16/NA1_9301/ai-review.png",
              digest: "e".repeat(64),
              bytes: review.byteLength,
              contentType: "image/png",
            },
          }),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  stubs.requireIntentRecordV2.mockResolvedValue(intentRecord("channel"));
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
  stubs.readAttestedReportArtifactV2.mockResolvedValue(
    attestedReport(REVIEW_BYTES),
  );
  stubs.readAttestedPrematchArtifactV2.mockResolvedValue({
    artifact: "image",
    bytes: ARTIFACT_BYTES,
    evidence: {
      artifact: "image",
      riotMatchId: "NA1_9301",
      objectKey: "games/2026/09/16/NA1_9301/loading-screen.png",
      digest: "f".repeat(64),
      bytes: ARTIFACT_BYTES.byteLength,
      contentType: "image/png",
    },
  });
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
      name: "the guild lookup",
      arrange: () => {
        stubs.fetchChannelForDelivery.mockRejectedValue(new Error("rest 500"));
      },
    },
    {
      name: "the artifact read-back's transport",
      arrange: () => {
        stubs.readAttestedReportArtifactV2.mockRejectedValue(
          new Error("seaweedfs timed out"),
        );
      },
    },
    {
      name: "a missing render receipt",
      arrange: () => {
        stubs.readAttestedReportArtifactV2.mockRejectedValue(
          new Error("No postmatch render receipt stands"),
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
    expect(stubs.readAttestedReportArtifactV2).not.toHaveBeenCalled();
    expect(stubs.send).not.toHaveBeenCalled();
    expect(stubs.sendDM).not.toHaveBeenCalled();
  });

  test("reports a receipt its kind cannot deliver as terminal, not retryable", async () => {
    // The finding this closes: the throw for a post-match receipt attesting
    // no artifact was caught by the blanket preparation fallback and reported
    // as retryable `service-unavailable`, which returns the intent to `ready`.
    // Reconciliation then re-drove the same corrupt receipt every sweep,
    // forever, because the row parses the same way on every read. A
    // deterministic contract violation is terminal.
    stubs.readAttestedReportArtifactV2.mockRejectedValue(
      new MalformedRenderReceiptError({
        riotMatchId: RiotMatchIdSchema.parse("NA1_9301"),
        kind: "postmatch",
        evidence: {
          artifact: "none",
          riotMatchId: RiotMatchIdSchema.parse("NA1_9301"),
          reason: "unsupported-queue",
        },
        expected: "a report",
      }),
    );

    const result = await deliverNotificationV2(attemptRef());

    expect(result).toEqual({
      outcome: "failed",
      failure: { classification: "terminal", reason: "content-unavailable" },
    });
    expect(stubs.send).not.toHaveBeenCalled();
  });

  test("answers a pre-send phase that outruns its budget, rather than hanging", async () => {
    // The finding this closes: the artifact read happens inside an Activity
    // with a ten-second heartbeat timeout and a thirty-second start-to-close,
    // and `maximumAttempts: 1`. A slow object store therefore used to be
    // decided by the server's clock, reaching the Workflow as a bare Activity
    // failure — indistinguishable from a Discord request that went unanswered,
    // and recorded as `unknown-delivery`, which only an operator leaves. A
    // read that provably contacted nobody must be answered by the Activity,
    // while it is still alive to answer.
    vi.useFakeTimers();
    try {
      stubs.readAttestedReportArtifactV2.mockReturnValue(
        new Promise(() => {
          // The object store that never answers.
        }),
      );

      const outcome = deliverNotificationV2(attemptRef());
      await vi.advanceTimersByTimeAsync(NOTIFICATION_PRE_SEND_BUDGET_MS);

      expect(await outcome).toEqual({
        outcome: "failed",
        failure: { classification: "retryable", reason: "service-unavailable" },
      });
      expect(stubs.send).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  test("cancels the object-store read it walked away from", async () => {
    // Answering within the budget is only half of it: the read must actually
    // be cancelled, or the Activity would return while an abandoned fetch kept
    // running against a worker that has moved on.
    vi.useFakeTimers();
    try {
      let observed: AbortSignal | undefined;
      stubs.readAttestedReportArtifactV2.mockImplementation(
        (_matchId: unknown, abortSignal: AbortSignal) => {
          observed = abortSignal;
          return new Promise(() => {
            // Still nothing.
          });
        },
      );

      const outcome = deliverNotificationV2(attemptRef());
      await vi.advanceTimersByTimeAsync(NOTIFICATION_PRE_SEND_BUDGET_MS);
      await outcome;

      expect(observed?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  test("reports a receipt that contradicts itself as terminal", async () => {
    // SHA-256 covers length, so bytes that match the digest and not the
    // attested size mean the RECEIPT disagrees with itself. Deterministic:
    // every re-read reproduces it, so a retryable failure would return the
    // intent to `ready` and re-drive the same contradiction forever.
    stubs.readAttestedReportArtifactV2.mockRejectedValue(
      new InconsistentAttestedObjectError({
        riotMatchId: RiotMatchIdSchema.parse("NA1_9301"),
        objectKey: "games/2026/09/16/NA1_9301/report.png",
        attestedBytes: 11,
        readBytes: 12,
      }),
    );

    const result = await deliverNotificationV2(attemptRef());

    expect(result).toEqual({
      outcome: "failed",
      failure: { classification: "terminal", reason: "content-unavailable" },
    });
    expect(stubs.send).not.toHaveBeenCalled();
  });

  test.each(["missing", "digest-mismatch"] as const)(
    "reports an artifact that is %s as terminal content-unavailable",
    async (reason) => {
      // The receipt stands and its bytes do not. That is a fact about
      // storage: retrying reads the same broken object, and sending a
      // freshly rendered image instead would attest bytes nobody attested.
      stubs.readAttestedReportArtifactV2.mockRejectedValue(
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
    // Riot context nor the report artifact is touched.
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
    expect(stubs.readAttestedReportArtifactV2).not.toHaveBeenCalled();
    expect(stubs.generateMatchReport).not.toHaveBeenCalled();
    expect(stubs.resolveScoutV2ObservedMatchContext).not.toHaveBeenCalled();
    const sent = SentMessageSchema.parse(stubs.send.mock.calls[0]?.[0]);
    expect(sent.content).toBe("someone started a game");
  });
});

describe("what the send assembles", () => {
  beforeEach(() => {
    stubs.send.mockResolvedValue({ id: "100000000000000777" });
  });

  test("delivers exactly the bytes and the words the render receipt attested", async () => {
    // The seam's whole promise: what was read back and verified against the
    // receipt is what the message carries, so the receipt never attests a
    // message the send did not deliver.
    await deliverNotificationV2(attemptRef());

    const sent = SentMessageSchema.parse(stubs.send.mock.calls[0]?.[0]);
    expect(sent.content).toBe(REPORT_CONTENT);
    expect(sent.files[0]?.name).toBe("NA1_9301.png");
    expect(attachmentBytes(sent.files[0]?.attachment)).toEqual(ARTIFACT_BYTES);
  });

  test("never runs the report generator, the Riot read or the model", async () => {
    // The two findings this closes. Running the generator here refetched the
    // player's CURRENT rank and upserted this older match's
    // `MatchRankHistory` with it, so a delivery re-driven after the player's
    // next game rewrote the rank captured at render; and it called the AI
    // review inside the single-attempt thirty-second send, where a model call
    // outliving the timeout turns a pre-send failure into an unknown delivery.
    await deliverNotificationV2(attemptRef());

    expect(stubs.generateMatchReport).not.toHaveBeenCalled();
    expect(stubs.resolveScoutV2ObservedMatchContext).not.toHaveBeenCalled();
    expect(stubs.generateAiReviewIfEnabled).not.toHaveBeenCalled();
  });

  test("carries the attested review to every channel, not just the first", async () => {
    // `markAiAttempted` is global to the match, so a review generated inside
    // the delivery was consumed by whichever channel was delivered first and
    // silently missing from every later one. The review belongs to the
    // artifact now, so each channel's send rebuilds the same message.
    const deliveries = [];
    for (const channelId of ["100000000000000001", "100000000000000002"]) {
      stubs.requireIntentRecordV2.mockResolvedValue(
        intentRecord("channel", "postmatch", channelId),
      );
      deliveries.push(await deliverNotificationV2(attemptRef()));
    }

    expect(deliveries).toMatchObject([
      { outcome: "delivered" },
      { outcome: "delivered" },
    ]);
    expect(stubs.send).toHaveBeenCalledTimes(2);
    for (const call of stubs.send.mock.calls) {
      const sent = SentMessageSchema.parse(call[0]);
      expect(sent.files).toHaveLength(2);
      expect(sent.files[1]?.name).toBe("ai-review.png");
      expect(attachmentBytes(sent.files[1]?.attachment)).toEqual(REVIEW_BYTES);
    }
    expect(stubs.generateAiReviewIfEnabled).not.toHaveBeenCalled();
  });

  test("attaches only the report when the match earned no review", async () => {
    stubs.readAttestedReportArtifactV2.mockResolvedValue(
      attestedReport(undefined),
    );

    await deliverNotificationV2(attemptRef());

    const sent = SentMessageSchema.parse(stubs.send.mock.calls[0]?.[0]);
    expect(sent.files).toHaveLength(1);
  });
});

const SentMessageSchema = z.object({
  content: z.string().optional(),
  files: z.array(
    z.object({ name: z.string().nullish(), attachment: z.unknown() }),
  ),
});

/** The bytes a built attachment holds, normalized out of Node's Buffer. */
function attachmentBytes(attachment: unknown): Uint8Array {
  return Uint8Array.from(z.instanceof(Uint8Array).parse(attachment));
}
