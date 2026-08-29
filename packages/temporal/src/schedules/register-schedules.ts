import type {
  Client,
  ScheduleOverlapPolicy,
  ScheduleUpdateOptions,
} from "@temporalio/client";
import { ScheduleNotFoundError } from "@temporalio/client";
import { WorkflowNotFoundError } from "@temporalio/common";
import {
  detectOrphanSchedules,
  isReconcilableDynamicAgentTaskSchedule,
} from "./orphan-detection.ts";
import { buildScheduleState } from "./schedule-state.ts";
import { CATCHUP_RELAXED, SCHEDULES } from "./schedule-definitions.ts";
import type { CatchupWindow, ScheduleDefinition } from "./schedule-types.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

// SCHEDULES/CATCHUP_* live in ./schedule-definitions.ts and the shared types
// live in ./schedule-types.ts (this file sits at the repo's max-lines cap).
// Import SCHEDULES from
// #schedules/schedule-definitions.ts directly, not from this file — no
// re-export here (custom-rules/no-re-exports).

// Schedules whose workflow type was removed from the bundle. registerSchedules
// deletes these on startup so they stop firing and failing. Explicit removal
// allow-list — NOT a blind prune of "anything not in SCHEDULES", which would
// also delete the ad-hoc/cron agent-task schedules created via the /agent-tasks API.
export const DELETED_SCHEDULE_IDS = [
  // Replaced by the stage-specific Scout competition update Schedules owned
  // by the embedded Scout Workers.
  "scout-competition-updates-minute",
  "good-morning-weekday-early",
  "good-morning-weekend-early",
  // Replaced by the Buildkite `helm-types-drift-check` CI gate (the generated
  // types are now verified on every PR that touches a generator input, instead
  // of reconciled weekly). The workflow type was removed from the bundle, so
  // this schedule must be deleted or it would keep firing a missing workflow.
  "helm-types-weekly-refresh",
  // The weekly cog-based README project-listing regeneration was removed
  // entirely (the READMEs are hand-maintained now). The workflow type
  // (`runReadmeRefresh`) is no longer in the bundle, so this schedule must be
  // deleted or it would keep firing a missing workflow.
  "readme-refresh-weekly",
  // Alert-remediation workflow removed entirely: in ~1 month it opened 0 PRs
  // (metrics: ~564 `failed`, ~2 `report-only`, 0 `pr-created`). Most
  // Bugsink alerts (absence signals, infra flaps, capacity) aren't fixable by a
  // repo-only PR, so the premise didn't hold. Both ids stay here so the
  // reconciler deletes the live schedules on startup rather than orphaning them.
  "alert-remediation-hourly",
  "alert-remediation-daily",
  // The pokeemerald.wasm download workflow (`runPokeemeraldWasmUpdate`) is gone:
  // the wasm was instead built from source in the (since-removed) CI image build with our
  // customizations (the download fetched an audio-stubbed upstream that lacked
  // them). Delete BOTH the live weekly schedule and the never-removed monthly
  // one (a monthly→weekly rename relic the 2026-06-26 audit caught) so neither
  // keeps firing a workflow that no longer exists in the bundle.
  "pokeemerald-wasm-weekly",
  "pokeemerald-wasm-monthly",
  // The pr-review eval bot (continuous-eval + weekly A/B significance) was
  // removed entirely — its workflow types (`prReviewEvalWorkflow`,
  // `prReviewWeeklySignificanceWorkflow`) are no longer in the bundle. Delete
  // BOTH schedules on startup so the worker stops firing missing workflow
  // types (which would also trip the `temporal_schedule_orphans` gauge). The
  // dedicated `pr_review_eval` Postgres DB and alert group were torn
  // down with them.
  "pr-review-eval-nightly",
  "pr-review-ab-weekly-report",
  // The review-signal collector was removed; delete its live schedule during
  // reconciliation so it cannot continue starting a missing workflow.
  "review-signals-collect",
  // Replaced by per-execution temporal-failure-watch alerts and worker-task
  // health guardrails. Delete the old aggregate alert on worker startup.
  "agent-task-timeout-watch",
] as const;

// Schedule deletion prevents future starts but does not stop an execution that
// was already started. The retired workflow types stay on this migration list
// for one reconciliation so the gateway can terminate those executions before
// the queue-owning workers receive a bundle without their handlers.
const RETIRED_WORKFLOW_TYPES = ["observeReviewSignalsWorkflow"] as const;

export async function terminateRetiredWorkflowExecutions(client: {
  workflow: {
    list: (options: { query: string }) => AsyncIterable<{
      workflowId: string;
      runId: string;
    }>;
    getHandle: (
      workflowId: string,
      runId: string,
    ) => { terminate: (reason?: string) => Promise<unknown> };
  };
}): Promise<void> {
  for (const workflowType of RETIRED_WORKFLOW_TYPES) {
    const query = `WorkflowType = "${workflowType}" AND ExecutionStatus = "Running"`;
    for await (const execution of client.workflow.list({ query })) {
      try {
        await client.workflow
          .getHandle(execution.workflowId, execution.runId)
          .terminate("Workflow type retired; terminating during deployment");
        console.warn(
          `Terminated retired workflow: ${workflowType} ${execution.workflowId}/${execution.runId}`,
        );
      } catch (error: unknown) {
        // Visibility is eventually consistent; a run can finish between the
        // list and terminate calls. A missing execution is already in the
        // desired terminal state, while all other errors must fail startup.
        if (!(error instanceof WorkflowNotFoundError)) {
          throw error;
        }
      }
    }
  }
}

