import type { Client } from "@temporalio/client";
import { DYNAMIC_AGENT_TASK_MEMO_KEY } from "#shared/agent-task.ts";
import { scheduleOrphans } from "#observability/metrics.ts";

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

// A live schedule is an orphan when it is neither declared in SCHEDULES, nor in
// the DELETED_SCHEDULE_IDS allow-list, nor a dynamic agent-task schedule — i.e.
// a renamed/removed schedule that was never added to the delete list and keeps
// firing. The declared/deleted id sets are passed in (rather than imported from
// register-schedules) to keep this module free of a circular import.
export function isOrphanSchedule(
  scheduleId: string,
  memo: Record<string, unknown> | undefined,
  declaredIds: ReadonlySet<string>,
  deletedIds: ReadonlySet<string>,
): boolean {
  if (declaredIds.has(scheduleId)) return false;
  if (deletedIds.has(scheduleId)) return false;
  if (isDynamicAgentTaskSchedule(scheduleId, memo)) return false;
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
  declaredIds: ReadonlySet<string>,
  deletedIds: ReadonlySet<string>,
): Promise<void> {
  try {
    const orphans: string[] = [];
    for await (const summary of scheduleClient.list()) {
      if (
        isOrphanSchedule(
          summary.scheduleId,
          summary.memo,
          declaredIds,
          deletedIds,
        )
      ) {
        orphans.push(summary.scheduleId);
      }
    }
    scheduleOrphans.set(orphans.length);
    if (orphans.length > 0) {
      console.warn(
        `Orphan schedules (live but not declared in SCHEDULES or DELETED_SCHEDULE_IDS): ${orphans.join(", ")}. Add each to DELETED_SCHEDULE_IDS (if removed) or back to SCHEDULES (if still wanted).`,
      );
    }
  } catch (error: unknown) {
    scheduleOrphans.set(ORPHAN_DETECTION_FAILED);
    console.error("Orphan schedule detection failed", error);
  }
}
