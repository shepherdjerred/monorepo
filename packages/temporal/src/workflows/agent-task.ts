import { patched, proxyActivities, sleep } from "@temporalio/workflow";
import type { AgentTaskActivities } from "#activities/agent-task.ts";
import type { RunAgentTaskResult } from "#shared/agent-task-result-types.ts";
import type { AgentTaskInput } from "#shared/agent-task.ts";
import { collectErrorMessages } from "#shared/error-cause.ts";
import { AGENT_REPORT_DELIVERY_START_TO_CLOSE_MS } from "#shared/report-delivery-policy.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const RETRY = {
  maximumAttempts: 2,
  initialInterval: "1 minute" as const,
  backoffCoefficient: 2,
  maximumInterval: "10 minutes" as const,
};

const BOUNDED_AGENT_RETRY = {
  maximumAttempts: 1,
};

const workdirActivities = proxyActivities<AgentTaskActivities>({
  startToCloseTimeout: "10 minutes",
  retry: RETRY,
});

export function agentActivityRetryFor(
  input: Pick<AgentTaskInput, "agentTimeoutMinutes">,
): typeof RETRY | typeof BOUNDED_AGENT_RETRY {
  return input.agentTimeoutMinutes === undefined ? RETRY : BOUNDED_AGENT_RETRY;
}

export function agentTaskFailureStageFor(input: {
  v2Reporting: boolean;
  reportAttempted: boolean;
  reportDelivered: boolean;
  postDeliveryFailureReporting: boolean;
}): "execution" | "follow-up-dispatch" | undefined {
  if (!input.v2Reporting) {
    return undefined;
  }
  if (!input.reportAttempted) {
    return "execution";
  }
  if (input.reportDelivered && input.postDeliveryFailureReporting) {
    return "follow-up-dispatch";
  }
  return undefined;
}

function agentActivitiesFor(
  input: AgentTaskInput,
): Pick<
  AgentTaskActivities,
  "runAgentTask" | "investigateAgentTask" | "finalizeAgentTask"
> {
  const timeoutMinutes = input.agentTimeoutMinutes ?? 90;
  return proxyActivities<AgentTaskActivities>({
    startToCloseTimeout: timeoutMinutes * 60 * 1000,
    heartbeatTimeout: "60 seconds",
    retry: agentActivityRetryFor(input),
  });
}

async function executeAgentTask(
  input: AgentTaskInput,
  workdir: string,
  twoPhaseV2: boolean,
): Promise<RunAgentTaskResult> {
  const activities = agentActivitiesFor(input);
  if (!twoPhaseV2 || input.contractVersion !== 2) {
    return activities.runAgentTask({ input, workdir });
  }
  const investigation = await activities.investigateAgentTask({
    input,
    workdir,
  });
  return activities.finalizeAgentTask({ input, workdir, investigation });
}

const legacyEmailActivities = proxyActivities<AgentTaskActivities>({
  startToCloseTimeout: AGENT_REPORT_DELIVERY_START_TO_CLOSE_MS,
  retry: RETRY,
});

const reportEmailActivities = proxyActivities<AgentTaskActivities>({
  taskQueue: TASK_QUEUES.REPORTS,
  startToCloseTimeout: AGENT_REPORT_DELIVERY_START_TO_CLOSE_MS,
  retry: RETRY,
});

// Deferral of a future `runAt` is owned by the scheduler via the Temporal
// server's `startDelay` (see `startOrScheduleAgentTask`), which strips `runAt`
// from the args this workflow receives — so in normal operation this is a no-op
// that returns immediately. It stays as a defensive fallback for a direct
// invocation that still carries a (small) `runAt`. Do NOT rely on this to defer
// a far-future task: an in-workflow sleep runs against the run timeout and would
// be terminated mid-wait — that was the original bug.
async function waitUntilRunAt(runAt: string | undefined): Promise<void> {
  if (runAt === undefined) {
    return;
  }
  const delayMs = Date.parse(runAt) - Date.now();
  if (delayMs > 0) {
    await sleep(delayMs);
  }
}

