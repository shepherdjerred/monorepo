export { bugsinkRequest, type BugsinkClientResult } from "./client.ts";
export {
  getIssues,
  getIssue,
  getIssueEvents,
  getLatestEvent,
  type GetIssuesOptions,
} from "./issues.ts";
export type {
  BugsinkIssue,
  BugsinkIssueStatus,
  BugsinkIssueLevel,
  BugsinkProject,
  BugsinkEvent,
  BugsinkEventTag,
  BugsinkEventUser,
  BugsinkException,
  BugsinkStacktraceFrame,
} from "./types.ts";
