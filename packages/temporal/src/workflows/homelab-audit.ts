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
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { reportActivityTaskQueue } from "./report-activity-queue.ts";
import { setWorkflowPhase } from "@scout-for-lol/temporal/workflow-ui-interceptor";

const RETRY = {
  maximumAttempts: 3,
  initialInterval: "1 minute" as const,
  backoffCoefficient: 2,
  maximumInterval: "10 minutes" as const,
};

const { runHomelabAuditPreflight } = proxyActivities<HomelabAuditActivities>({
  taskQueue: TASK_QUEUES.INFRA,
  startToCloseTimeout: "2 minutes",
  retry: RETRY,
});
const { runHomelabAuditAgent } = proxyActivities<HomelabAuditActivities>({
  taskQueue: TASK_QUEUES.INFRA,
  startToCloseTimeout: "45 minutes",
  heartbeatTimeout: "60 seconds",
  retry: RETRY,
});
const { archiveHomelabAuditBody, sendHomelabAuditEmail } =
  proxyActivities<HomelabAuditActivities>({
    taskQueue: TASK_QUEUES.INFRA,
    startToCloseTimeout: "2 minutes",
    retry: RETRY,
  });
const { archiveHomelabAuditMetadata } = proxyActivities<HomelabAuditActivities>(
  {
    taskQueue: TASK_QUEUES.INFRA,
    startToCloseTimeout: "1 minute",
    retry: RETRY,
  },
);
const { synthesizeHomelabAuditEvidence } =
  proxyActivities<HomelabAuditActivities>({
    taskQueue: TASK_QUEUES.INFRA,
    startToCloseTimeout: "2 minutes",
    retry: { maximumAttempts: 2 },
  });
const { collectHomelabAuditEvidence } =
  proxyActivities<HomelabAuditCollectorActivities>({
    taskQueue: TASK_QUEUES.INFRA,
    startToCloseTimeout: "8 minutes",
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
  setWorkflowPhase("**Phase:** checking homelab audit prerequisites");
  const preflight = await runHomelabAuditPreflight();
  agentInput.toolingPreflightMarkdown = preflight.markdown;
  setWorkflowPhase("**Phase:** analyzing homelab evidence");
  const agent = await runHomelabAuditAgent(agentInput);
  const date = input.date ?? new Date().toISOString().slice(0, 10);
  setWorkflowPhase("**Phase:** archiving and delivering the audit report");
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
  reportTaskQueue?: string,
): Promise<void> {
  const { deliverActivityReport } = proxyActivities<ReportDeliveryActivities>({
    taskQueue: reportActivityTaskQueue(reportTaskQueue),
    startToCloseTimeout: "2 minutes",
    retry: RETRY,
  });
  if (!patched("homelab-audit-deterministic-v1")) {
    return runLegacyHomelabAudit(input);
  }
  const startedAt = new Date().toISOString();
  try {
    setWorkflowPhase("**Phase:** collecting homelab evidence");
    const collection = await collectHomelabAuditEvidence();
    setWorkflowPhase("**Phase:** synthesizing homelab findings");
    const synthesis = await synthesizeHomelabAuditEvidence(collection);
    setWorkflowPhase("**Phase:** delivering the homelab audit report");
    await deliverActivityReport(buildHomelabAuditReport(collection, synthesis));
  } catch (error) {
    await deliverActivityReport(failureReport(startedAt, error));
    throw error;
  }
}
