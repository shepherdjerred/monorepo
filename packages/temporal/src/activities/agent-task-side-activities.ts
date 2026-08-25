import * as Sentry from "@sentry/bun";
import {
  WorkflowIdConflictPolicy,
  WorkflowIdReusePolicy,
} from "@temporalio/client";
import { z } from "zod/v4";
import { createTemporalClient } from "#client";
import { startOrScheduleAgentTask } from "#lib/agent-task-scheduler.ts";
import {
  agentTaskEmailSentTotal,
  agentTaskRunsTotal,
} from "#observability/metrics.ts";
import { cleanupWorkdir } from "#lib/pr-review-workdir.ts";
import {
  AgentTaskInputSchema,
  AgentTaskInputV2Schema,
  AgentTaskProviderSchema,
  AgentTaskResultPayloadSchema,
  AgentTaskFollowUpV2Schema,
  type AgentTaskFollowUp,
  type AgentTaskFollowUpV2,
  type AgentTaskInput,
  type AgentTaskStartResult,
} from "#shared/agent-task.ts";
import { normalizeAgentTaskV2Result } from "#shared/agent-task-evidence.ts";
import type { NormalizedAgentTaskV2Result } from "#shared/agent-task-evidence.ts";
import {
  createActivityReportEnvelope,
  ReportDeliveryResultSchema,
} from "./report-delivery.ts";
import type {
  ActivityReportInput,
  ReportDeliveryResult,
} from "./report-delivery.ts";
import type { RunAgentTaskResult } from "#shared/agent-task-result-types.ts";
import type { PrepareAgentTaskWorkdirResult } from "./agent-task-workdir.ts";
import {
  ReportEnvelopeV1Schema,
  type ReportEnvelopeV1,
} from "#shared/report.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const COMPONENT = "agent-task";

export type SendAgentTaskEmailInput = {
  input: AgentTaskInput;
  result: RunAgentTaskResult | LegacyRunAgentTaskResult;
};

const LegacyRunAgentTaskResultSchema = AgentTaskResultPayloadSchema.extend({
  provider: AgentTaskProviderSchema,
  model: z.string().min(1),
  durationMs: z.number().nonnegative(),
});
type LegacyRunAgentTaskResult = z.infer<typeof LegacyRunAgentTaskResultSchema>;
type RunAgentTaskResultV1 = Extract<RunAgentTaskResult, { contractVersion: 1 }>;
type RunAgentTaskResultV2 = Extract<RunAgentTaskResult, { contractVersion: 2 }>;

export type SendAgentTaskEmailResult = {
  subject: string;
  messageId: string;
  recipientId: number | "unknown";
  reportRunId: string;
  receiptKey: string;
};

export type ScheduleAgentTaskFollowUpInput = {
  parent: AgentTaskInput;
  followUp: AgentTaskFollowUp | AgentTaskFollowUpV2;
};

export type SendAgentTaskFailureReportInput = {
  input: AgentTaskInput;
  startedAt: string;
  error: string;
  /** Optional for replay compatibility with activity inputs recorded before it existed. */
  failureStage?: "execution" | "follow-up-dispatch" | "workdir-cleanup";
};

export type PauseAgentTaskScheduleInput = {
  scheduleId: string;
  reason: string;
};

function captureWithSubject(error: unknown, subject: string): void {
  Sentry.withScope((scope) => {
    scope.setTag("component", COMPONENT);
    scope.setTag("activity", "sendAgentTaskEmail");
    scope.setContext("agentTaskEmail", { subject });
    Sentry.captureException(error);
  });
}

function normalizeRunResult(
  result: RunAgentTaskResult | LegacyRunAgentTaskResult,
): RunAgentTaskResult {
  if ("contractVersion" in result) return result;
  const legacy = LegacyRunAgentTaskResultSchema.parse(result);
  const payload = AgentTaskResultPayloadSchema.parse(legacy);
  return {
    ...payload,
    contractVersion: 1,
    payload,
    provider: legacy.provider,
    model: legacy.model,
    durationMs: legacy.durationMs,
    startedAt: new Date().toISOString(),
    evidence: [],
  };
}

