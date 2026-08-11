import { patched, proxyActivities } from "@temporalio/workflow";
import type {
  HomelabAuditActivities,
  HomelabAuditAgentInput,
} from "#activities/homelab-audit.ts";
import type { HomelabAuditCollectorActivities } from "#activities/homelab-audit-collectors.ts";
import { buildHomelabAuditReport } from "#activities/homelab-audit-report.ts";
import type {
  ActivityReportInput,
  ReportDeliveryActivities,
} from "#activities/report-delivery.ts";

const RETRY = {
  maximumAttempts: 3,
  initialInterval: "1 minute" as const,
  backoffCoefficient: 2,
  maximumInterval: "10 minutes" as const,
};

const { runHomelabAuditPreflight } = proxyActivities<HomelabAuditActivities>({
  startToCloseTimeout: "2 minutes",
  retry: RETRY,
});
const { runHomelabAuditAgent } = proxyActivities<HomelabAuditActivities>({
  startToCloseTimeout: "45 minutes",
  heartbeatTimeout: "60 seconds",
  retry: RETRY,
});
const { archiveHomelabAuditBody, sendHomelabAuditEmail } =
  proxyActivities<HomelabAuditActivities>({
    startToCloseTimeout: "2 minutes",
    retry: RETRY,
  });
const { archiveHomelabAuditMetadata } = proxyActivities<HomelabAuditActivities>(
  { startToCloseTimeout: "1 minute", retry: RETRY },
);
const { synthesizeHomelabAuditEvidence } =
  proxyActivities<HomelabAuditActivities>({
    startToCloseTimeout: "2 minutes",
    retry: { maximumAttempts: 2 },
  });
const { collectHomelabAuditEvidence } =
  proxyActivities<HomelabAuditCollectorActivities>({
    startToCloseTimeout: "8 minutes",
    retry: RETRY,
  });
const { deliverActivityReport } = proxyActivities<ReportDeliveryActivities>({
  startToCloseTimeout: "2 minutes",
  retry: RETRY,
});

export type RunHomelabAuditWorkflowInput = {
  date?: string;
};

async function runLegacyHomelabAudit(
  input: RunHomelabAuditWorkflowInput,
): Promise<void> {
  const agentInput: HomelabAuditAgentInput = {};
  if (input.date !== undefined) agentInput.date = input.date;
  const preflight = await runHomelabAuditPreflight();
  agentInput.toolingPreflightMarkdown = preflight.markdown;
  const agent = await runHomelabAuditAgent(agentInput);
  const date = input.date ?? new Date().toISOString().slice(0, 10);
  const bodyArchive = await archiveHomelabAuditBody({
    date,
    markdown: agent.markdown,
  });
  const email = await sendHomelabAuditEmail({ date, markdown: agent.markdown });
  await archiveHomelabAuditMetadata({ date, bodyArchive, email, agent });
}

function failureReport(startedAt: string, error: unknown): ActivityReportInput {
  const message = error instanceof Error ? error.message : String(error);
  const observedAt = new Date().toISOString();
  return {
    reportType: "homelab-audit",
    title: "Daily homelab audit",
    scheduleId: "homelab-audit-daily",
    startedAt,
    execution: "failed",
    verdict: "inconclusive",
    headline:
      "Homelab evidence collection failed; no clean conclusion was made.",
    checks: [
      {
        id: "collector-run",
        label: "Homelab evidence collectors",
        required: true,
        status: "failed",
        summary: message,
        evidenceReceiptIds: ["collector-failure"],
      },
    ],
    evidence: [
      {
        id: "collector-failure",
        source: "homelab audit workflow",
        observedAt,
        status: "failure",
        excerpt: message.slice(0, 2000),
      },
    ],
    findings: [],
    limitations: [
      "The six required collectors did not all return typed results.",
    ],
    actions: ["Inspect the failed activity and rerun the schedule."],
    provenance: { source: "homelab audit workflow" },
  };
}

export async function runHomelabAuditWorkflow(
  input: RunHomelabAuditWorkflowInput = {},
): Promise<void> {
  if (!patched("homelab-audit-deterministic-v1")) {
    return runLegacyHomelabAudit(input);
  }
  const startedAt = new Date().toISOString();
  try {
    const collection = await collectHomelabAuditEvidence();
    const synthesis = await synthesizeHomelabAuditEvidence(collection);
    await deliverActivityReport(buildHomelabAuditReport(collection, synthesis));
  } catch (error) {
    await deliverActivityReport(failureReport(startedAt, error));
    throw error;
  }
}
