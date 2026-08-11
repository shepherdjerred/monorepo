import { describe, expect, test } from "bun:test";
import type { PostalSendInput } from "#shared/postal.ts";
import type { ReportEnvelopeV1 } from "#shared/report.ts";
import {
  REPORT_SEND_CLAIM_FIRST_RETRY_AT_MS,
  REPORT_SEND_CLAIM_TAKEOVER_MS,
  REPORT_SEND_DEADLINE_MS,
} from "#shared/report-delivery-policy.ts";
import {
  activityReportRunId,
  deliverReportWithDependencies,
  type ReportDeliveryBackend,
  type ReportDeliveryReceiptV1,
  reportStateKey,
  type ReportStateV1,
} from "./report-delivery.ts";
import {
  reportSendClaimKey,
  type ReportSendClaimV1,
} from "./report-delivery-lease.ts";

const NOW = "2026-08-10T18:01:00.000Z";

function report(): ReportEnvelopeV1 {
  return {
    schemaVersion: 1,
    reportRunId: "test-report:run-1",
    reportType: "test-report",
    title: "Test report",
    scheduleId: "test-report-daily",
    startedAt: "2026-08-10T18:00:00.000Z",
    completedAt: NOW,
    execution: "complete",
    verdict: "clear",
    headline: "The required check passed.",
    checks: [
      {
        id: "check",
        label: "Required check",
        required: true,
        status: "passed",
        summary: "Observed the expected state.",
        evidenceReceiptIds: ["evidence"],
      },
    ],
    evidence: [
      {
        id: "evidence",
        source: "test",
        observedAt: NOW,
        status: "success",
      },
    ],
    findings: [],
    limitations: [],
    actions: [],
    provenance: {
      workflowId: "test-workflow",
      runId: "run-1",
    },
  };
}

type StoredClaim = { claim: ReportSendClaimV1; etag: string };

/**
 * Conditional-write claim store mirroring the S3 backend: a create only
 * succeeds when absent, a replace only when the entity tag still matches.
 */
function claimBackend(
  claims: Map<string, StoredClaim>,
): Pick<ReportDeliveryBackend, "readSendClaim" | "writeSendClaim"> {
  let nextEtag = 0;
  return {
    readSendClaim: async (key) => claims.get(key),
    writeSendClaim: async (key, claim, expectedEtag) => {
      const held = claims.get(key);
      if (
        held === undefined
          ? expectedEtag !== undefined
          : held.etag !== expectedEtag
      ) {
        return false;
      }
      nextEtag += 1;
      claims.set(key, { claim, etag: `etag-${String(nextEtag)}` });
      return true;
    },
  };
}

describe("report delivery", () => {
  test("uses a stable distinct identity for a failure after an accepted report", () => {
    expect(activityReportRunId("dependency-summary", "run-1", "complete")).toBe(
      "dependency-summary:run-1",
    );
    expect(activityReportRunId("dependency-summary", "run-1", "partial")).toBe(
      "dependency-summary:run-1",
    );
    expect(activityReportRunId("dependency-summary", "run-1", "failed")).toBe(
      "dependency-summary:run-1:failed",
    );
    expect(activityReportRunId("dependency-summary", "run-1", "failed")).toBe(
      activityReportRunId("dependency-summary", "run-1", "failed"),
    );
  });

  test("recovers from receipt-write failure without sending twice", async () => {
    const receipts = new Map<string, ReportDeliveryReceiptV1>();
    const states = new Map<string, ReportStateV1>();
    let failReceiptWrite = true;
    const backend: ReportDeliveryBackend = {
      readReceipt: async (key) => receipts.get(key),
      writeReceipt: async (key, receipt) => {
        if (failReceiptWrite) {
          failReceiptWrite = false;
          throw new Error("receipt store unavailable");
        }
        receipts.set(key, receipt);
      },
      readState: async (key) => states.get(key),
      writeState: async (key, state) => {
        states.set(key, state);
      },
      ...claimBackend(new Map()),
    };
    const sent: PostalSendInput[] = [];
    const dependencies = {
      backend,
      addresses: {
        recipient: "recipient@example.com",
        sender: "sender@example.com",
      },
      send: async (input: PostalSendInput) => {
        sent.push(input);
        return {
          messageId: "postal-message-1",
          recipientId: 42,
          subject: input.subject,
          tag: input.tag,
        };
      },
      now: () => NOW,
      owner: "workflow/run-1/activity-1/1",
      attemptStartedAt: NOW,
    };

    await expect(
      deliverReportWithDependencies(report(), dependencies),
    ).rejects.toThrow("receipt store unavailable");
    const retried = await deliverReportWithDependencies(report(), dependencies);

    expect(sent).toHaveLength(1);
    expect(retried.deduplicated).toBe(true);
    expect(retried.messageId).toBe("postal-message-1");
    expect(sent[0]?.headers).toEqual({
      "X-Report-Run-ID": "test-report:run-1",
      "X-Report-Type": "test-report",
      "X-Temporal-Workflow-ID": "test-workflow",
      "X-Temporal-Run-ID": "run-1",
      "X-Report-Schedule-ID": "test-report-daily",
    });
    expect([...states.values()][0]?.delivery.status).toBe("accepted");
    expect([...states.values()][0]?.report).toEqual(report());
  });
});

