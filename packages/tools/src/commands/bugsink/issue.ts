import { getIssue } from "#lib/bugsink/issues.ts";
import type { BugsinkIssue } from "#lib/bugsink/types.ts";
import { getIssueStatusLabel } from "#lib/bugsink/format.ts";
import { formatJson } from "#lib/output/formatter.ts";

export type IssueOptions = {
  json?: boolean | undefined;
};

function formatIssueDetails(issue: BugsinkIssue): string {
  const lines: string[] = [];
  const status = getIssueStatusLabel(issue);

  lines.push(`## Issue: ${issue.calculated_type}`);
  lines.push("");

  lines.push("### Details");
  lines.push("");
  lines.push(`- **ID:** ${issue.id}`);
  lines.push(`- **Type:** ${issue.calculated_type}`);
  lines.push(`- **Status:** ${status}`);
  if (issue.is_resolved_by_next_release) {
    lines.push("- **Resolved by:** next release");
  }
  lines.push(`- **Project ID:** ${String(issue.project)}`);
  lines.push("");

  lines.push("### Value");
  lines.push("");
  lines.push("```");
  lines.push(issue.calculated_value);
  lines.push("```");
  lines.push("");

  lines.push("### Event Counts");
  lines.push("");
  lines.push(`- **Digested:** ${String(issue.digested_event_count)}`);
  lines.push(`- **Stored:** ${String(issue.stored_event_count)}`);
  lines.push("");

  lines.push("### Timeline");
  lines.push("");
  lines.push(
    `- **First seen:** ${new Date(issue.first_seen).toLocaleString()}`,
  );
  lines.push(
    `- **Last seen:** ${new Date(issue.last_seen).toLocaleString()}`,
  );
  lines.push("");

  if (issue.transaction.length > 0) {
    lines.push(`- **Transaction:** ${issue.transaction}`);
    lines.push("");
  }

  lines.push("To view events for this issue:");
  lines.push("```bash");
  lines.push(`tools bugsink events ${issue.id}`);
  lines.push("```");

  return lines.join("\n");
}

export async function issueCommand(
  issueId: string,
  options: IssueOptions = {},
): Promise<void> {
  try {
    const issue = await getIssue(issueId);

    if (issue == null) {
      console.error(`Error: Issue ${issueId} not found`);
      process.exit(1);
    }

    if (options.json === true) {
      console.log(formatJson(issue));
    } else {
      console.log(formatIssueDetails(issue));
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}
