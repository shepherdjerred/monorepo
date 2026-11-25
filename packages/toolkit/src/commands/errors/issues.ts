import {
  getEvent,
  getEventStacktrace,
  getEventStacktraceJson,
  getIssue,
  getIssueEvents,
  getIssues,
  type ErrorsIssuesQuery,
} from "#lib/errors/client.ts";
import type { ErrorsRequestOptions } from "#lib/errors/http.ts";
import type {
  EventDetail,
  EventListItem,
  IssueDetail,
  IssueListItem,
} from "@shepherdjerred/errors/contract";
import { formatJson } from "#lib/output/formatter.ts";

export type IssuesCommandOptions = ErrorsIssuesQuery &
  ErrorsRequestOptions & {
    readonly json?: boolean | undefined;
  };

export type SingleCommandOptions = ErrorsRequestOptions & {
  readonly json?: boolean | undefined;
};

function formatIssueLine(issue: IssueListItem): string {
  const lines: string[] = [];
  lines.push(`- **${issue.type}**: ${issue.value}`);
  lines.push(`  - ID: ${issue.id}`);
  lines.push(`  - Project: ${issue.projectName} (\`${issue.projectSlug}\`)`);
  lines.push(
    `  - State: ${issue.state}${issue.regressedCount > 0 ? ` (regressed ${String(issue.regressedCount)}x)` : ""}`,
  );
  lines.push(
    `  - Events: ${String(issue.digestedEventCount)} digested, ${String(issue.storedEventCount)} stored`,
  );
  lines.push(`  - Last seen: ${issue.lastSeen}`);
  if (issue.trackerIssueIdentifier !== null) {
    lines.push(`  - Tracker: ${issue.trackerIssueIdentifier}`);
  }
  return lines.join("\n");
}

function formatIssuesMarkdown(issues: readonly IssueListItem[]): string {
  const lines: string[] = [];
  lines.push("## Errors Issues");
  lines.push("");
  if (issues.length === 0) {
    lines.push("No issues found.");
    return lines.join("\n");
  }
  for (const issue of issues) {
    lines.push(formatIssueLine(issue));
    lines.push("");
  }
  lines.push("---");
  lines.push("To view issue details:");
  lines.push("```bash");
  lines.push("toolkit errors issue <ISSUE_UUID>");
  lines.push("```");
  return lines.join("\n");
}

function formatIssueDetailMarkdown(issue: IssueDetail): string {
  const lines: string[] = [];
  lines.push(`## Issue: ${issue.type}`);
  lines.push("");
  lines.push(`- **ID:** ${issue.id}`);
  lines.push(`- **Project:** ${issue.projectName} (\`${issue.projectSlug}\`)`);
  lines.push(`- **State:** ${issue.state}`);
  lines.push(`- **Level:** ${issue.level}`);
  if (issue.resolvedInRelease !== null) {
    lines.push(`- **Resolved in release:** ${issue.resolvedInRelease}`);
  }
  if (issue.trackerIssueIdentifier !== null) {
    lines.push(`- **Tracker issue:** ${issue.trackerIssueIdentifier}`);
  }
  lines.push(
    `- **Events:** ${String(issue.digestedEventCount)} digested, ${String(issue.storedEventCount)} stored (regressed: ${String(issue.regressedCount)})`,
  );
  lines.push(`- **First seen:** ${issue.firstSeen}`);
  lines.push(`- **Last seen:** ${issue.lastSeen}`);
  if (issue.transaction.length > 0) {
    lines.push(`- **Transaction:** ${issue.transaction}`);
  }
  lines.push("");
  lines.push("### Value");
  lines.push("");
  lines.push("```");
  lines.push(issue.value);
  lines.push("```");

  if (issue.latestEvent !== null && issue.latestEvent.stacktraceMd.length > 0) {
    lines.push("");
    lines.push("### Latest Event Stacktrace");
    lines.push("");
    lines.push(issue.latestEvent.stacktraceMd);
  }
  return lines.join("\n");
}

function formatEventsMarkdown(events: readonly EventListItem[]): string {
  const lines: string[] = [];
  lines.push("## Issue Events");
  lines.push("");
  if (events.length === 0) {
    lines.push("No events found.");
    return lines.join("\n");
  }
  for (const event of events) {
    lines.push(
      `- **${event.eventId}** (id: \`${event.id}\`, level: ${event.level}, timestamp: ${event.timestamp})`,
    );
  }
  return lines.join("\n");
}

function formatEventDetailMarkdown(event: EventDetail): string {
  const lines: string[] = [];
  lines.push(`## Event: ${event.eventId}`);
  lines.push("");
  lines.push(`- **ID:** ${event.id}`);
  lines.push(`- **Event ID:** ${event.eventId}`);
  lines.push(`- **Issue ID:** ${event.issueId}`);
  lines.push(`- **Project ID:** ${String(event.projectId)}`);
  lines.push(`- **Level:** ${event.level}`);
  lines.push(`- **Timestamp:** ${event.timestamp}`);
  lines.push(`- **Ingested:** ${event.ingestedAt}`);
  if (event.release !== null) {
    lines.push(`- **Release:** ${event.release}`);
  }
  if (event.environment !== null) {
    lines.push(`- **Environment:** ${event.environment}`);
  }
  if (event.stacktraceMd.length > 0) {
    lines.push("");
    lines.push("### Stacktrace");
    lines.push("");
    lines.push(event.stacktraceMd);
  }
  return lines.join("\n");
}

export async function issuesCommand(
  options: IssuesCommandOptions = {},
): Promise<void> {
  const issues = await getIssues(options, { baseUrl: options.baseUrl });
  console.log(
    options.json === true ? formatJson(issues) : formatIssuesMarkdown(issues),
  );
}

export async function issueCommand(
  id: string,
  options: SingleCommandOptions = {},
): Promise<void> {
  const issue = await getIssue(id, { baseUrl: options.baseUrl });
  console.log(
    options.json === true
      ? formatJson(issue)
      : formatIssueDetailMarkdown(issue),
  );
}

export async function eventsCommand(
  issueId: string,
  options: SingleCommandOptions & { readonly limit?: number | undefined } = {},
): Promise<void> {
  const events = await getIssueEvents(
    issueId,
    { limit: options.limit },
    { baseUrl: options.baseUrl },
  );
  console.log(
    options.json === true ? formatJson(events) : formatEventsMarkdown(events),
  );
}

export async function eventCommand(
  eventId: string,
  options: SingleCommandOptions = {},
): Promise<void> {
  const event = await getEvent(eventId, { baseUrl: options.baseUrl });
  console.log(
    options.json === true
      ? formatJson(event)
      : formatEventDetailMarkdown(event),
  );
}

export async function stacktraceCommand(
  eventId: string,
  options: SingleCommandOptions = {},
): Promise<void> {
  if (options.json === true) {
    const jsonResult = await getEventStacktraceJson(eventId, {
      baseUrl: options.baseUrl,
    });
    console.log(formatJson(jsonResult));
    return;
  }
  const markdown = await getEventStacktrace(eventId, {
    baseUrl: options.baseUrl,
  });
  console.log(markdown);
}
