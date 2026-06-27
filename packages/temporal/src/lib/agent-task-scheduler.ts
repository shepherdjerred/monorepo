import type { Client } from "@temporalio/client";
import {
  ScheduleNotFoundError,
  ScheduleOverlapPolicy,
  WorkflowIdConflictPolicy,
  WorkflowIdReusePolicy,
} from "@temporalio/client";
import type { Duration } from "@temporalio/common";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import {
  AgentTaskInputSchema,
  DYNAMIC_AGENT_TASK_MEMO_KEY,
  agentTaskScheduleId,
  agentTaskWorkflowId,
  type AgentTaskInput,
  type AgentTaskStartResult,
} from "#shared/agent-task.ts";

const DEFAULT_WORKFLOW_TIMEOUT: Duration = "2 hours";
export const AGENT_TASK_SCHEDULE_TIMEZONE = "America/Los_Angeles";

function workflowArgsForSchedule(
  input: AgentTaskInput,
  scheduleId: string,
): AgentTaskInput {
  return AgentTaskInputSchema.parse({
    ...input,
    scheduleId,
    runAt: undefined,
  });
}

export async function startOrScheduleAgentTask(
  client: Client,
  rawInput: AgentTaskInput,
): Promise<AgentTaskStartResult> {
  const input = AgentTaskInputSchema.parse(rawInput);

  if (input.cron !== undefined) {
    const scheduleId = await agentTaskScheduleId(input);
    const args = [workflowArgsForSchedule(input, scheduleId)];
    const scheduleClient = client.schedule;

    try {
      const handle = scheduleClient.getHandle(scheduleId);
      await handle.update((prev) => ({
        ...prev,
        spec: {
          cronExpressions: [input.cron ?? ""],
          timezone: AGENT_TASK_SCHEDULE_TIMEZONE,
        },
        action: {
          type: "startWorkflow",
          workflowType: "agentTaskWorkflow",
          args,
          taskQueue: TASK_QUEUES.AGENT_TASK,
          workflowExecutionTimeout: DEFAULT_WORKFLOW_TIMEOUT,
        },
        policies: {
          overlap: ScheduleOverlapPolicy.SKIP,
        },
      }));
    } catch (error: unknown) {
      if (!(error instanceof ScheduleNotFoundError)) {
        throw error;
      }
      await scheduleClient.create({
        scheduleId,
        spec: {
          cronExpressions: [input.cron],
          timezone: AGENT_TASK_SCHEDULE_TIMEZONE,
        },
        action: {
          type: "startWorkflow",
          workflowType: "agentTaskWorkflow",
          args,
          taskQueue: TASK_QUEUES.AGENT_TASK,
          workflowExecutionTimeout: DEFAULT_WORKFLOW_TIMEOUT,
        },
        policies: {
          overlap: ScheduleOverlapPolicy.SKIP,
        },
        // Schedule memo is immutable after creation (ScheduleUpdateOptions omits
        // it), so the dynamic marker can only be stamped here, on create. The
        // update branch above relies on `...prev` preserving this memo, and
        // orphan detection falls back to the `agent-task-` id prefix for any
        // auto-generated schedule that predates this marker.
        memo: {
          description: `Agent task: ${input.title}`,
          source: input.source,
          [DYNAMIC_AGENT_TASK_MEMO_KEY]: true,
        },
      });
    }

    return { kind: "schedule", scheduleId };
  }

  const workflowId = await agentTaskWorkflowId(input);
  const handle = await client.workflow.start("agentTaskWorkflow", {
    args: [input],
    taskQueue: TASK_QUEUES.AGENT_TASK,
    workflowId,
    workflowExecutionTimeout: DEFAULT_WORKFLOW_TIMEOUT,
    workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
    workflowIdConflictPolicy: WorkflowIdConflictPolicy.FAIL,
  });

  return {
    kind: "workflow",
    workflowId: handle.workflowId,
    runId: handle.firstExecutionRunId,
  };
}
