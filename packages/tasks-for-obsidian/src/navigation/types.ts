import type {
  TaskId,
  ProjectName,
  ContextName,
  TagName,
} from "../domain/types";

export type RootStackParamList = {
  Main: undefined;
  TaskDetail: { taskId: TaskId };
  ProjectDetail: { projectName: ProjectName };
  ContextDetail: { contextName: ContextName };
  TagDetail: { tagName: TagName };
  SavedView: { viewId: string };
  JobSearchKanban: undefined;
  QuickAdd: { initialText?: string } | undefined;
  Search: undefined;
  Settings: undefined;
  Pomodoro: { taskId?: TaskId } | undefined;
  TimeReport: undefined;
};

export type MainTabParamList = {
  Inbox: undefined;
  Today: undefined;
  Upcoming: undefined;
  Browse: undefined;
};
