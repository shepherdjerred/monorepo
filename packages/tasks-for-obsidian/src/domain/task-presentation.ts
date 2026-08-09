import type { Priority } from "./priority";
import type { Task } from "./types";
import { projectDisplayName } from "tasknotes-types/v2";

export type TaskDateKind = "planned" | "deadline";
export type TaskDateRelation = "overdue" | "today" | "tomorrow" | "absolute";

export type TaskDateMetadataPresentation = {
  readonly kind: TaskDateKind;
  /** The task date normalized to the device's local calendar day. */
  readonly date: string;
  readonly relation: TaskDateRelation;
  readonly label: string;
  readonly accessibilityLabel: string;
};

export type TaskOrganizationMetadataPresentation = {
  readonly kind: "project" | "context" | "tag";
  readonly value: string;
  readonly label: string;
  readonly accessibilityLabel: string;
};

/**
 * Ordered row metadata candidates. Renderers may take the prefix that fits
 * their density while retaining one shared precedence across every surface.
 */
export type TaskMetadataPresentation =
  | TaskDateMetadataPresentation
  | TaskOrganizationMetadataPresentation;

export type TaskIndicatorPresentation =
  | {
      readonly kind: "priority";
      readonly value: Priority;
      readonly label: string;
      readonly accessibilityLabel: string;
    }
  | {
      readonly kind: "blocked";
      readonly blockerCount: number;
      readonly label: string;
      readonly accessibilityLabel: string;
    }
  | {
      readonly kind: "recurrence";
      readonly value: string;
      readonly label: string;
      readonly accessibilityLabel: string;
    }
  | {
      readonly kind: "estimate" | "tracked";
      readonly minutes: number;
      readonly label: string;
      readonly accessibilityLabel: string;
    }
  | {
      readonly kind: "pending-sync";
      readonly label: string;
      readonly accessibilityLabel: string;
    };

export type TaskPresentation = {
  readonly title: string;
  readonly metadata: readonly TaskMetadataPresentation[];
  readonly indicators: readonly TaskIndicatorPresentation[];
  readonly accessibilityLabel: string;
};

export type TaskPresentationOptions = {
  /** Required so grouping, widgets, and tests never consult different clocks. */
  readonly referenceDate: Date;
  /** Queue state belongs to sync, so callers supply it explicitly. */
  readonly pending: boolean;
  /** A collection may project a derived occurrence without mutating the task. */
  readonly dateContext?:
    | { readonly kind: TaskDateKind; readonly date: string }
    | undefined;
};

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

const PRIORITY_PRESENTATIONS: Record<
  Exclude<Priority, "normal" | "none">,
  { readonly label: string; readonly accessibilityLabel: string }
> = {
  highest: { label: "P1", accessibilityLabel: "Highest priority (P1)" },
  high: { label: "P2", accessibilityLabel: "High priority (P2)" },
  medium: { label: "P3", accessibilityLabel: "Medium priority (P3)" },
  low: { label: "P4", accessibilityLabel: "Low priority (P4)" },
};

/**
 * Pure projection used by task lists, boards, widgets, and accessibility.
 * `scheduled` is always presented as a planned date; `due` is always a
 * deadline. Their meaning is never collapsed into one generic date.
 */
