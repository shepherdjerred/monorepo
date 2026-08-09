import type { LinkingOptions, PathConfigMap } from "@react-navigation/native";

import { taskId } from "../domain/types";
import { calendarDayOrNull } from "../domain/calendar-day";
import type { RootStackParamList } from "./types";

// Task IDs are vault-relative paths. Allow internal separators while rejecting
// absolute paths, empty segments, and traversal.
function isValidTaskId(value: string): boolean {
  if (value.length === 0 || value.startsWith("/") || value.includes("\\")) {
    return false;
  }
  return value
    .split("/")
    .every(
      (segment) => segment.length > 0 && segment !== "." && segment !== "..",
    );
}

const screens: PathConfigMap<RootStackParamList> = {
  Main: {
    screens: {
      Inbox: "inbox",
      Today: "today",
      Upcoming: {
        path: "upcoming",
        parse: { selectedDay: calendarDayOrNull },
      },
      Browse: "browse",
    },
  },
  TaskDetail: {
    path: "task/:taskId",
    parse: {
      taskId: (value: string) => {
        if (!isValidTaskId(value)) return taskId("");
        return taskId(value);
      },
    },
  },
  ProjectDetail: "project/:projectName",
  ContextDetail: "context/:contextName",
  TagDetail: "tag/:tagName",
  SavedView: "view/:viewId",
  JobSearchKanban: "kanban",
  QuickAdd: "quick-add",
  Search: "search",
  Settings: "settings",
  Pomodoro: "pomodoro",
  TimeReport: "time-report",
};

export const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ["tasknotes://"],
  config: { initialRouteName: "Main", screens },
};
