import { Readable } from "node:stream";
import {
  GetObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  S3Client,
} from "@aws-sdk/client-s3";
import { describe, expect, test, vi } from "vitest";
import { ReportStateV1Schema } from "#activities/reports/report-delivery.ts";
import {
  reportSendClaimKey,
  type ReportSendClaimV1,
} from "#activities/reports/report-delivery-lease.ts";
import {
  parseEngineStatus,
  readBaseline,
  tasknotesBaselineFromReportState,
} from "./tasknotes-canary.ts";

const OBSERVED_AT = "2026-08-10T16:00:00.000Z";
const ACCEPTED_AT = "2026-08-10T16:01:00.000Z";

function acceptedState(input: {
  tasks: number;
  execution: "complete" | "partial";
  verdict: "clear" | "attention" | "inconclusive";
  taskCountStatus: "passed" | "skipped";
}) {
  const reportRunId = `tasknotes-canary:${input.verdict}-${input.tasks.toString()}`;
  return ReportStateV1Schema.parse({
    schemaVersion: 1,
    report: {
      schemaVersion: 1,
      reportRunId,
      reportType: "tasknotes-canary",
      title: "TaskNotes skipped-files canary",
      scheduleId: "tasknotes-skipped-files-canary",
      startedAt: OBSERVED_AT,
      completedAt: ACCEPTED_AT,
      execution: input.execution,
      verdict: input.verdict,
      headline: "TaskNotes baseline fixture.",
      checks: [
        {
          id: "engine-status",
          label: "TaskNotes engine status",
          required: true,
          status: "passed",
          summary: `${input.tasks.toString()} tasks`,
          evidenceReceiptIds: ["engine-status"],
        },
        {
          id: "task-count",
          label: "Task count trend",
          required: true,
          status: input.taskCountStatus,
          summary:
            input.taskCountStatus === "skipped"
              ? "No prior accepted baseline"
              : "Accepted baseline compared",
          evidenceReceiptIds:
            input.taskCountStatus === "passed" ? ["engine-status"] : [],
        },
      ],
      evidence: [
        {
          id: "engine-status",
          source: "TaskNotes engine-status fixture",
          observedAt: OBSERVED_AT,
          status: "success",
          excerpt: JSON.stringify({ tasks: input.tasks }),
        },
      ],
      findings:
        input.verdict === "attention"
          ? [
              {
                severity: "critical",
                summary: "Task count dropped",
                evidenceReceiptIds: ["engine-status"],
              },
            ]
          : [],
      limitations: [],
      actions: [],
      provenance: {
        workflowId: "tasknotes-skipped-files-canary-fixture",
        runId: "run-fixture",
      },
    },
    delivery: {
      status: "accepted",
      updatedAt: ACCEPTED_AT,
      receipt: {
        schemaVersion: 1,
        reportRunId,
        reportType: "tasknotes-canary",
        scheduleId: "tasknotes-skipped-files-canary",
        subject: "TaskNotes fixture",
        messageId: "message-fixture",
        recipientId: "unknown",
        acceptedAt: ACCEPTED_AT,
        reportStateKey: `reports/state/${reportRunId}.json`,
      },
    },
  });
}

describe("TaskNotes task-count baseline eligibility", () => {
  test("bootstraps from a successful first report", () => {
    const baseline = tasknotesBaselineFromReportState(
      acceptedState({
        tasks: 100,
        execution: "partial",
        verdict: "inconclusive",
        taskCountStatus: "skipped",
      }),
    );
    expect(baseline?.tasks).toBe(100);
  });

  test("advances from a complete clear report", () => {
    const baseline = tasknotesBaselineFromReportState(
      acceptedState({
        tasks: 110,
        execution: "complete",
        verdict: "clear",
        taskCountStatus: "passed",
      }),
    );
    expect(baseline?.tasks).toBe(110);
  });

  test("does not ratchet the baseline down after an accepted alert", () => {
    const baseline = tasknotesBaselineFromReportState(
      acceptedState({
        tasks: 70,
        execution: "complete",
        verdict: "attention",
        taskCountStatus: "passed",
      }),
    );
    expect(baseline).toBeUndefined();
  });
});

