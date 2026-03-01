export type FilterStatus = "all" | "running" | "idle" | "completed" | "archived";

const FILTER_STATUS_MAP: Record<string, FilterStatus> = {
  all: "all",
  running: "running",
  idle: "idle",
  completed: "completed",
  archived: "archived",
};

export function toFilterStatus(value: string): FilterStatus | undefined {
  return FILTER_STATUS_MAP[value];
}

export function getConfirmDialogTitle(type: string): string {
  switch (type) {
    case "archive":
      return "Archive Session";
    case "unarchive":
      return "Unarchive Session";
    case "refresh":
      return "Refresh Session";
    default:
      return "Delete Session";
  }
}

export function getConfirmDialogDescription(type: string, name: string): string {
  switch (type) {
    case "archive":
      return `Are you sure you want to archive "${name}"?`;
    case "unarchive":
      return `Are you sure you want to restore "${name}" from the archive?`;
    case "refresh":
      return `This will pull the latest image and recreate the container for "${name}". The session history will be preserved.`;
    default:
      return `Are you sure you want to delete "${name}"? This action cannot be undone.`;
  }
}

export function getConfirmDialogLabel(type: string): string {
  switch (type) {
    case "archive":
      return "Archive";
    case "unarchive":
      return "Unarchive";
    case "refresh":
      return "Refresh";
    default:
      return "Delete";
  }
}

export const TAB_TRIGGER_CLASS =
  "cursor-pointer transition-all duration-200 hover:bg-primary/20 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:border-2 data-[state=active]:border-primary data-[state=active]:shadow-[4px_4px_0_hsl(220,85%,25%)] data-[state=active]:font-bold";
