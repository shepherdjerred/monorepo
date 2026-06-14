import { proxyActivities, sleep } from "@temporalio/workflow";
import type {
  AgentTaskActivities,
  RunAgentTaskResult,
} from "#activities/agent-task.ts";
import type { AgentTaskInput } from "#shared/agent-task.ts";

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

function agentActivitiesFor(
  input: AgentTaskInput,
): Pick<AgentTaskActivities, "runAgentTask"> {
  const timeoutMinutes = input.agentTimeoutMinutes ?? 90;
  return proxyActivities<AgentTaskActivities>({
    startToCloseTimeout: timeoutMinutes * 60 * 1000,
    heartbeatTimeout: "60 seconds",
    retry: agentActivityRetryFor(input),
  });
}

const emailActivities = proxyActivities<AgentTaskActivities>({
  startToCloseTimeout: "2 minutes",
  retry: RETRY,
});

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
): Promise<void> {
  if (result.followUp !== undefined) {
    await workdirActivities.scheduleAgentTaskFollowUp({
      parent: input,
      followUp: result.followUp,
    });
  }

  if (
    result.cancelCron === true &&
    input.allowSelfCancel &&
    input.scheduleId !== undefined
  ) {
    await workdirActivities.pauseAgentTaskSchedule({
      scheduleId: input.scheduleId,
      reason:
        result.cancelReason ??
        `Agent task "${input.title}" requested schedule pause`,
    });
  }
}

export async function agentTaskWorkflow(input: AgentTaskInput): Promise<void> {
  await waitUntilRunAt(input.runAt);
  const workdir = await workdirActivities.prepareAgentTaskWorkdir({ input });

  try {
    const result = await agentActivitiesFor(input).runAgentTask({
      input,
      workdir: workdir.workdir,
    });
    await emailActivities.sendAgentTaskEmail({ input, result });
    await dispatchFollowUp(input, result);
  } finally {
    await workdirActivities.cleanupAgentTaskWorkdir(workdir);
  }
}