function scenario(claims: Map<string, StoredClaim>) {
  const receipts = new Map<string, ReportDeliveryReceiptV1>();
  const states = new Map<string, ReportStateV1>();
  const sent: PostalSendInput[] = [];
  const backend: ReportDeliveryBackend = {
    readReceipt: async (key) => receipts.get(key),
    writeReceipt: async (key, receipt) => {
      receipts.set(key, receipt);
    },
    readState: async (key) => states.get(key),
    writeState: async (key, state) => {
      states.set(key, state);
    },
    ...claimBackend(claims),
  };
  return {
    sent,
    states,
    claims,
    dependencies: (owner: string, now: string, attemptStartedAt = now) => ({
      backend,
      addresses: {
        recipient: "recipient@example.com",
        sender: "sender@example.com",
      },
      send: async (input: PostalSendInput) => {
        sent.push(input);
        return {
          messageId: `postal-${String(sent.length)}`,
          recipientId: 42,
          subject: input.subject,
          tag: input.tag,
        };
      },
      now: () => now,
      owner,
      attemptStartedAt,
    }),
  };
}

function heldBy(owner: string, claimedAt: string): Map<string, StoredClaim> {
  return new Map([
    [
      reportSendClaimKey(reportStateKey(report())),
      {
        claim: {
          schemaVersion: 1 as const,
          reportRunId: report().reportRunId,
          owner,
          claimedAt,
        },
        etag: "etag-0",
      },
    ],
  ]);
}

