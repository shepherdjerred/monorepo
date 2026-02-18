import {
  getIssues,
  type BugsinkIssue,
} from "../../lib/bugsink/index.ts";
import { getLevelEmoji } from "../../lib/bugsink/format.ts";
import { formatJson } from "../../lib/output/index.ts";

export type IssuesOptions = {
  json?: boolean | undefined;
  project?: string | undefined;
  limit?: number | undefined;
};

function formatIssue(issue: BugsinkIssue): string {
  const lines: string[] = [];

  const levelEmoji = getLevelEmoji(issue.level);

  lines.push(`- ${levelEmoji} **${issue.short_id}**: ${issue.title}`);
  lines.push(`  - Project: ${issue.project.name}`);
  lines.push(
    `  - Events: ${String(issue.count)} (${String(issue.user_count)} users)`,
  );

  if (issue.culprit != null && issue.culprit.length > 0) {
    lines.push(`  - Culprit: \`${issue.culprit}\``);
  }

  const lastSeen = new Date(issue.last_seen);
  lines.push(`  - Last seen: ${lastSeen.toLocaleString()}`);

  return lines.join("\n");
}

function formatIssuesMarkdown(issues: BugsinkIssue[]): string {
  const lines: string[] = [];

  lines.push("## Bugsink Issues");
  lines.push("");

  if (issues.length === 0) {
    lines.push("No unresolved issues found.");
    return lines.join("\n");
  }

  // Group by level
  const fatal = issues.filter((i) => i.level === "fatal");
  const errors = issues.filter((i) => i.level === "error");
  const warnings = issues.filter((i) => i.level === "warning");
  const other = issues.filter(
    (i) => i.level !== "fatal" && i.level !== "error" && i.level !== "warning",
  );

  if (fatal.length > 0) {
    lines.push(`### \uD83D\uDCA5 Fatal (${String(fatal.length)})`);
    lines.push("");
    for (const issue of fatal) {
      lines.push(formatIssue(issue));
      lines.push("");
    }
  }

  if (errors.length > 0) {
    lines.push(`### \uD83D\uDD34 Errors (${String(errors.length)})`);
    lines.push("");
    for (const issue of errors) {
      lines.push(formatIssue(issue));
      lines.push("");
    }
  }

  if (warnings.length > 0) {
    lines.push(`### \uD83D\uDFE1 Warnings (${String(warnings.length)})`);
    lines.push("");
    for (const issue of warnings) {
      lines.push(formatIssue(issue));
      lines.push("");
    }
  }

  if (other.length > 0) {
    lines.push(`### Other (${String(other.length)})`);
    lines.push("");
    for (const issue of other) {
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
