import { describe, expect, test } from "bun:test";
import type { PostalSendInput } from "#shared/postal.ts";
import type { ReportEnvelopeV1 } from "#shared/report.ts";
import {
  deliverReportWithDependencies,
  type ReportDeliveryBackend,
  type ReportDeliveryReceiptV1,
  type ReportStateV1,
} from "./report-delivery.ts";

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

describe("report delivery", () => {
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
