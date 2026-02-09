import {
  getIssue,
  getLatestEvent,
  type BugsinkIssue,
  type BugsinkEvent,
  type BugsinkIssueLevel,
} from "../../lib/bugsink/index.ts";
import { formatJson } from "../../lib/output/index.ts";

export type IssueOptions = {
  json?: boolean | undefined;
};

function getLevelEmoji(level: BugsinkIssueLevel): string {
  switch (level) {
    case "fatal":
      return "\uD83D\uDCA5";
    case "error":
      return "\uD83D\uDD34";
    case "warning":
      return "\uD83D\uDFE1";
    case "info":
      return "\uD83D\uDD35";
    case "debug":
      return "\u26AA";
  }
}

function formatStacktrace(event: BugsinkEvent): string[] {
  const lines: string[] = [];

  if (!event.exception?.values) {
    return lines;
  }

  for (const exception of event.exception.values) {
    lines.push(`**${exception.type}:** ${exception.value}`);
    lines.push("");

    if (exception.stacktrace && exception.stacktrace.frames.length > 0) {
      lines.push("```");
      // Show frames in reverse order (most recent first)
      const frames = [...exception.stacktrace.frames].reverse().slice(0, 10);
      for (const frame of frames) {
        const location = frame.lineno
          ? `${frame.filename}:${String(frame.lineno)}`
          : frame.filename;
        const inApp = frame.in_app ? "" : " (library)";
        lines.push(`  at ${frame.function} (${location})${inApp}`);
      }
      if (exception.stacktrace.frames.length > 10) {
        lines.push(`  ... ${String(exception.stacktrace.frames.length - 10)} more frames`);
      }
      lines.push("```");
    }
  }

  return lines;
}

function formatIssueDetails(
  issue: BugsinkIssue,
  latestEvent: BugsinkEvent | null
): string {
  const lines: string[] = [];

  lines.push(`## Issue ${issue.short_id}: ${issue.title}`);
  lines.push("");

  // Status section
  lines.push(`### Level: ${getLevelEmoji(issue.level)} ${issue.level.toUpperCase()}`);
  lines.push("");

  // Details
  lines.push("### Details");
  lines.push("");
  lines.push(`- **ID:** ${issue.id}`);
  lines.push(`- **Short ID:** ${issue.short_id}`);
  lines.push(`- **Project:** ${issue.project.name}`);
  lines.push(`- **Status:** ${issue.status}`);

  if (issue.culprit) {
    lines.push(`- **Culprit:** \`${issue.culprit}\``);
  }

  lines.push(`- **Events:** ${String(issue.count)}`);
  lines.push(`- **Users affected:** ${String(issue.user_count)}`);
  lines.push(`- **First seen:** ${new Date(issue.first_seen).toLocaleString()}`);
  lines.push(`- **Last seen:** ${new Date(issue.last_seen).toLocaleString()}`);
  lines.push("");

  // Metadata
  if (issue.metadata.type || issue.metadata.value) {
    lines.push("### Error Info");
    lines.push("");
    if (issue.metadata.type) {
      lines.push(`- **Type:** ${issue.metadata.type}`);
    }
    if (issue.metadata.value) {
      lines.push(`- **Value:** ${issue.metadata.value}`);
    }
    if (issue.metadata.filename) {
      lines.push(`- **File:** ${issue.metadata.filename}`);
    }
    if (issue.metadata.function) {
      lines.push(`- **Function:** ${issue.metadata.function}`);
    }
    lines.push("");
  }

  // Latest event details
  if (latestEvent) {
    lines.push("### Latest Event");
    lines.push("");
    lines.push(`- **Event ID:** ${latestEvent.event_id}`);
    lines.push(`- **Occurred:** ${new Date(latestEvent.timestamp).toLocaleString()}`);

    if (latestEvent.user) {
      const user = latestEvent.user;
      const userInfo =
        user.email ?? user.username ?? user.id ?? user.ip_address ?? "anonymous";
      lines.push(`- **User:** ${userInfo}`);
    }
    lines.push("");

    // Tags
    if (latestEvent.tags.length > 0) {
      lines.push("#### Tags");
      lines.push("");
      for (const tag of latestEvent.tags.slice(0, 10)) {
        lines.push(`- **${tag.key}:** ${tag.value}`);
      }
      lines.push("");
    }

    // Exception/Stacktrace
    if (latestEvent.exception?.values) {
      lines.push("#### Stacktrace");
      lines.push("");
      const stackLines = formatStacktrace(latestEvent);
      lines.push(...stackLines);
      lines.push("");
    }
  }

  return lines.join("\n");
}

export async function issueCommand(
  issueId: string,
  options: IssueOptions = {}
): Promise<void> {
  try {
    const issue = await getIssue(issueId);

    if (!issue) {
      console.error(`Error: Issue ${issueId} not found`);
      process.exit(1);
    }

    if (options.json) {
      const latestEvent = await getLatestEvent(issueId);
      console.log(formatJson({ issue, latestEvent }));
    } else {
      const latestEvent = await getLatestEvent(issueId);
      console.log(formatIssueDetails(issue, latestEvent));
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}
