import type { NavigatorScreenParams } from "@react-navigation/native";

import type {
  TaskId,
  ProjectName,
  ContextName,
  TagName,
} from "../domain/types";
import type { CaptureSeedRouteParams } from "../domain/quick-capture-seed";

export type RootStackParamList = {
  Main: NavigatorScreenParams<MainTabParamList> | undefined;
  TaskDetail: { taskId: TaskId };
  ProjectDetail: { projectName: ProjectName };
  ContextDetail: { contextName: ContextName };
  TagDetail: { tagName: TagName };
  SavedView: { viewId: string };
  JobSearchKanban: undefined;
  QuickAdd: CaptureSeedRouteParams | undefined;
  Search: undefined;
  Settings: undefined;
  Pomodoro: { taskId?: TaskId } | undefined;
  TimeReport: undefined;
};

export type MainTabParamList = {
  Inbox: { selectionMode?: boolean } | undefined;
  Today: { selectionMode?: boolean } | undefined;
  Upcoming:
    | { selectedDay?: string | null; selectionMode?: boolean }
    | undefined;
  Browse: undefined;
};