describe("report send ownership", () => {
  test("refuses to resend while another attempt still owns the send", async () => {
    // Attempt 1 wrote `pending` and sent, then stalled past start-to-close.
    // Attempt 2 must not read `pending` as permission to send again.
    const { sent, dependencies } = scenario(
      heldBy("workflow/run-1/activity-1/1", NOW),
    );
    const stillOwned = new Date(
      Date.parse(NOW) + REPORT_SEND_CLAIM_TAKEOVER_MS - 1000,
    ).toISOString();

    await expect(
      deliverReportWithDependencies(
        report(),
        dependencies("workflow/run-1/activity-1/2", stillOwned),
      ),
    ).rejects.toThrow("already being delivered by another attempt");

    expect(sent).toEqual([]);
  });

  test("takes over an expired lease so a dead owner cannot strand the report", async () => {
    const { sent, states, dependencies } = scenario(
      heldBy("workflow/run-1/activity-1/1", NOW),
    );
    const expired = new Date(
      Date.parse(NOW) + REPORT_SEND_CLAIM_TAKEOVER_MS,
    ).toISOString();

    const result = await deliverReportWithDependencies(
      report(),
      dependencies("workflow/run-1/activity-1/3", expired),
    );

    expect(sent).toHaveLength(1);
    expect(result.deduplicated).toBe(false);
    expect([...states.values()][0]?.delivery.status).toBe("accepted");
  });

  test("stamps the lease with the attempt start, not the claim write time", async () => {
    // Slow pre-claim reads must not backdate the lease relative to the attempt
    // holding it, or a retry sees a dead owner's lease as unexpired.
    const { claims, dependencies } = scenario(new Map<string, StoredClaim>());
    const slowWriteAt = new Date(Date.parse(NOW) + 90_000).toISOString();

    await deliverReportWithDependencies(
      report(),
      dependencies("workflow/run-1/activity-1/1", slowWriteAt, NOW),
    );

    const stored = claims.get(reportSendClaimKey(reportStateKey(report())));
    expect(stored?.claim.claimedAt).toBe(NOW);
  });

  test("refuses to send once the attempt outlived its send deadline", async () => {
    // Past the deadline the lease is takeable, so this attempt must not put a
    // second copy of the report on the wire.
    const { sent, dependencies } = scenario(new Map<string, StoredClaim>());
    const pastDeadline = new Date(
      Date.parse(NOW) + REPORT_SEND_DEADLINE_MS,
    ).toISOString();

    await expect(
      deliverReportWithDependencies(
        report(),
        dependencies("workflow/run-1/activity-1/1", pastDeadline, NOW),
      ),
    ).rejects.toThrow("reached its send deadline");

    expect(sent).toEqual([]);
  });

  test("arms the send deadline after the state write, not before it", async () => {
    // A slow pending-state write spends the attempt's send budget. Measuring
    // the deadline before that write and arming the timeout after it let the
    // request outlive the lease and duplicate a report the successor sent.
    const sent: PostalSendInput[] = [];
    const receipts = new Map<string, ReportDeliveryReceiptV1>();
    const states = new Map<string, ReportStateV1>();
    let clock = NOW;
    const backend: ReportDeliveryBackend = {
      readReceipt: async () => receipts.get("unused"),
      writeReceipt: async () => {
        // no receipt is written: the attempt never reaches its send
      },
      readState: async () => states.get("unused"),
      writeState: async () => {
        clock = new Date(
          Date.parse(NOW) + REPORT_SEND_DEADLINE_MS + 10_000,
        ).toISOString();
      },
      ...claimBackend(new Map<string, StoredClaim>()),
    };

    await expect(
      deliverReportWithDependencies(report(), {
        backend,
        addresses: {
          recipient: "recipient@example.com",
          sender: "sender@example.com",
        },
        send: async (input: PostalSendInput) => {
          sent.push(input);
          return {
            messageId: "postal-1",
            recipientId: 42,
            subject: input.subject,
            tag: input.tag,
          };
        },
        now: () => clock,
        owner: "workflow/run-1/activity-1/1",
        attemptStartedAt: NOW,
      }),
    ).rejects.toThrow("reached its send deadline");

    expect(sent).toEqual([]);
  });

  test("takes over a lease whose owner acquired it late in its attempt", async () => {
    // The reachability argument has to survive slow pre-claim I/O: attempt 1
    // spends 90s on its reads before writing the claim, then hangs. Because
    // the lease is stamped at that attempt's start rather than at the write,
    // the first retry still sees an expired lease instead of contending until
    // the attempt budget is spent.
    const ownerStartedAt = NOW;
    const claims = heldBy("workflow/run-1/activity-1/1", ownerStartedAt);
    const { sent, states, dependencies } = scenario(claims);
    const firstRetryAt = new Date(
      Date.parse(ownerStartedAt) + REPORT_SEND_CLAIM_FIRST_RETRY_AT_MS,
    ).toISOString();

    const result = await deliverReportWithDependencies(
      report(),
      dependencies("workflow/run-1/activity-1/2", firstRetryAt),
    );

    expect(sent).toHaveLength(1);
    expect(result.deduplicated).toBe(false);
    expect([...states.values()][0]?.delivery.status).toBe("accepted");
  });

  test("refuses to record a delivery whose lease was taken over mid-persistence", async () => {
    // Postal accepted the message, but recording it lands after the send and
    // can outlast the lease. A displaced owner must not overwrite the
    // successor's durable record, and must fail loudly so the duplicate is
    // visible rather than recorded as one clean delivery.
    const claims = heldBy("workflow/run-1/activity-1/1", NOW);
    const { sent, states, dependencies } = scenario(claims);
    const claimKey = reportSendClaimKey(reportStateKey(report()));

    const owner = dependencies("workflow/run-1/activity-1/1", NOW);
    const takenOver: typeof owner = {
      ...owner,
      send: async (input: PostalSendInput) => {
        const result = await owner.send(input);
        // A successor takes the lease while this attempt is still persisting.
        claims.set(claimKey, {
          claim: {
            schemaVersion: 1 as const,
            reportRunId: report().reportRunId,
            owner: "workflow/run-1/activity-1/2",
            claimedAt: NOW,
          },
          etag: "etag-successor",
        });
        return result;
      },
    };

    await expect(
      deliverReportWithDependencies(report(), takenOver),
    ).rejects.toThrow("lost its send lease");

    expect(sent).toHaveLength(1);
    expect([...states.values()][0]?.delivery.status).toBe("pending");
  });

  test("resumes its own lease after a retry of the same attempt identity", async () => {
    const owner = "workflow/run-1/activity-1/1";
    const { sent, dependencies } = scenario(heldBy(owner, NOW));

    const result = await deliverReportWithDependencies(
      report(),
      dependencies(owner, NOW),
    );

    expect(sent).toHaveLength(1);
    expect(result.deduplicated).toBe(false);
  });
});
