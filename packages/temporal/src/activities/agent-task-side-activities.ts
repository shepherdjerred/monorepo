import * as Sentry from "@sentry/bun";
import { createTemporalClient } from "#client";
import { startOrScheduleAgentTask } from "#lib/agent-task-scheduler.ts";
import {
  agentTaskEmailSentTotal,
  agentTaskRunsTotal,
} from "#observability/metrics.ts";
import { cleanupWorkdir } from "#lib/pr-review-workdir.ts";
import {
  AgentTaskInputSchema,
  type AgentTaskFollowUp,
  type AgentTaskInput,
  type AgentTaskStartResult,
} from "#shared/agent-task.ts";
import { renderAuditMarkdownToHtml } from "#shared/markdown-to-html.ts";
import { resolvePostalAddresses, sendPostalEmail } from "#shared/postal.ts";
import type {
  PrepareAgentTaskWorkdirResult,
  RunAgentTaskResult,
} from "./agent-task.ts";

const COMPONENT = "agent-task";

export type SendAgentTaskEmailInput = {
  input: AgentTaskInput;
  result: RunAgentTaskResult;
};

export type SendAgentTaskEmailResult = {
  subject: string;
  messageId: string;
  recipientId: number | "unknown";
};

export type ScheduleAgentTaskFollowUpInput = {
  parent: AgentTaskInput;
  followUp: AgentTaskFollowUp;
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

export async function sendEmail(
  input: SendAgentTaskEmailInput,
): Promise<SendAgentTaskEmailResult> {
  const { recipient, sender } = resolvePostalAddresses();
  const date = new Date().toISOString().slice(0, 10);
  const prefix = input.input.emailSubjectPrefix ?? "Agent Task";
  const subject = `${prefix}: ${input.input.title} (${date})`;
  const body = [
    `# ${input.input.title}`,
    "",
    `Provider: ${input.result.provider}`,
    `Model: ${input.result.model}`,
    `Duration: ${String(Math.round(input.result.durationMs / 1000))}s`,
    "",
    input.result.markdown,
  ].join("\n");

  try {
    const result = await sendPostalEmail({
      to: recipient,
      from: sender,
      subject,
      htmlBody: renderAuditMarkdownToHtml(body),
      tag: "agent-task",
    });
    agentTaskEmailSentTotal.inc({ outcome: "success" });
    return {
      subject: result.subject,
      messageId: result.messageId,
      recipientId: result.recipientId,
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

export async function scheduleFollowUp(
  input: ScheduleAgentTaskFollowUpInput,
): Promise<AgentTaskStartResult> {
  const task = AgentTaskInputSchema.parse({
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
  });
  const client = await createTemporalClient();
  return await startOrScheduleAgentTask(client, task);
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
