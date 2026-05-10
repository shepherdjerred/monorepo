import type { BugsinkIssue } from "./types.ts";

export function getIssueStatusLabel(issue: BugsinkIssue): string {
  if (issue.is_muted) return "muted";
  if (issue.is_resolved) return "resolved";
  return "unresolved";
}
