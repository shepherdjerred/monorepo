import { proxyActivities, sleep } from "@temporalio/workflow";
import type { AgentTaskActivities } from "#activities/agent/agent-task.ts";
import type { RunAgentTaskResult } from "#shared/agent/agent-task-result-types.ts";
import type { AgentTaskInput } from "#shared/agent/agent-task.ts";
import { collectErrorMessages } from "#shared/error-cause.ts";
import { AGENT_REPORT_DELIVERY_START_TO_CLOSE_MS } from "#shared/reports/report-delivery-policy.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { setWorkflowPhase } from "@scout-for-lol/temporal/workflow-ui-interceptor";

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
  taskQueue: TASK_QUEUES.AGENT_TASK,
  startToCloseTimeout: "10 minutes",
  retry: RETRY,
});

export function agentActivityRetryFor(
  input: Pick<AgentTaskInput, "agentTimeoutMinutes">,
): typeof RETRY | typeof BOUNDED_AGENT_RETRY {
  return input.agentTimeoutMinutes === undefined ? RETRY : BOUNDED_AGENT_RETRY;
}

export function agentTaskFailureStageFor(input: {
  reportAttempted: boolean;
  reportDelivered: boolean;
}): "execution" | "follow-up-dispatch" | undefined {
  if (!input.reportAttempted) {
    return "execution";
  }
  return input.reportDelivered ? "follow-up-dispatch" : undefined;
}

function agentActivitiesFor(
  input: AgentTaskInput,
): Pick<AgentTaskActivities, "investigateAgentTask" | "finalizeAgentTask"> {
  const timeoutMinutes = input.agentTimeoutMinutes ?? 90;
  return proxyActivities<AgentTaskActivities>({
    taskQueue: TASK_QUEUES.AGENT_TASK,
    startToCloseTimeout: timeoutMinutes * 60 * 1000,
    heartbeatTimeout: "60 seconds",
    retry: agentActivityRetryFor(input),
  });
}

async function executeAgentTask(
  input: AgentTaskInput,
  workdir: string,
): Promise<RunAgentTaskResult> {
  const activities = agentActivitiesFor(input);
  const investigation = await activities.investigateAgentTask({
    input,
    workdir,
  });
  return activities.finalizeAgentTask({ input, workdir, investigation });
}

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
    setWorkflowPhase("**Phase:** waiting for the requested start time");
    await sleep(delayMs);
  }
}

async function dispatchFollowUp(
  input: AgentTaskInput,
  result: RunAgentTaskResult,
): Promise<void> {
  if (result.payload.followUp !== undefined) {
    await workdirActivities.scheduleAgentTaskFollowUp({
      parent: input,
      followUp: result.payload.followUp,
    });
  }
}

export async function agentTaskWorkflow(input: AgentTaskInput): Promise<void> {
  const emailActivities = reportEmailActivities;
  await waitUntilRunAt(input.runAt);
  setWorkflowPhase("**Phase:** preparing an isolated work directory");
  const startedAt = new Date().toISOString();
  let workdir:
    | Awaited<ReturnType<AgentTaskActivities["prepareAgentTaskWorkdir"]>>
    | undefined;
  let reportAttempted = false;
  let reportDelivered = false;
  let failureReportAttempted = false;
  let terminalFailure: { error: unknown } | undefined;

  try {
    if (input.contractVersion !== 2) {
      throw new Error(
        "New agent task executions require contractVersion 2; v1 is replay-only",
      );
    }
    workdir = await workdirActivities.prepareAgentTaskWorkdir({ input });
    setWorkflowPhase("**Phase:** running the agent task");
    const result = await executeAgentTask(input, workdir.workdir);
    setWorkflowPhase("**Phase:** delivering the agent task report");
    reportAttempted = true;
    await emailActivities.sendAgentTaskEmail({ input, result });
    reportDelivered = true;
    await dispatchFollowUp(input, result);
  } catch (error: unknown) {
    terminalFailure = { error };
    const failureStage = agentTaskFailureStageFor({
      reportAttempted,
      reportDelivered,
    });
    if (failureStage !== undefined) {
      setWorkflowPhase("**Phase:** reporting an agent task failure");
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
    setWorkflowPhase("**Phase:** cleaning up the agent task work directory");
    try {
      await workdirActivities.cleanupAgentTaskWorkdir(workdir);
    } catch (error: unknown) {
      if (reportDelivered && !failureReportAttempted) {
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
