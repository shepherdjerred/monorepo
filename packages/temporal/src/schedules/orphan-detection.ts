import type { Client } from "@temporalio/client";
import { DYNAMIC_AGENT_TASK_MEMO_KEY } from "#shared/agent-task-identifiers.ts";
import { scheduleOrphans } from "#observability/metrics.ts";
import {
  ScoutScheduleOwnershipMemoSchema,
  scoutReportScheduleId,
} from "@scout-for-lol/temporal";
import type { TemporalNamespace } from "#shared/temporal-namespace.ts";

// Gauge value written when `scheduleClient.list()` itself fails. Distinct from
// 0 ("detection ran cleanly, found no orphans") so a monitoring rule can tell a
// healthy empty result apart from a detection outage — without it, a failed
// list leaves the gauge at its 0 initial value and the `> 0` orphan alert can
// never fire. Alert separately on `temporal_schedule_orphans < 0`.
export const ORPHAN_DETECTION_FAILED = -1;

// Dynamic schedules created via the authenticated /agent-tasks API are NOT
// declared in SCHEDULES by design, so orphan detection must not flag them. Two
// signals mark one as dynamic:
//   * an `agent-task-` id prefix — every auto-generated id carries it (see
//     agentTaskScheduleId), including schedules created before the memo marker
//     existed; and
//   * the DYNAMIC_AGENT_TASK_MEMO_KEY memo marker, stamped at creation on every
//     API-created schedule (auto- or custom-id).
// Crucially this no longer trusts `workflowType === "agentTaskWorkflow"`: that
// also matches *declared* schedules running the same workflow (homelab-audit-daily),
// which would silently exempt them from drift detection if they were ever
// removed from SCHEDULES without being delete-listed.
export function isDynamicAgentTaskSchedule(
  scheduleId: string,
  memo: Record<string, unknown> | undefined,
): boolean {
  if (scheduleId.startsWith("agent-task-")) return true;
  return memo?.[DYNAMIC_AGENT_TASK_MEMO_KEY] === true;
}

export function isOwnedScoutReportSchedule(
  scheduleId: string,
  memo: Record<string, unknown> | undefined,
  namespace: TemporalNamespace,
): boolean {
  const parsed = ScoutScheduleOwnershipMemoSchema.safeParse(memo);
  if (!parsed.success) return false;
  return (
    namespace === parsed.data.stage &&
    scheduleId ===
      scoutReportScheduleId(parsed.data.stage, parsed.data.reportId)
  );
}

// A declared schedule is never a dynamic agent-task schedule, whatever its memo
// says. Promoting an agent-task schedule into SCHEDULES (as
// `ci-io-post-merge-impact` was) leaves the creation-time
// DYNAMIC_AGENT_TASK_MEMO_KEY marker on the live schedule forever: Temporal
// memos are immutable after creation — `ScheduleUpdateOptions` omits `memo`
// and `temporal schedule update` refuses it outright — so the marker cannot be
// rewritten in place, and the declared registration below cannot clear it.
// Without this precedence the reconciler routes the declared schedule through
// routeDynamicAgentTaskSchedule, which throws on its non-agentTaskWorkflow
// action and crash-loops the worker *before* it registers anything — a
// deadlock, because the only code that could correct the schedule never runs.
// isOrphanSchedule already gives declared ids exactly this precedence.
export function isReconcilableDynamicAgentTaskSchedule(
  scheduleId: string,
  memo: Record<string, unknown> | undefined,
  declaredIds: ReadonlySet<string>,
): boolean {
  if (declaredIds.has(scheduleId)) return false;
  return isDynamicAgentTaskSchedule(scheduleId, memo);
}

// A live schedule is an orphan when it is neither declared in SCHEDULES, nor in
// the DELETED_SCHEDULE_IDS allow-list, nor a dynamic agent-task schedule — i.e.
// a renamed/removed schedule that was never added to the delete list and keeps
// firing. The declared/deleted id sets are passed in (rather than imported from
// register-schedules) to keep this module free of a circular import.
export function isOrphanSchedule(input: {
  scheduleId: string;
  memo: Record<string, unknown> | undefined;
  namespace: TemporalNamespace;
  declaredIds: ReadonlySet<string>;
  deletedIds: ReadonlySet<string>;
}): boolean {
  if (input.declaredIds.has(input.scheduleId)) return false;
  if (input.deletedIds.has(input.scheduleId)) return false;
  if (
    input.namespace === "prod" &&
    isDynamicAgentTaskSchedule(input.scheduleId, input.memo)
  ) {
    return false;
  }
  if (
    isOwnedScoutReportSchedule(input.scheduleId, input.memo, input.namespace)
  ) {
    return false;
  }
  return true;
}

// Best-effort drift audit on startup: list live schedules and surface any orphan
// via a warning + the `temporal_schedule_orphans` gauge (alert on > 0). This is
// non-destructive — auto-deleting would be unsafe because the dynamic agent-task
// schedules are legitimately undeclared. Detection failure must never crash the
// worker, so its error is logged (not swallowed), the gauge is set to the
// ORPHAN_DETECTION_FAILED sentinel so a failed scan is not mistaken for "zero
// orphans", and startup continues.
export async function detectOrphanSchedules(
  scheduleClient: Client["schedule"],
  namespace: TemporalNamespace,
  declaredIds: ReadonlySet<string>,
  deletedIds: ReadonlySet<string>,
): Promise<void> {
  try {
    const orphans: string[] = [];
    for await (const summary of scheduleClient.list()) {
      if (
        isOrphanSchedule({
          scheduleId: summary.scheduleId,
          memo: summary.memo,
          namespace,
          declaredIds,
          deletedIds,
        })
      ) {
        orphans.push(summary.scheduleId);
      }
    }
    scheduleOrphans.set({ temporal_namespace: namespace }, orphans.length);
    if (orphans.length > 0) {
      console.warn(
        `Orphan schedules (live but not declared in SCHEDULES or DELETED_SCHEDULE_IDS): ${orphans.join(", ")}. Add each to DELETED_SCHEDULE_IDS (if removed) or back to SCHEDULES (if still wanted).`,
      );
    }
  } catch (error: unknown) {
    scheduleOrphans.set(
      { temporal_namespace: namespace },
      ORPHAN_DETECTION_FAILED,
    );
    console.error("Orphan schedule detection failed", error);
  }
}
