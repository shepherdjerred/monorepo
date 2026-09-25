import type { BugsinkIssue } from "./types.ts";

export function getIssueStatusLabel(issue: BugsinkIssue): string {
  if (issue.is_muted) return "muted";
  return issue.is_resolved ? "resolved" : "unresolved";
}
