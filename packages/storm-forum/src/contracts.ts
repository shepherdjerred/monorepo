export type ForumStage = "beta" | "prod";
export type StormForumActivities = {
  maintainStormForum: () => Promise<void>;
};
