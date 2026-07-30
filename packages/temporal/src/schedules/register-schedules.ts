import type { Client, ScheduleOverlapPolicy } from "@temporalio/client";
import { ScheduleNotFoundError } from "@temporalio/client";
import { detectOrphanSchedules } from "./orphan-detection.ts";
import { buildScheduleState } from "./schedule-state.ts";
import {
  CATCHUP_RELAXED,
  SCHEDULES,
  type CatchupWindow,
  type ScheduleDefinition,
} from "./schedule-definitions.ts";

// SCHEDULES/ScheduleDefinition/CATCHUP_* live in ./schedule-definitions.ts
// (this file sits at the repo's max-lines cap). Import SCHEDULES from
// #schedules/schedule-definitions.ts directly, not from this file — no
// re-export here (custom-rules/no-re-exports).

// All cron expressions in schedule-definitions.ts are wall-clock local time
// for the homelab.
const SCHEDULE_TIMEZONE = "America/Los_Angeles";

// Schedules whose workflow type was removed from the bundle. registerSchedules
// deletes these on startup so they stop firing and failing. Explicit removal
// allow-list — NOT a blind prune of "anything not in SCHEDULES", which would
// also delete the ad-hoc/cron agent-task schedules created via the /agent-tasks API.
export const DELETED_SCHEDULE_IDS = [
  "good-morning-weekday-early",
  "good-morning-weekend-early",
  // Replaced by the Buildkite `helm-types-drift-check` CI gate (the generated
  // types are now verified on every PR that touches a generator input, instead
  // of reconciled weekly). The workflow type was removed from the bundle, so
  // this schedule must be deleted or it would keep firing a missing workflow.
  "helm-types-weekly-refresh",
  // Alert-remediation workflow removed entirely: in ~1 month it opened 0 PRs
  // (metrics: ~564 `failed`, ~2 `report-only`, 0 `pr-created`). Most PagerDuty/
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
  // dedicated `pr_review_eval` Postgres DB and PagerDuty alert group were torn
  // down with them.
  "pr-review-eval-nightly",
  "pr-review-ab-weekly-report",
] as const;

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
    spec: {
      cronExpressions: [schedule.cronExpression],
      timezone: SCHEDULE_TIMEZONE,
    },
    action: {
      type: "startWorkflow" as const,
      workflowType: schedule.workflowType,
      args: schedule.args,
      taskQueue: schedule.taskQueue,
      ...(schedule.workflowExecutionTimeout === undefined
        ? {}
        : { workflowExecutionTimeout: schedule.workflowExecutionTimeout }),
    },
    policies: buildSchedulePolicies(schedule),
  };
}

export async function registerSchedules(client: Client): Promise<void> {
  const scheduleClient = client.schedule;

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

  for (const schedule of SCHEDULES) {
    const handle = scheduleClient.getHandle(schedule.id);
    try {
      // Update the existing schedule
      await handle.update((prev) => ({
        ...prev,
        ...buildScheduleConfiguration(schedule),
        state: buildScheduleState(schedule, Bun.env, prev.state),
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
        state: buildScheduleState(schedule, Bun.env),
      });

      console.warn(`Created schedule: ${schedule.id}`);
    }
  }
  // After reconciling the declared set, surface any live schedule that is no
  // longer represented in source (renamed/removed but not added to the delete
  // list). Non-fatal — see detectOrphanSchedules.
  await detectOrphanSchedules(
    scheduleClient,
    new Set(SCHEDULES.map((schedule) => schedule.id)),
    new Set(DELETED_SCHEDULE_IDS),
  );
}
