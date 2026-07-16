import type { TaskInfo, TaskNotesModelConfig } from "tasknotes-types/v2";
import { isCompletedStatus } from "tasknotes-types/v2";

/**
 * Time-tracking reports — transcribed from upstream
 * `src/utils/timeTrackingUtils.ts` so the wire shapes match the plugin's
 * API exactly. Time entries live in task FRONTMATTER (the plugin's format;
 * review finding #16 killed the old `_tasknotes/time-tracking.json`
 * side-store the plugin couldn't see). The `now` parameter is injected —
 * open sessions accrue minutes against it.
 */

export type TimeSummaryOptions = {
  period: string;
  fromDate?: Date | undefined;
  toDate?: Date | undefined;
};

export type TimeSummaryResult = {
  period: string;
  dateRange: { from: string; to: string };
  summary: {
    totalMinutes: number;
    totalHours: number;
    tasksWithTime: number;
    activeTasks: number;
    completedTasks: number;
  };
  topTasks: { task: string; title: string; minutes: number }[];
  topProjects: { project: string; minutes: number }[];
  topTags?: { tag: string; minutes: number }[];
};

function computeDateRange(
  options: TimeSummaryOptions,
  now: Date,
): { startDate: Date; endDate: Date } {
  let startDate: Date;
  let endDate = new Date(now);

  switch (options.period) {
    case "today":
      startDate = new Date(now);
      startDate.setHours(0, 0, 0, 0);
      break;
    case "week":
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - startDate.getDay());
      startDate.setHours(0, 0, 0, 0);
      break;
    case "month":
      startDate = new Date(now);
      startDate.setDate(1);
      startDate.setHours(0, 0, 0, 0);
      break;
    case "all":
      startDate = new Date(0);
      break;
    default:
      if (options.fromDate === undefined) {
        startDate = new Date(now);
        startDate.setHours(0, 0, 0, 0);
      } else {
        startDate = options.fromDate;
        if (options.toDate !== undefined) endDate = options.toDate;
      }
  }
  return { startDate, endDate };
}

function taskMinutesInRange(
  task: TaskInfo,
  startDate: Date,
  endDate: Date,
  now: Date,
): { minutes: number; hasActiveSession: boolean } {
  let minutes = 0;
  let hasActiveSession = false;
  for (const entry of task.timeEntries ?? []) {
    const entryStart = new Date(entry.startTime);
    if (entryStart < startDate || entryStart > endDate) continue;
    if (entry.endTime === undefined) {
      minutes += Math.floor((now.getTime() - entryStart.getTime()) / 60_000);
      hasActiveSession = true;
    } else {
      const entryEnd = new Date(entry.endTime);
      minutes += Math.floor(
        (entryEnd.getTime() - entryStart.getTime()) / 60_000,
      );
    }
  }
  return { minutes, hasActiveSession };
}

export function computeTimeSummary(
  tasks: readonly TaskInfo[],
  options: TimeSummaryOptions,
  config: TaskNotesModelConfig,
  now: Date,
): TimeSummaryResult {
  const { startDate, endDate } = computeDateRange(options, now);

  let totalMinutes = 0;
  let completedTasks = 0;
  let activeTasks = 0;
  const taskStats: { task: string; title: string; minutes: number }[] = [];
  const projectStats = new Map<string, number>();
  const tagStats = new Map<string, number>();

  for (const task of tasks) {
    const { minutes, hasActiveSession } = taskMinutesInRange(
      task,
      startDate,
      endDate,
      now,
    );
    if (minutes <= 0) continue;
    totalMinutes += minutes;
    taskStats.push({ task: task.path, title: task.title, minutes });
    if (hasActiveSession) activeTasks += 1;
    else if (isCompletedStatus(task.status, config.statuses)) {
      completedTasks += 1;
    }
    for (const project of task.projects ?? []) {
      projectStats.set(project, (projectStats.get(project) ?? 0) + minutes);
    }
    for (const tag of task.tags ?? []) {
      tagStats.set(tag, (tagStats.get(tag) ?? 0) + minutes);
    }
  }

  taskStats.sort((a, b) => b.minutes - a.minutes);
  const topProjects = [...projectStats.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([project, minutes]) => ({ project, minutes }));
  const topTags = [...tagStats.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([tag, minutes]) => ({ tag, minutes }));

  return {
    period: options.period,
    dateRange: { from: startDate.toISOString(), to: endDate.toISOString() },
    summary: {
      totalMinutes,
      totalHours: Math.round((totalMinutes / 60) * 100) / 100,
      tasksWithTime: taskStats.length,
      activeTasks,
      completedTasks,
    },
    topTasks: taskStats.slice(0, 10),
    topProjects,
    topTags,
  };
}

export type ActiveSessionsResult = {
  activeSessions: {
    task: {
      id: string;
      title: string;
      status: string;
      priority: string;
      tags: string[];
      projects: string[];
    };
    session: {
      startTime: string;
      description?: string;
      elapsedMinutes: number;
    };
    elapsedMinutes: number;
  }[];
  totalActiveSessions: number;
  totalElapsedMinutes: number;
};

/** GET /api/time/active — every open (endTime-less) session, live elapsed. */
export function computeActiveSessions(
  tasks: readonly TaskInfo[],
  now: Date,
): ActiveSessionsResult {
  const activeSessions: ActiveSessionsResult["activeSessions"] = [];
  for (const task of tasks) {
    for (const entry of task.timeEntries ?? []) {
      if (entry.endTime !== undefined) continue;
      const elapsedMinutes = Math.floor(
        (now.getTime() - new Date(entry.startTime).getTime()) / 60_000,
      );
      activeSessions.push({
        task: {
          id: task.path,
          title: task.title,
          status: task.status,
          priority: task.priority,
          tags: task.tags ?? [],
          projects: task.projects ?? [],
        },
        session: {
          startTime: entry.startTime,
          ...(entry.description === undefined
            ? {}
            : { description: entry.description }),
          elapsedMinutes,
        },
        elapsedMinutes,
      });
    }
  }
  return {
    activeSessions,
    totalActiveSessions: activeSessions.length,
    totalElapsedMinutes: activeSessions.reduce(
      (sum, s) => sum + s.elapsedMinutes,
      0,
    ),
  };
}
