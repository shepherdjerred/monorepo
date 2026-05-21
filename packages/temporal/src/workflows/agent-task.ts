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

const workdirActivities = proxyActivities<AgentTaskActivities>({
  startToCloseTimeout: "10 minutes",
  retry: RETRY,
});

const agentActivities = proxyActivities<AgentTaskActivities>({
  startToCloseTimeout: "90 minutes",
  heartbeatTimeout: "60 seconds",
  retry: RETRY,
});

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
    const result = await agentActivities.runAgentTask({
      input,
      workdir: workdir.workdir,
    });
    await emailActivities.sendAgentTaskEmail({ input, result });
    await dispatchFollowUp(input, result);
  } finally {
    await workdirActivities.cleanupAgentTaskWorkdir(workdir);
  }
}
