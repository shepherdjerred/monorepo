export type TaskStatus = "open" | "in-progress" | "done" | "cancelled" | "waiting" | "delegated";

export const ACTIVE_STATUSES: readonly TaskStatus[] = ["open", "in-progress", "waiting", "delegated"] as const;
export const COMPLETED_STATUSES: readonly TaskStatus[] = ["done", "cancelled"] as const;

export const STATUS_LABELS: Record<TaskStatus, string> = {
  open: "Open",
  "in-progress": "In Progress",
  done: "Done",
  cancelled: "Cancelled",
  waiting: "Waiting",
  delegated: "Delegated",
};

export const STATUS_ICONS: Record<TaskStatus, string> = {
  open: "circle",
  "in-progress": "play-circle",
  done: "check-circle",
  cancelled: "x-circle",
  waiting: "clock",
  delegated: "arrow-right-circle",
};

export function isActiveStatus(status: TaskStatus): boolean {
  return (ACTIVE_STATUSES as readonly string[]).includes(status);
}

export function isCompletedStatus(status: TaskStatus): boolean {
  return (COMPLETED_STATUSES as readonly string[]).includes(status);
}

export function getNextStatus(current: TaskStatus): TaskStatus {
  switch (current) {
    case "open":
      return "done";
    case "in-progress":
      return "done";
    case "done":
      return "open";
    case "cancelled":
      return "open";
    case "waiting":
      return "open";
    case "delegated":
      return "open";
  }
}
