import type { TaskId, ProjectName } from "../domain/types";

export type RootStackParamList = {
  Main: undefined;
  TaskDetail: { taskId: TaskId };
  ProjectDetail: { projectName: ProjectName };
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