function reportBase(
  input: AgentTaskInput,
  runResult: RunAgentTaskResult,
  title: string,
): Pick<
  ActivityReportInput,
  | "reportType"
  | "title"
  | "scheduleId"
  | "startedAt"
  | "evidence"
  | "provenance"
> {
  const source =
    input.source?.docPath ?? input.source?.url ?? input.source?.note;
  return {
    reportType: "agent-task",
    title,
    ...(input.scheduleId === undefined ? {} : { scheduleId: input.scheduleId }),
    startedAt: runResult.startedAt,
    evidence: runResult.evidence,
    provenance: {
      ...(source === undefined ? {} : { source }),
      query: `provider=${runResult.provider}; model=${runResult.model}; duration=${String(Math.round(runResult.durationMs / 1000))}s`,
    },
  };
}

function legacyReportInput(
  input: AgentTaskInput,
  runResult: RunAgentTaskResultV1,
  title: string,
): ActivityReportInput {
  const legacyMarkdown = runResult.payload.markdown;
  const legacyEvidenceId = "legacy-agent-output";
  return {
    ...reportBase(input, runResult, title),
    execution: "partial",
    verdict: "inconclusive",
    headline:
      "A legacy agent completed, but its output has no declared coverage contract.",
    checks: [
      {
        id: "legacy-agent-output",
        label: "Legacy agent output",
        required: true,
        status: "skipped",
        summary: "Contract v1 did not declare checks or evidence requirements.",
        evidenceReceiptIds: [],
      },
    ],
    evidence: [
      ...runResult.evidence,
      {
        id: legacyEvidenceId,
        source: "legacy agent structured output",
        observedAt: runResult.startedAt,
        status: "success",
        excerpt: legacyMarkdown.slice(0, 2000),
      },
    ],
    findings: [
      {
        severity: "info",
        summary: "Legacy agent response",
        detail: legacyMarkdown.slice(0, 2000),
        evidenceReceiptIds: [legacyEvidenceId],
      },
    ],
    limitations: [
      "This replay-compatible v1 run cannot support a clean verdict.",
    ],
    actions: [],
  };
}

function v2ReportInput(
  input: AgentTaskInput,
  runResult: RunAgentTaskResultV2,
  title: string,
  normalized: NormalizedAgentTaskV2Result,
): ActivityReportInput {
  return {
    ...reportBase(input, runResult, title),
    execution: normalized.execution,
    verdict: normalized.verdict,
    headline: normalized.headline,
    checks: normalized.checks,
    findings: normalized.findings,
    limitations: normalized.limitations,
    actions: normalized.actions,
    ...(normalized.synthesis === undefined
      ? {}
      : { synthesis: normalized.synthesis }),
    ...(normalized.retirementRecommendation === undefined
      ? {}
      : { retirementRecommendation: normalized.retirementRecommendation }),
  };
}

function agentTaskReportInput(
  input: AgentTaskInput,
  runResult: RunAgentTaskResult,
  title: string,
): ActivityReportInput {
  if (runResult.contractVersion === 1) {
    return legacyReportInput(input, runResult, title);
  }
  return v2ReportInput(
    input,
    runResult,
    title,
    normalizeAgentTaskV2Result(input, runResult.payload, runResult.evidence),
  );
}

export type AgentTaskReportDeliveryWorkflowOptions = {
  args: [ReportEnvelopeV1];
  taskQueue: typeof TASK_QUEUES.REPORTS;
  workflowId: string;
  workflowIdReusePolicy: WorkflowIdReusePolicy;
  workflowIdConflictPolicy: WorkflowIdConflictPolicy;
};

export type AgentTaskReportDeliveryDependencies = {
  execute: (
    options: AgentTaskReportDeliveryWorkflowOptions,
  ) => Promise<unknown>;
};

