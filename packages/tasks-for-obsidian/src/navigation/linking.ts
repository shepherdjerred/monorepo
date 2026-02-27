import type { LinkingOptions, PathConfigMap } from "@react-navigation/native";

import { taskId } from "../domain/types";
import type { RootStackParamList } from "./types";

// Validate that a taskId param looks like a plausible task identifier (non-empty, no path traversal)
function isValidTaskId(value: string): boolean {
  return value.length > 0 && !value.includes("/") && !value.includes("..");
}

const screens: PathConfigMap<RootStackParamList> = {
  Main: {
    screens: {
      Inbox: "inbox",
      Today: "today",
      Upcoming: "upcoming",
      Browse: "browse",
    },
  },
  TaskDetail: {
    path: "task/:taskId",
    parse: {
      taskId: (value: string) => {
        if (!isValidTaskId(value)) return taskId("");
        return taskId(decodeURIComponent(value));
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
  config: { screens },
};
