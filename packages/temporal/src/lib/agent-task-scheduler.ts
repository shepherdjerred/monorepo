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

// A future `runAt` is deferred by the Temporal server via `startDelay`, NOT by
// an in-workflow `sleep`. The workflow therefore starts at `runAt` and never
// sleeps, so `runAt` is stripped from the args it receives (mirrors
// `workflowArgsForSchedule`). Deferring server-side means the run-timeout clock
// only starts once the agent actually begins — a far-future task can no longer
// be killed mid-wait (the bug this replaces: a 2h execution timeout terminated
// the sleeping workflow days before `runAt`).
function workflowArgsForOneOff(input: AgentTaskInput): AgentTaskInput {
  return AgentTaskInputSchema.parse({
    ...input,
    runAt: undefined,
  });
}

// Non-workflow (client/activity) context — `Date.now()` is allowed here.
// Returns undefined for a past/immediate `runAt` so the workflow starts now.
function startDelayFor(runAt: string | undefined): Duration | undefined {
  if (runAt === undefined) {
    return undefined;
  }
  const delayMs = Date.parse(runAt) - Date.now();
  return delayMs > 0 ? delayMs : undefined;
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
          workflowRunTimeout: DEFAULT_WORKFLOW_TIMEOUT,
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
          workflowRunTimeout: DEFAULT_WORKFLOW_TIMEOUT,
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

  // Id is derived from the original input (incl. `runAt`) so idempotency is
  // unchanged; the workflow itself receives args with `runAt` stripped.
  const workflowId = await agentTaskWorkflowId(input);
  // `startDelay` is only included when there is a future delay: under
  // exactOptionalPropertyTypes an explicit `startDelay: undefined` is a type
  // error (and would also differ semantically from omitting it).
  const startDelay = startDelayFor(input.runAt);
  const handle = await client.workflow.start("agentTaskWorkflow", {
    args: [workflowArgsForOneOff(input)],
    taskQueue: TASK_QUEUES.AGENT_TASK,
    workflowId,
    ...(startDelay === undefined ? {} : { startDelay }),
    // `workflowRunTimeout` (per-run) rather than `workflowExecutionTimeout`: the
    // 2h bound applies to the actual run once it starts, never to the buffered
    // `startDelay`, so a future-dated task cannot time out before it runs.
    workflowRunTimeout: DEFAULT_WORKFLOW_TIMEOUT,
    // Allow a previously failed/timed-out run of the same id to be retried by
    // resubmission, while still rejecting duplicate concurrent or already-
    // succeeded runs.
    workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE_FAILED_ONLY,
    workflowIdConflictPolicy: WorkflowIdConflictPolicy.FAIL,
  });

  return {
    kind: "workflow",
    workflowId: handle.workflowId,
    runId: handle.firstExecutionRunId,
  };
}
