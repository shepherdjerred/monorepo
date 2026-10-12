export type ForumStage = "beta" | "prod";
export type StormForumActivities = {
  maintainStormForum: () => Promise<void>;
  beginStormForumBackup: (owner: string) => Promise<void>;
  snapshotStormForum: (owner: string) => Promise<{ manifestKey: string }>;
  endStormForumBackup: (owner: string) => Promise<void>;
};
