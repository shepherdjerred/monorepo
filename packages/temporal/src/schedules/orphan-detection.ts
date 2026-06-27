import type { Client } from "@temporalio/client";
import { scheduleOrphans } from "#observability/metrics.ts";

// Dynamic schedules created via the authenticated /agent-tasks API are NOT
// declared in SCHEDULES by design, so orphan detection must not flag them. They
// all run `agentTaskWorkflow`; the auto-generated ones also use an `agent-task-`
// id prefix (see agentTaskScheduleId). Either signal marks one as dynamic.
export function isDynamicAgentTaskSchedule(
  scheduleId: string,
  workflowType: string | undefined,
): boolean {
  return (
    workflowType === "agentTaskWorkflow" || scheduleId.startsWith("agent-task-")
  );
}

// A live schedule is an orphan when it is neither declared in SCHEDULES, nor in
// the DELETED_SCHEDULE_IDS allow-list, nor a dynamic agent-task schedule — i.e.
// a renamed/removed schedule that was never added to the delete list and keeps
// firing. The declared/deleted id sets are passed in (rather than imported from
// register-schedules) to keep this module free of a circular import.
export function isOrphanSchedule(
  scheduleId: string,
  workflowType: string | undefined,
  declaredIds: ReadonlySet<string>,
  deletedIds: ReadonlySet<string>,
): boolean {
  if (declaredIds.has(scheduleId)) return false;
  if (deletedIds.has(scheduleId)) return false;
  if (isDynamicAgentTaskSchedule(scheduleId, workflowType)) return false;
  return true;
}

// Best-effort drift audit on startup: list live schedules and surface any orphan
// via a warning + the `temporal_schedule_orphans` gauge (alert on > 0). This is
// non-destructive — auto-deleting would be unsafe because the dynamic agent-task
// schedules are legitimately undeclared. Detection failure must never crash the
// worker, so its error is logged (not swallowed) and startup continues.
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
          summary.action?.workflowType,
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
    console.error("Orphan schedule detection failed", error);
  }
}
