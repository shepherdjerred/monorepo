import {
  ScheduleNotFoundError,
  WorkflowNotFoundError,
  type Client,
  type ScheduleDescription,
  type WorkflowExecutionStatusName,
} from "@temporalio/client";
import type {
  RedditOutreachOverview,
  RedditOutreachRun,
} from "@shepherdjerred/ops-model/promotion/reddit-outreach.ts";
import { createTemporalReadClient } from "#client";
import { parseTemporalNamespace } from "#shared/infra/temporal-namespace.ts";

const SCHEDULE_ID = "the-storm-reddit-outreach";
export const REDDIT_OUTREACH_RUN_LIMIT = 12;
type Schedule = Extract<
  RedditOutreachOverview,
  { status: "available" }
>["schedule"];
type NativeExecution = {
  id: string;
  at: string;
  completedAt: string | null;
  elapsedMs: number | null;
  status: Exclude<RedditOutreachRun["status"], "recorded">;
};
export type NativeRedditOutreachSchedule = {
  schedule: Schedule;
  executions: NativeExecution[];
};

type ExecutionRef = { workflowId: string; runId: string; startTime?: Date };

function unavailableSchedule(error: unknown): Schedule {
  return {
    state: error instanceof ScheduleNotFoundError ? "missing" : "unavailable",
    lastRunAt: null,
    nextRunAt: null,
  };
}

export async function readRedditOutreachSchedule(
  oldestDay: string,
  auditedOccurrences: ReadonlySet<string>,
  unauditedReplyRuns: ReadonlySet<string>,
): Promise<NativeRedditOutreachSchedule> {
  const deadline = Date.now() + 4000;
  const signal = AbortSignal.timeout(4000);
  try {
    const namespace = parseTemporalNamespace(Bun.env["TEMPORAL_NAMESPACE"]);
    const client = await createTemporalReadClient(namespace, {
      connectTimeout: 4000,
    });
    return await client.connection.withDeadline(deadline, () =>
      client.connection.withAbortSignal(signal, async () => {
        const { schedule, description } = await readScheduleSnapshot(client);
        const recent =
          description === undefined
            ? []
            : await readRecentExecutionRefs(client, description, oldestDay);
        const refs = selectExecutionRefs(
          recent,
          auditedOccurrences,
          unauditedReplyRuns,
        );
        const executions = await Promise.all(
          refs.map((ref) => readNativeExecution(client, ref)),
        );
        return {
          schedule,
          executions: executions.filter((execution) => execution !== undefined),
        };
      }),
    );
  } catch (error) {
    return {
      schedule: unavailableSchedule(error),
      executions: [],
    };
  }
}

async function readScheduleSnapshot(
  client: Client,
): Promise<{ schedule: Schedule; description?: ScheduleDescription }> {
  try {
    const description = await client.schedule.getHandle(SCHEDULE_ID).describe();
    const paused = description.state.paused;
    return {
      schedule: {
        state: paused ? "paused" : "active",
        lastRunAt:
          description.info.recentActions.at(-1)?.takenAt.toISOString() ?? null,
        nextRunAt: paused
          ? null
          : (description.info.nextActionTimes[0]?.toISOString() ?? null),
      },
      description,
    };
  } catch (error) {
    return { schedule: unavailableSchedule(error) };
  }
}

async function readRecentExecutionRefs(
  client: Client,
  description: ScheduleDescription,
  oldestDay: string,
) {
  const actions = new Map<string, Required<ExecutionRef>>();
  for (const item of description.info.recentActions) {
    const { workflowId, firstExecutionRunId } = item.action.workflow;
    actions.set(workflowId, {
      workflowId,
      runId: firstExecutionRunId,
      startTime: item.takenAt,
    });
  }
  try {
    // Describe's recent-action ring may be shorter than the UI window. Scope
    // visibility to this schedule so manually started previews cannot appear.
    const query = `TemporalScheduledById = ${JSON.stringify(SCHEDULE_ID)} AND StartTime >= ${JSON.stringify(`${oldestDay}T00:00:00Z`)}`;
    let count = 0;
    for await (const item of client.workflow.list({
      query,
      pageSize: REDDIT_OUTREACH_RUN_LIMIT,
    })) {
      if (!actions.has(item.workflowId)) actions.set(item.workflowId, item);
      if (++count === REDDIT_OUTREACH_RUN_LIMIT) break;
    }
  } catch {
    // The directly described recent actions remain useful if visibility is down.
  }
  return (
    [...actions.values()]
      // A sweep starting just before Pacific midnight can finish on the next day.
      .filter(
        ({ startTime }) => startTime.toISOString() >= `${oldestDay}T00:00:00`,
      )
      .sort(
        (left, right) => right.startTime.getTime() - left.startTime.getTime(),
      )
      .slice(0, REDDIT_OUTREACH_RUN_LIMIT)
  );
}

function selectExecutionRefs(
  recent: ExecutionRef[],
  auditedOccurrences: ReadonlySet<string>,
  unauditedReplyRuns: ReadonlySet<string>,
) {
  const refs = new Map<string, ExecutionRef>();
  for (const ref of recent) {
    const id = `${ref.workflowId}/${ref.runId}`;
    if (!auditedOccurrences.has(id)) refs.set(id, ref);
  }
  // Reservations bound extra lookups. A reply-bearing sweep can still matter for
  // today's totals after its unaudited Workflow leaves the recent run window.
  for (const id of unauditedReplyRuns) {
    const separator = id.lastIndexOf("/");
    if (refs.has(id) || separator <= 0 || separator === id.length - 1) continue;
    refs.set(id, {
      workflowId: id.slice(0, separator),
      runId: id.slice(separator + 1),
    });
  }
  return [...refs.values()];
}

function executionStatus(
  status: WorkflowExecutionStatusName,
): NativeExecution["status"] {
  switch (status) {
    case "RUNNING":
      return "running";
    case "COMPLETED":
      return "missing";
    case "FAILED":
    case "CANCELLED":
    case "TERMINATED":
    case "TIMED_OUT":
      return "failed";
    case "CONTINUED_AS_NEW":
    case "PAUSED":
    case "UNKNOWN":
    case "UNSPECIFIED":
      return "unknown";
  }
}

async function readNativeExecution(
  client: Client,
  ref: ExecutionRef,
): Promise<NativeExecution | undefined> {
  try {
    const description = await client.workflow
      .getHandle(ref.workflowId, ref.runId)
      .describe();
    return {
      id: `${ref.workflowId}/${description.runId}`,
      at: (description.closeTime ?? description.startTime).toISOString(),
      completedAt: description.closeTime?.toISOString() ?? null,
      elapsedMs:
        description.closeTime === undefined
          ? null
          : Math.max(
              0,
              description.closeTime.getTime() - description.startTime.getTime(),
            ),
      status: executionStatus(description.status.name),
    };
  } catch (error) {
    if (ref.startTime === undefined) return undefined;
    return {
      id: `${ref.workflowId}/${ref.runId}`,
      at: ref.startTime.toISOString(),
      completedAt: null,
      elapsedMs: null,
      status: error instanceof WorkflowNotFoundError ? "missing" : "unknown",
    };
  }
}
