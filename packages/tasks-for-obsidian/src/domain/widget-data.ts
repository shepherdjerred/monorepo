import { deriveTodayAgenda } from "./agenda";
import { isCompletedOn } from "./recurrence";
import { isActiveStatus } from "./status";
import { deriveTaskPresentation } from "./task-presentation";
import type { Task } from "./types";
import { parseLocalDate, toISODate } from "../lib/dates";

export type WidgetTaskProjection = {
  readonly id: string;
  readonly title: string;
  readonly priority: string;
  readonly completed: boolean;
  readonly due?: string | undefined;
  readonly dateLabel?: string | undefined;
  readonly project?: string | undefined;
};

export type WidgetStatsProjection = {
  readonly total: number;
  readonly overdue: number;
  readonly today: number;
};

export type WidgetDataProjection = {
  readonly todayTasks: readonly WidgetTaskProjection[];
  readonly stats: WidgetStatsProjection;
};

export type WidgetDataEnvelope = {
  readonly schemaVersion: 2;
  readonly generatedAt: string;
  readonly projections: Readonly<Record<string, WidgetDataProjection>>;
};

export function deriveWidgetData(
  tasks: readonly Task[],
  today: string,
  referenceDate: Date,
): WidgetDataProjection {
  const agenda = deriveTodayAgenda(tasks, today);
  const entries = agenda.flatMap((section) => section.entries);
  const todayTasks = entries.slice(0, 8).map((entry) => {
    const presentation = deriveTaskPresentation(entry.task, {
      referenceDate,
      pending: false,
      dateContext: { kind: entry.primaryKind, date: entry.day },
    });
    const dateMetadata = presentation.metadata.find(
      (item) =>
        (item.kind === "planned" || item.kind === "deadline") &&
        item.kind === entry.primaryKind &&
        item.date === entry.day,
    );
    if (dateMetadata === undefined) {
      throw new Error(
        `widget: missing ${entry.primaryKind} presentation for ${entry.task.id}`,
      );
    }
    const projectMetadata = presentation.metadata.find(
      (item) => item.kind === "project",
    );
    const project =
      projectMetadata?.kind === "project" ? projectMetadata.value : undefined;
    return {
      id: String(entry.task.id),
      title: entry.task.title,
      priority: entry.task.priority,
      completed: isCompletedOn(entry.task, entry.completionDay ?? entry.day),
      ...(entry.task.due === undefined ? {} : { due: entry.task.due }),
      dateLabel: dateMetadata.label,
      ...(project === undefined ? {} : { project }),
    };
  });

  return {
    todayTasks,
    stats: {
      total: tasks.filter(
        (task) => !task.archived && isActiveStatus(task.status),
      ).length,
      overdue:
        agenda.find((section) => section.key === "overdue")?.entries.length ??
        0,
      today: agenda
        .filter((section) => section.key !== "overdue")
        .reduce((count, section) => count + section.entries.length, 0),
    },
  };
}

export function deriveWidgetDataEnvelope(
  tasks: readonly Task[],
  startDay: string,
  generatedAt: string,
  horizonDays = 8,
): WidgetDataEnvelope {
  if (!Number.isInteger(horizonDays) || horizonDays < 1) {
    throw new RangeError("widget: horizonDays must be a positive integer");
  }
  const start = parseLocalDate(startDay);
  if (Number.isNaN(start.getTime()) || toISODate(start) !== startDay) {
    throw new TypeError(`widget: invalid start day "${startDay}"`);
  }
  if (Number.isNaN(Date.parse(generatedAt))) {
    throw new TypeError(`widget: invalid generatedAt "${generatedAt}"`);
  }

  const projections: Record<string, WidgetDataProjection> = {};
  for (let offset = 0; offset < horizonDays; offset += 1) {
    const date = new Date(start);
    date.setDate(date.getDate() + offset);
    const projectionDay = toISODate(date);
    const referenceDate = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      12,
    );
    projections[projectionDay] = deriveWidgetData(
      tasks,
      projectionDay,
      referenceDate,
    );
  }

  return { schemaVersion: 2, generatedAt, projections };
}