export function buildSchedulePolicies(schedule: ScheduleDefinition): {
  overlap: ScheduleOverlapPolicy;
  // CatchupWindow (not `Duration`): the resolved value is always one of the two
  // literal tiers, and `Duration` is error-typed under CI's Node16 `ms`
  // resolution. Both literals are valid Temporal Durations at the call site.
  catchupWindow: CatchupWindow;
} {
  return {
    overlap: schedule.overlap,
    catchupWindow: schedule.catchupWindow ?? CATCHUP_RELAXED,
  };
}

function buildScheduleConfiguration(schedule: ScheduleDefinition) {
  return {
    spec:
      schedule.timing.kind === "cron"
        ? {
            cronExpressions: [schedule.timing.expression],
            timezone: schedule.timing.timezone,
          }
        : {
            intervals: [
              {
                every: schedule.timing.every,
                ...(schedule.timing.offset === undefined
                  ? {}
                  : { offset: schedule.timing.offset }),
              },
            ],
          },
    action: {
      type: "startWorkflow" as const,
      workflowType: schedule.workflowType,
      args: schedule.args,
      taskQueue: schedule.taskQueue,
      memo: { description: schedule.memo },
      ...(schedule.workflowExecutionTimeout === undefined
        ? {}
        : { workflowExecutionTimeout: schedule.workflowExecutionTimeout }),
    },
    policies: buildSchedulePolicies(schedule),
  };
}

export function routeDynamicAgentTaskSchedule(
  schedule: ScheduleUpdateOptions,
): ScheduleUpdateOptions {
  if (schedule.action.workflowType !== "agentTaskWorkflow") {
    throw new Error("Dynamic agent-task schedule must start agentTaskWorkflow");
  }
  return {
    ...schedule,
    action: {
      ...schedule.action,
      taskQueue: TASK_QUEUES.WORKFLOWS,
    },
  };
}

async function reconcileDynamicAgentTaskSchedules(
  scheduleClient: Client["schedule"],
  declaredIds: ReadonlySet<string>,
): Promise<void> {
  for await (const summary of scheduleClient.list()) {
    if (
      !isReconcilableDynamicAgentTaskSchedule(
        summary.scheduleId,
        summary.memo,
        declaredIds,
      )
    ) {
      continue;
    }
    await scheduleClient
      .getHandle(summary.scheduleId)
      .update(routeDynamicAgentTaskSchedule);
    console.warn(`Updated dynamic agent-task schedule: ${summary.scheduleId}`);
  }
}

export async function registerSchedules(
  client: Client,
  options: { validateLocalEnvironment?: boolean } = {},
): Promise<void> {
  const scheduleClient = client.schedule;
  const validateLocalEnvironment = options.validateLocalEnvironment ?? true;
  const declaredIds = new Set(SCHEDULES.map((schedule) => schedule.id));

  for (const scheduleId of DELETED_SCHEDULE_IDS) {
    try {
      await scheduleClient.getHandle(scheduleId).delete();
      console.warn(`Deleted orphaned schedule: ${scheduleId}`);
    } catch (error: unknown) {
      if (!(error instanceof ScheduleNotFoundError)) {
        throw error;
      }
    }
  }

  // Dynamic schedules are intentionally absent from SCHEDULES, but their next
  // action must move with the deterministic Workflow Worker. Reconcile every
  // owned schedule before evaluating whether legacy Workflow pollers can drain.
  // declaredIds is passed so a schedule that was promoted out of the dynamic
  // set and into SCHEDULES is skipped despite its immutable creation-time memo
  // marker — see isReconcilableDynamicAgentTaskSchedule.
  await reconcileDynamicAgentTaskSchedules(scheduleClient, declaredIds);
  await terminateRetiredWorkflowExecutions(client);

  for (const schedule of SCHEDULES) {
    const handle = scheduleClient.getHandle(schedule.id);
    try {
      // Update the existing schedule
      await handle.update((prev) => ({
        ...prev,
        ...buildScheduleConfiguration(schedule),
        state: buildScheduleState(
          schedule,
          Bun.env,
          prev.state,
          validateLocalEnvironment,
        ),
      }));

      console.warn(`Updated schedule: ${schedule.id}`);
    } catch (error: unknown) {
      if (!(error instanceof ScheduleNotFoundError)) {
        throw error;
      }
      // Schedule doesn't exist yet — create it
      await scheduleClient.create({
        scheduleId: schedule.id,
        ...buildScheduleConfiguration(schedule),
        memo: { description: schedule.memo },
        state: buildScheduleState(
          schedule,
          Bun.env,
          undefined,
          validateLocalEnvironment,
        ),
      });

      console.warn(`Created schedule: ${schedule.id}`);
    }
  }
  // After reconciling the declared set, surface any live schedule that is no
  // longer represented in source (renamed/removed but not added to the delete
  // list). Non-fatal — see detectOrphanSchedules.
  await detectOrphanSchedules(
    scheduleClient,
    declaredIds,
    new Set(DELETED_SCHEDULE_IDS),
  );
}
