import type { CivilDay } from "./civil-day.ts";
import { parseSavedFilter } from "./saved-filter.ts";
import type { WorkspaceData } from "#sync/sync.ts";
import {
  completedTasks,
  inboxTasks,
  inactiveProjectIds,
  labelTasks,
  matchesSearch,
  projectGroups,
  sortTasks,
  todayGroups,
  upcomingGroups,
  upcomingWeek,
  type Destination,
  type ProjectPreferences,
  type WorkspaceView,
} from "./workspace.ts";

export function workspaceView(input: {
  data: WorkspaceData;
  destination: Destination;
  search: string;
  today: CivilDay;
  timeZone: string;
  upcomingOffset: number;
  projectPreferences?: ProjectPreferences;
}): WorkspaceView {
  const { data, destination, search, today: current, timeZone } = input;
  switch (destination.kind) {
    case "section":
      switch (destination.section) {
        case "inbox":
          return {
            title: "Inbox",
            groups: [
              {
                id: "inbox",
                title: "Inbox",
                overdue: false,
                tasks: inboxTasks(data, search),
              },
            ],
            week: [],
          };
        case "today":
          return {
            title: "Today",
            groups: todayGroups(data, search, current, timeZone),
            week: [],
          };
        case "upcoming":
          return {
            title: "Upcoming",
            groups: upcomingGroups({
              data,
              search,
              current,
              timeZone,
              offset: input.upcomingOffset,
            }),
            week: upcomingWeek(data, current, timeZone, input.upcomingOffset),
          };
        case "completed":
          return {
            title: "Completed",
            groups: [
              {
                id: "completed",
                title: "Completed",
                overdue: false,
                tasks: completedTasks(data, search),
              },
            ],
            week: [],
          };
        default: {
          const unreachable: never = destination.section;
          throw new Error(`Unknown section: ${JSON.stringify(unreachable)}`);
        }
      }
    case "project": {
      const project = data.projects.find((item) => item.id === destination.id);
      return {
        title: project?.name ?? "Project",
        groups: projectGroups(
          data,
          destination.id,
          search,
          input.projectPreferences,
        ),
        week: [],
      };
    }
    case "label": {
      const label = data.labels.find((item) => item.id === destination.id);
      return {
        title: label === undefined ? "Label" : `@${label.name}`,
        groups: [
          {
            id: `label.${destination.id}`,
            title: label?.name ?? "Label",
            overdue: false,
            tasks: labelTasks(data, destination.id, search),
          },
        ],
        week: [],
      };
    }
    case "filter": {
      const filter = data.filters.find(
        (item) => item.id === destination.id && !item.is_deleted,
      );
      const title = filter?.name ?? "Filter";
      if (filter === undefined)
        return {
          title,
          groups: [],
          week: [],
          message: "This filter is no longer available.",
        };
      try {
        const parsed = parseSavedFilter(filter.query);
        const inactive = inactiveProjectIds(data.projects);
        const tasks = data.tasks
          .filter(
            (task) =>
              !task.is_deleted &&
              (task.parent_id ?? "") === "" &&
              !inactive.has(task.project_id) &&
              (parsed.includesCompleted || !task.completed) &&
              matchesSearch(task, search) &&
              parsed.matches(task, { data, today: current, timeZone }),
          )
          .sort(sortTasks);
        return {
          title,
          groups: [{ id: `filter.${filter.id}`, title, overdue: false, tasks }],
          week: [],
        };
      } catch (error) {
        return {
          title,
          groups: [],
          week: [],
          message:
            error instanceof Error
              ? error.message
              : "This filter could not be read.",
        };
      }
    }
    default: {
      const unreachable: never = destination;
      throw new Error(`Unknown destination: ${JSON.stringify(unreachable)}`);
    }
  }
}