export function deriveTaskPresentation(
  task: Task,
  options: TaskPresentationOptions,
): TaskPresentation {
  const referenceDate = requireValidDate(
    options.referenceDate,
    "reference date",
  );
  const dateMetadata: TaskDateMetadataPresentation[] = [];

  if (options.dateContext?.kind === "planned") {
    dateMetadata.push(
      createDateMetadata("planned", options.dateContext.date, referenceDate),
    );
  } else if (task.scheduled !== undefined) {
    dateMetadata.push(
      createDateMetadata("planned", task.scheduled, referenceDate),
    );
  }
  if (options.dateContext?.kind === "deadline") {
    dateMetadata.push(
      createDateMetadata("deadline", options.dateContext.date, referenceDate),
    );
  } else if (task.due !== undefined) {
    dateMetadata.push(createDateMetadata("deadline", task.due, referenceDate));
  }

  const metadata: TaskMetadataPresentation[] = [...dateMetadata];
  const project = task.projects[0];
  if (project !== undefined) {
    metadata.push(
      createOrganizationMetadata(
        "project",
        projectDisplayName(String(project)),
      ),
    );
  }

  // A context is a more actionable row cue than a tag. Tags are the fallback
  // so the secondary line stays scannable instead of becoming a chip cloud.
  const context = task.contexts[0];
  const tag = task.tags[0];
  if (context !== undefined) {
    metadata.push(createOrganizationMetadata("context", String(context)));
  } else if (tag !== undefined) {
    metadata.push(createOrganizationMetadata("tag", String(tag)));
  }

  const indicators = createIndicators(task, options.pending);
  const accessibilityParts = [
    `Task: ${task.title}`,
    ...dateMetadata.map((item) => item.accessibilityLabel),
    ...createCollectionAccessibility(
      "Project",
      task.projects.map((value) => projectDisplayName(String(value))),
    ),
    ...createCollectionAccessibility("Context", task.contexts),
    ...createCollectionAccessibility("Tag", task.tags),
    ...indicators.map((item) => item.accessibilityLabel),
  ];

  return {
    title: task.title,
    metadata,
    indicators,
    accessibilityLabel: accessibilityParts.join(", "),
  };
}

function createDateMetadata(
  kind: TaskDateKind,
  value: string,
  referenceDate: Date,
): TaskDateMetadataPresentation {
  const date = parseTaskDate(value);
  const relation = dateRelation(date, referenceDate);
  const shortDate = formatAbsoluteDate(date, referenceDate, "short");
  const longDate = formatAbsoluteDate(date, referenceDate, "long");
  const kindLabel = kind === "planned" ? "Planned" : "Deadline";

  switch (relation) {
    case "overdue":
      return {
        kind,
        date: formatLocalDate(date),
        relation,
        label: `${kindLabel} · ${shortDate}`,
        accessibilityLabel:
          kind === "planned"
            ? `Planned date overdue, ${longDate}`
            : `Deadline overdue, ${longDate}`,
      };
    case "today":
      return {
        kind,
        date: formatLocalDate(date),
        relation,
        label: `${kindLabel} · Today`,
        accessibilityLabel:
          kind === "planned" ? "Planned for today" : "Deadline today",
      };
    case "tomorrow":
      return {
        kind,
        date: formatLocalDate(date),
        relation,
        label: `${kindLabel} · Tomorrow`,
        accessibilityLabel:
          kind === "planned" ? "Planned for tomorrow" : "Deadline tomorrow",
      };
    case "absolute":
      return {
        kind,
        date: formatLocalDate(date),
        relation,
        label: `${kindLabel} · ${shortDate}`,
        accessibilityLabel:
          kind === "planned"
            ? `Planned for ${longDate}`
            : `Deadline ${longDate}`,
      };
  }
}

function createOrganizationMetadata(
  kind: TaskOrganizationMetadataPresentation["kind"],
  value: string,
): TaskOrganizationMetadataPresentation {
  switch (kind) {
    case "project":
      return {
        kind,
        value,
        label: value,
        accessibilityLabel: `Project ${value}`,
      };
    case "context":
      return {
        kind,
        value,
        label: `@${value}`,
        accessibilityLabel: `Context ${value}`,
      };
    case "tag":
      return {
        kind,
        value,
        label: `#${value}`,
        accessibilityLabel: `Tag ${value}`,
      };
  }
}

