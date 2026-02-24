import type { LinkingOptions } from "@react-navigation/native";
import type { RootStackParamList } from "./types";

export const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ["tasknotes://"],
  config: {
    screens: {
      Main: {
        screens: {
          Inbox: "inbox",
          Today: "today",
          Upcoming: "upcoming",
          Browse: "browse",
        },
      },
      TaskDetail: "task/:taskId",
      ProjectDetail: "project/:projectName",
      QuickAdd: "quick-add",
      Search: "search",
      Settings: "settings",
      Pomodoro: "pomodoro",
      TimeReport: "time-report",
    },
  },
};