describe("parseEngineStatus", () => {
  test("parses legacy enveloped vault engine status", () => {
    const parsed = parseEngineStatus(
      JSON.stringify({
        success: true,
        data: {
          configSource: "vault",
          tasks: 42,
          skippedFiles: [{ path: "TaskNotes/bad.md", reason: "invalid yaml" }],
        },
      }),
    );
    expect(parsed).toEqual({
      configSource: "vault",
      tasks: 42,
      skippedFiles: [{ path: "TaskNotes/bad.md", reason: "invalid yaml" }],
    });
  });

  test("parses unwrapped PostgreSQL engine status and defaults skippedFiles to empty", () => {
    const parsed = parseEngineStatus(
      JSON.stringify({
        status: "ok",
        storage: "postgres",
        tasks: 128,
      }),
    );
    expect(parsed).toEqual({
      configSource: "postgres",
      tasks: 128,
      skippedFiles: [],
    });
  });

  test("rejects non-ok or malformed engine status payloads", () => {
    expect(() =>
      parseEngineStatus(
        JSON.stringify({
          status: "error",
          storage: "postgres",
          tasks: 128,
        }),
      ),
    ).toThrow();
    expect(() =>
      parseEngineStatus(
        JSON.stringify({
          success: false,
          error: "unavailable",
        }),
      ),
    ).toThrow();
  });
});

const STATE_PREFIX =
  "reports/state/tasknotes-canary/tasknotes-skipped-files-canary/";

function fakeBaselineStore(
  entries: readonly { key: string; modifiedAt: string; body: string }[],
) {
  const client = new S3Client({ region: "us-east-1" });
  const reads: string[] = [];
  const byKey = new Map(entries.map((entry) => [entry.key, entry]));
  Object.defineProperty(client, "send", {
    value: vi.fn(async (command: GetObjectCommand | ListObjectsV2Command) => {
      if (command instanceof ListObjectsV2Command) {
        return {
          $metadata: {},
          Contents: entries.map((entry) => ({
            Key: entry.key,
            LastModified: new Date(entry.modifiedAt),
          })),
          IsTruncated: false,
        };
      }
      if (
        command instanceof GetObjectCommand &&
        command.input.Key !== undefined
      ) {
        const key = command.input.Key;
        reads.push(key);
        const found = byKey.get(key);
        if (found === undefined) {
          throw new NoSuchKey({
            $metadata: { httpStatusCode: 404 },
            message: key,
          });
        }
        return {
          $metadata: {},
          Body: Object.assign(Readable.from([found.body]), {
            transformToString: async () => found.body,
            transformToByteArray: async () =>
              new TextEncoder().encode(found.body),
            transformToWebStream: () => new Blob([found.body]).stream(),
          }),
        };
      }
      throw new Error("Unexpected S3 command");
    }),
  });
  return {
    store: { client, bucket: "llm-archive", prefix: STATE_PREFIX },
    reads,
  };
}

describe("readBaseline", () => {
  test("ignores newer .send-claim.json and non-.json objects under the state prefix", async () => {
    const priorKey = `${STATE_PREFIX}run-accepted.json`;
    const nextStateKey = `${STATE_PREFIX}run-in-flight.json`;
    const claimKey = reportSendClaimKey(nextStateKey);
    const priorState = acceptedState({
      tasks: 110,
      execution: "complete",
      verdict: "clear",
      taskCountStatus: "passed",
    });
    const claim: ReportSendClaimV1 = {
      schemaVersion: 1,
      reportRunId: "tasknotes-canary:in-flight",
      owner: "attempt-1",
      claimedAt: "2026-08-10T17:00:00.000Z",
    };
    const { store, reads } = fakeBaselineStore([
      {
        key: priorKey,
        modifiedAt: ACCEPTED_AT,
        body: JSON.stringify(priorState),
      },
      {
        key: claimKey,
        modifiedAt: "2026-08-10T17:00:05.000Z",
        body: JSON.stringify(claim),
      },
      {
        key: `${STATE_PREFIX}marker.txt`,
        modifiedAt: "2026-08-10T17:00:10.000Z",
        body: "not json",
      },
    ]);

    const result = await readBaseline(store);
    expect(result.value).toEqual({
      schemaVersion: 1,
      tasks: 110,
      acceptedAt: ACCEPTED_AT,
      reportRunId: priorState.report.reportRunId,
    });
    expect(reads).toEqual([priorKey]);
  });

  test("returns undefined when only .send-claim.json and non-.json objects exist", async () => {
    const claimKey = reportSendClaimKey(`${STATE_PREFIX}run-only-claim.json`);
    const { store, reads } = fakeBaselineStore([
      {
        key: claimKey,
        modifiedAt: "2026-08-10T17:00:05.000Z",
        body: JSON.stringify({
          schemaVersion: 1,
          reportRunId: "tasknotes-canary:only-claim",
          owner: "attempt-1",
          claimedAt: "2026-08-10T17:00:00.000Z",
        } satisfies ReportSendClaimV1),
      },
      {
        key: `${STATE_PREFIX}README`,
        modifiedAt: "2026-08-10T17:00:10.000Z",
        body: "placeholder",
      },
    ]);

    const result = await readBaseline(store);
    expect(result).toEqual({ value: undefined, raw: undefined });
    expect(reads).toEqual([]);
  });
});