export function agentTaskReportDeliveryWorkflowOptions(
  rawReport: ReportEnvelopeV1,
): AgentTaskReportDeliveryWorkflowOptions {
  const report = ReportEnvelopeV1Schema.parse(rawReport);
  return {
    args: [report],
    taskQueue: TASK_QUEUES.REPORTS,
    workflowId: `report-delivery:${report.reportRunId}`,
    // An activity retry after accepted delivery may start a new execution. The
    // shared sender's S3 receipt check turns it into a deterministic dedupe.
    workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE,
    // If delivery is still running, wait on that execution instead of racing a
    // second sender.
    workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
  };
}

export async function deliverAgentTaskReportWithDependencies(
  report: ReportEnvelopeV1,
  dependencies: AgentTaskReportDeliveryDependencies,
): Promise<ReportDeliveryResult> {
  return ReportDeliveryResultSchema.parse(
    await dependencies.execute(agentTaskReportDeliveryWorkflowOptions(report)),
  );
}

async function deliverAgentTaskReport(
  report: ReportEnvelopeV1,
): Promise<ReportDeliveryResult> {
  const client = await createTemporalClient();
  return deliverAgentTaskReportWithDependencies(report, {
    execute: async (options) => {
      const handle = await client.workflow.start("deliverReportWorkflow", {
        ...options,
      });
      const result: unknown = await handle.result();
      return result;
    },
  });
}

export async function sendEmail(
  input: SendAgentTaskEmailInput,
): Promise<SendAgentTaskEmailResult> {
  const runResult = normalizeRunResult(input.result);
  const prefix = input.input.emailSubjectPrefix ?? "Agent Task";
  const title = `${prefix}: ${input.input.title}`;
  const envelope = createActivityReportEnvelope(
    agentTaskReportInput(input.input, runResult, title),
  );
  const subject = envelope.title;

  try {
    const result = await deliverAgentTaskReport(envelope);
    agentTaskEmailSentTotal.inc({ outcome: "success" });
    return {
      subject: result.subject,
      messageId: result.messageId,
      recipientId: result.recipientId,
      reportRunId: result.reportRunId,
      receiptKey: result.receiptKey,
    };
  } catch (error: unknown) {
    agentTaskEmailSentTotal.inc({ outcome: "failure" });
    agentTaskRunsTotal.inc({
      provider: input.result.provider,
      outcome: "email_failed",
    });
    captureWithSubject(error, subject);
    throw error;
  }
}

export async function sendFailureReport(
  input: SendAgentTaskFailureReportInput,
): Promise<SendAgentTaskEmailResult> {
  const envelope = createActivityReportEnvelope(
    agentTaskFailureReportInput(input),
  );
  const result = await deliverAgentTaskReport(envelope);
  return {
    subject: result.subject,
    messageId: result.messageId,
    recipientId: result.recipientId,
    reportRunId: result.reportRunId,
    receiptKey: result.receiptKey,
  };
}

