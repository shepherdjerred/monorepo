import type {
  RetentionPipeline,
  RetentionCandidate,
} from "#shared/woodpecker-retention.ts";
export const retentionTestRepo = {
  id: 1,
  full_name: "shepherdjerred/monorepo",
  default_branch: "main",
};
export const retentionTestPipeline: RetentionPipeline = {
  number: 1,
  status: "failure",
  created: 10,
  finished: 20,
  commit: "a".repeat(40),
  branch: "feature",
  ref: "refs/pull/5/merge",
};
export const retentionTestCandidate: RetentionCandidate = {
  repo: retentionTestRepo,
  pipeline: retentionTestPipeline,
  logEntries: 1,
};