async function dispatchFollowUp(
  input: AgentTaskInput,
  result: RunAgentTaskResult,
  allowLegacySelfCancel: boolean,
): Promise<void> {
  const payload = result.payload;
  if (payload.followUp !== undefined) {
    await workdirActivities.scheduleAgentTaskFollowUp({
      parent: input,
      followUp: payload.followUp,
    });
  }

  if (
    allowLegacySelfCancel &&
    result.contractVersion === 1 &&
    "cancelCron" in payload &&
    payload.cancelCron === true &&
    input.allowSelfCancel &&
    input.scheduleId !== undefined
  ) {
    await workdirActivities.pauseAgentTaskSchedule({
      scheduleId: input.scheduleId,
      reason:
        payload.cancelReason ??
        `Agent task "${input.title}" requested schedule pause`,
    });
  }
}

export async function agentTaskWorkflow(input: AgentTaskInput): Promise<void> {
  const v2Reporting = patched("agent-task-report-v2");
  const twoPhaseV2 = patched("agent-task-two-phase-v2");
  const requireV2 = patched("agent-task-require-v2");
  const coreEmailDelivery = patched("agent-task-core-email-delivery");
  const postDeliveryFailureReporting = patched(
    "agent-task-post-delivery-failure-report",
  );
  const emailActivities = coreEmailDelivery
    ? reportEmailActivities
    : legacyEmailActivities;
  await waitUntilRunAt(input.runAt);
  const startedAt = new Date().toISOString();
  let workdir:
    | Awaited<ReturnType<AgentTaskActivities["prepareAgentTaskWorkdir"]>>
    | undefined;
  let reportAttempted = false;
  let reportDelivered = false;
  let failureReportAttempted = false;
  let terminalFailure: { error: unknown } | undefined;

  try {
    if (requireV2 && input.contractVersion !== 2) {
      throw new Error(
        "New agent task executions require contractVersion 2; v1 is replay-only",
      );
    }
    workdir = await workdirActivities.prepareAgentTaskWorkdir({ input });
    const result = await executeAgentTask(input, workdir.workdir, twoPhaseV2);
    reportAttempted = true;
    await emailActivities.sendAgentTaskEmail({ input, result });
    reportDelivered = true;
    await dispatchFollowUp(input, result, !v2Reporting);
  } catch (error: unknown) {
    terminalFailure = { error };
    const failureStage = agentTaskFailureStageFor({
      v2Reporting,
      reportAttempted,
      reportDelivered,
      postDeliveryFailureReporting,
    });
    if (failureStage !== undefined) {
      failureReportAttempted = true;
      try {
        await emailActivities.sendAgentTaskFailureReport({
          input,
          startedAt,
          error:
            error instanceof Error
              ? collectErrorMessages(error)
              : String(error),
          ...(failureStage === "follow-up-dispatch" ? { failureStage } : {}),
        });
      } catch (failureReportError: unknown) {
        terminalFailure = { error: failureReportError };
      }
    }
  }

  if (workdir !== undefined) {
    try {
      await workdirActivities.cleanupAgentTaskWorkdir(workdir);
    } catch (error: unknown) {
      if (
        v2Reporting &&
        reportDelivered &&
        postDeliveryFailureReporting &&
        !failureReportAttempted
      ) {
        try {
          await emailActivities.sendAgentTaskFailureReport({
            input,
            startedAt,
            error:
              error instanceof Error
                ? collectErrorMessages(error)
                : String(error),
            failureStage: "workdir-cleanup",
          });
        } catch (failureReportError: unknown) {
          terminalFailure = { error: failureReportError };
        }
      }
      terminalFailure ??= { error };
    }
  }

  if (terminalFailure !== undefined) {
    throw terminalFailure.error;
  }
}