export function agentTaskFailureReportInput(
  input: SendAgentTaskFailureReportInput,
): ActivityReportInput {
  const prefix = input.input.emailSubjectPrefix ?? "Agent Task";
  const followUpDispatchFailed = input.failureStage === "follow-up-dispatch";
  const workdirCleanupFailed = input.failureStage === "workdir-cleanup";
  const checkId = followUpDispatchFailed
    ? "agent-follow-up-dispatch"
    : workdirCleanupFailed
      ? "agent-workdir-cleanup"
      : "agent-execution";
  const checkLabel = followUpDispatchFailed
    ? "Agent follow-up dispatch"
    : workdirCleanupFailed
      ? "Agent workdir cleanup"
      : "Agent execution";
  return {
    reportType: "agent-task",
    title: `${prefix}: ${input.input.title}`,
    ...(input.input.scheduleId === undefined
      ? {}
      : { scheduleId: input.input.scheduleId }),
    startedAt: input.startedAt,
    execution: "failed",
    verdict: "attention",
    headline: followUpDispatchFailed
      ? "The validated agent report was delivered, but its requested follow-up was not scheduled."
      : workdirCleanupFailed
        ? "The validated agent report was delivered, but cleanup of its disposable workdir failed."
        : "The agent workflow failed before it could produce a validated report.",
    checks: [
      {
        id: checkId,
        label: checkLabel,
        required: true,
        status: "failed",
        summary: followUpDispatchFailed
          ? "The follow-up scheduling activity failed after report delivery."
          : workdirCleanupFailed
            ? "The workdir cleanup activity failed after report delivery."
            : "The Temporal execution failed.",
        evidenceReceiptIds: [`${checkId}-failure`],
      },
    ],
    evidence: [
      {
        id: `${checkId}-failure`,
        source: "Temporal agent-task workflow",
        observedAt: new Date().toISOString(),
        status: "failure",
        excerpt: input.error.slice(0, 2000),
      },
    ],
    findings: [],
    limitations: [
      followUpDispatchFailed
        ? `The validated result was delivered, but the requested follow-up is absent: ${input.error.slice(0, 2000)}`
        : workdirCleanupFailed
          ? `The validated result was delivered, but its disposable workdir may remain: ${input.error.slice(0, 2000)}`
          : `No validated agent result is available: ${input.error.slice(0, 2000)}`,
    ],
    actions: [
      followUpDispatchFailed
        ? "Open the linked Temporal run, inspect the failed scheduling activity, and resubmit the follow-up if it is still needed."
        : workdirCleanupFailed
          ? "Open the linked Temporal run and inspect the failed workdir cleanup activity."
          : "Open the linked Temporal run and inspect the failed activity.",
    ],
  };
}

export async function scheduleFollowUp(
  input: ScheduleAgentTaskFollowUpInput,
): Promise<AgentTaskStartResult> {
  const task = agentTaskFollowUpInput(input);
  const client = await createTemporalClient();
  return await startOrScheduleAgentTask(client, task);
}

export function agentTaskFollowUpInput(
  input: ScheduleAgentTaskFollowUpInput,
): AgentTaskInput {
  if (input.parent.contractVersion === 2) {
    AgentTaskFollowUpV2Schema.parse(input.followUp);
  }
  const rawTask = {
    ...(input.parent.contractVersion === 2
      ? { contractVersion: 2, checks: input.parent.checks }
      : {}),
    title: input.followUp.title,
    prompt: input.followUp.prompt,
    provider: input.followUp.provider ?? input.parent.provider,
    mode: "report-only",
    repo: input.parent.repo,
    runAt: input.followUp.runAt,
    cron: input.followUp.cron,
    source: input.parent.source,
    model: input.followUp.model ?? input.parent.model,
    maxTurns: input.followUp.maxTurns ?? input.parent.maxTurns,
    agentTimeoutMinutes:
      input.followUp.agentTimeoutMinutes ?? input.parent.agentTimeoutMinutes,
    allowSelfCancel: false,
    emailSubjectPrefix: input.parent.emailSubjectPrefix,
  };
  return input.parent.contractVersion === 2
    ? AgentTaskInputV2Schema.parse(rawTask)
    : AgentTaskInputSchema.parse(rawTask);
}

export async function pauseSchedule(
  input: PauseAgentTaskScheduleInput,
): Promise<void> {
  const client = await createTemporalClient();
  const handle = client.schedule.getHandle(input.scheduleId);
  await handle.pause(input.reason);
  console.warn(
    JSON.stringify({
      level: "info",
      msg: "Paused agent task schedule",
      component: COMPONENT,
      activity: "pauseAgentTaskSchedule",
      scheduleId: input.scheduleId,
      reason: input.reason,
    }),
  );
}

export async function cleanup(
  input: PrepareAgentTaskWorkdirResult,
): Promise<void> {
  await cleanupWorkdir(input.workdir);
}
