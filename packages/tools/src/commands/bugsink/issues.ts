import { getIssues } from "#lib/bugsink/issues.ts";
import type { BugsinkIssue } from "#lib/bugsink/types.ts";
import { getIssueStatusLabel } from "#lib/bugsink/format.ts";
import { formatJson } from "#lib/output/formatter.ts";

export type IssuesOptions = {
  json?: boolean | undefined;
  project?: string | undefined;
  limit?: number | undefined;
};

function formatIssue(issue: BugsinkIssue): string {
  const lines: string[] = [];
  const status = getIssueStatusLabel(issue);

  lines.push(`- **${issue.calculated_type}**: ${issue.calculated_value}`);
  lines.push(`  - ID: ${issue.id}`);
  lines.push(`  - Status: ${status}`);
  lines.push(
    `  - Events: ${String(issue.digested_event_count)} digested, ${String(issue.stored_event_count)} stored`,
  );
  lines.push(
    `  - Last seen: ${new Date(issue.last_seen).toLocaleString()}`,
  );

  return lines.join("\n");
}

function formatIssuesMarkdown(issues: BugsinkIssue[]): string {
  const lines: string[] = [];

  lines.push("## Bugsink Issues");
  lines.push("");

  if (issues.length === 0) {
    lines.push("No issues found.");
    return lines.join("\n");
  }

  const unresolved = issues.filter(
    (i) => !i.is_resolved && !i.is_muted,
  );
  const resolved = issues.filter((i) => i.is_resolved);
  const muted = issues.filter((i) => i.is_muted);

  if (unresolved.length > 0) {
    lines.push(`### Unresolved (${String(unresolved.length)})`);
    lines.push("");
    for (const issue of unresolved) {
      lines.push(formatIssue(issue));
      lines.push("");
    }
  }

  if (resolved.length > 0) {
    lines.push(`### Resolved (${String(resolved.length)})`);
    lines.push("");
    for (const issue of resolved) {
      lines.push(formatIssue(issue));
      lines.push("");
    }
  }

  if (muted.length > 0) {
    lines.push(`### Muted (${String(muted.length)})`);
    lines.push("");
    for (const issue of muted) {
      lines.push(formatIssue(issue));
      lines.push("");
    }
  }

  lines.push("---");
  lines.push("");
  lines.push("To view issue details:");
  lines.push("```bash");
  lines.push("tools bugsink issue <ISSUE_ID>");
  lines.push("```");

  return lines.join("\n");
}

export async function issuesCommand(
  options: IssuesOptions = {},
): Promise<void> {
  try {
    const issues = await getIssues({
      project: options.project,
      limit: options.limit,
    });

    if (options.json === true) {
      console.log(formatJson(issues));
    } else {
      console.log(formatIssuesMarkdown(issues));
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}