function createIndicators(
  task: Task,
  pending: boolean,
): TaskIndicatorPresentation[] {
  requireValidMinutes(task.totalTrackedTime, "total tracked time");
  if (task.timeEstimate !== undefined) {
    requireValidMinutes(task.timeEstimate, "time estimate");
  }

  const indicators: TaskIndicatorPresentation[] = [];
  const priority = createPriorityIndicator(task.priority);
  if (priority !== undefined) indicators.push(priority);

  if (task.isBlocked) {
    const blockerCount = task.blockedBy.length;
    indicators.push({
      kind: "blocked",
      blockerCount,
      label: blockerCount > 0 ? `Blocked · ${String(blockerCount)}` : "Blocked",
      accessibilityLabel:
        blockerCount > 0
          ? `Blocked by ${String(blockerCount)} ${blockerCount === 1 ? "task" : "tasks"}`
          : "Blocked",
    });
  }

  if (task.recurrence !== undefined && task.recurrence.length > 0) {
    indicators.push({
      kind: "recurrence",
      value: task.recurrence,
      label: "Repeats",
      accessibilityLabel: "Recurring task",
    });
  }

  if (task.timeEstimate !== undefined && task.timeEstimate > 0) {
    indicators.push({
      kind: "estimate",
      minutes: task.timeEstimate,
      label: `Est. ${formatCompactDuration(task.timeEstimate)}`,
      accessibilityLabel: `Estimated time ${formatAccessibleDuration(task.timeEstimate)}`,
    });
  }

  if (task.totalTrackedTime > 0) {
    indicators.push({
      kind: "tracked",
      minutes: task.totalTrackedTime,
      label: `${formatCompactDuration(task.totalTrackedTime)} tracked`,
      accessibilityLabel: `${formatAccessibleDuration(task.totalTrackedTime)} tracked`,
    });
  }

  if (pending) {
    indicators.push({
      kind: "pending-sync",
      label: "Pending",
      accessibilityLabel: "Waiting to sync",
    });
  }

  return indicators;
}

function createPriorityIndicator(
  priority: Priority,
): TaskIndicatorPresentation | undefined {
  switch (priority) {
    case "highest":
    case "high":
    case "medium":
    case "low": {
      const presentation = PRIORITY_PRESENTATIONS[priority];
      return {
        kind: "priority",
        value: priority,
        label: presentation.label,
        accessibilityLabel: presentation.accessibilityLabel,
      };
    }
    case "normal":
    case "none":
      return undefined;
  }
}

function parseTaskDate(value: string): Date {
  const dateOnly = DATE_ONLY_PATTERN.exec(value);
  if (dateOnly !== null) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    const parsed = new Date(year, month - 1, day);
    if (
      parsed.getFullYear() !== year ||
      parsed.getMonth() !== month - 1 ||
      parsed.getDate() !== day
    ) {
      throw new TypeError(`Invalid task date: ${value}`);
    }
    return parsed;
  }

  const parsed = new Date(value);
  return requireValidDate(parsed, `task date ${value}`);
}

function requireValidDate(date: Date, label: string): Date {
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`Invalid ${label}`);
  }
  return date;
}

function requireValidMinutes(minutes: number, label: string): void {
  if (!Number.isFinite(minutes) || minutes < 0) {
    throw new TypeError(`Invalid ${label}: ${String(minutes)}`);
  }
}

function dateRelation(date: Date, referenceDate: Date): TaskDateRelation {
  const difference = localDayIndex(date) - localDayIndex(referenceDate);
  if (difference < 0) return "overdue";
  if (difference === 0) return "today";
  if (difference === 1) return "tomorrow";
  return "absolute";
}

function localDayIndex(date: Date): number {
  return (
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) /
    MILLISECONDS_PER_DAY
  );
}

function formatLocalDate(date: Date): string {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatAbsoluteDate(
  date: Date,
  referenceDate: Date,
  month: "short" | "long",
): string {
  return date.toLocaleDateString("en-US", {
    month,
    day: "numeric",
    ...(date.getFullYear() === referenceDate.getFullYear()
      ? {}
      : { year: "numeric" }),
  });
}

function createCollectionAccessibility(
  singular: "Project" | "Context" | "Tag",
  values: readonly string[],
): string[] {
  if (values.length === 0) return [];
  const label = values.length === 1 ? singular : `${singular}s`;
  return [`${label} ${values.join(", ")}`];
}

function formatCompactDuration(minutes: number): string {
  if (minutes < 60) return `${String(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes === 0
    ? `${String(hours)}h`
    : `${String(hours)}h ${String(remainingMinutes)}m`;
}

function formatAccessibleDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  const parts: string[] = [];
  if (hours > 0) {
    parts.push(`${String(hours)} ${hours === 1 ? "hour" : "hours"}`);
  }
  if (hours === 0 || remainingMinutes > 0) {
    parts.push(
      `${String(remainingMinutes)} ${remainingMinutes === 1 ? "minute" : "minutes"}`,
    );
  }
  return parts.join(" ");
}
