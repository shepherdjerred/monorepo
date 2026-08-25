import { proxyActivities } from "@temporalio/workflow";
import type { ProtobufWatchActivities } from "#activities/protobuf-watch.ts";
import type {
  ActivityReportInput,
  ReportDeliveryActivities,
} from "#activities/report-delivery.ts";

const { collectProtobufWatch } = proxyActivities<ProtobufWatchActivities>({
  startToCloseTimeout: "1 minute",
  retry: { maximumAttempts: 3 },
});
const { deliverActivityReport } = proxyActivities<ReportDeliveryActivities>({
  startToCloseTimeout: "2 minutes",
  retry: { maximumAttempts: 3 },
});

function failureReport(startedAt: string, error: unknown): ActivityReportInput {
  const message = error instanceof Error ? error.message : String(error);
  const observedAt = new Date().toISOString();
  return {
    reportType: "protobufjs-v8-watch",
    title: "Temporal protobufjs v8 compatibility",
    scheduleId: "protobufjs-v8-watch-weekly",
    startedAt,
    execution: "failed",
    verdict: "inconclusive",
    headline: "The npm compatibility check failed.",
    checks: [
      {
        id: "npm-metadata",
        label: "Published @temporalio/proto metadata",
        required: true,
        status: "failed",
        summary: message,
        evidenceReceiptIds: ["npm-failure"],
      },
    ],
    evidence: [
      {
        id: "npm-failure",
        source: "npm registry",
        observedAt,
        status: "failure",
        excerpt: message.slice(0, 2000),
      },
    ],
    findings: [],
    limitations: ["Current @temporalio/proto metadata is unavailable."],
    actions: ["Inspect the registry failure and rerun the schedule."],
    provenance: { source: "https://registry.npmjs.org" },
  };
}

export async function runProtobufWatch(): Promise<void> {
  const startedAt = new Date().toISOString();
  try {
    const result = await collectProtobufWatch();
    await deliverActivityReport(protobufWatchReport(startedAt, result));
  } catch (error) {
    await deliverActivityReport(failureReport(startedAt, error));
    throw error;
  }
}

export function protobufWatchReport(
  startedAt: string,
  result: Awaited<ReturnType<ProtobufWatchActivities["collectProtobufWatch"]>>,
): ActivityReportInput {
  return {
    reportType: "protobufjs-v8-watch",
    title: "Temporal protobufjs v8 compatibility",
    scheduleId: "protobufjs-v8-watch-weekly",
    startedAt,
    execution: "complete",
    verdict: result.supportsV8 ? "attention" : "pending",
    headline: `@temporalio/proto ${result.packageVersion} declares protobufjs ${result.protobufjsRange}; v8 is ${result.supportsV8 ? "accepted" : "not accepted"}.`,
    checks: [
      {
        id: "npm-metadata",
        label: "Published @temporalio/proto metadata",
        required: true,
        status: "passed",
        summary: `${result.packageVersion} -> protobufjs ${result.protobufjsRange}`,
        evidenceReceiptIds: ["npm-metadata"],
      },
    ],
    evidence: [
      {
        id: "npm-metadata",
        source: "npm registry @temporalio/proto latest metadata",
        observedAt: result.observedAt,
        status: "success",
        url: result.sourceUrl,
        excerpt: result.evidenceJson.slice(0, 2000),
      },
    ],
    findings: result.supportsV8
      ? [
          {
            severity: "warning",
            summary: "protobufjs v8 is now accepted upstream",
            detail:
              "Remove the root v7 override and Renovate guard, then verify Temporal payload serialization.",
            evidenceReceiptIds: ["npm-metadata"],
          },
        ]
      : [],
    limitations: [],
    actions: result.supportsV8
      ? ["Complete the protobufjs-v8-watch todo migration steps."]
      : [],
    retirementRecommendation: result.supportsV8
      ? "Retire this schedule after the v8 migration ships and runtime payload verification passes."
      : undefined,
    provenance: { source: result.sourceUrl, query: "latest" },
  };
}
