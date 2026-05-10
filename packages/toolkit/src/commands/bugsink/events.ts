import { getEvents, getEvent } from "#lib/bugsink/queries.ts";
import type {
  BugsinkEventListItem,
  BugsinkEventDetail,
} from "#lib/bugsink/types.ts";
import { formatJson } from "#lib/output/formatter.ts";

export type EventsOptions = {
  json?: boolean | undefined;
};

export type EventOptions = {
  json?: boolean | undefined;
};

function formatEventsMarkdown(events: BugsinkEventListItem[]): string {
  const lines: string[] = [];

  lines.push("## Bugsink Events");
  lines.push("");

  if (events.length === 0) {
    lines.push("No events found.");
    return lines.join("\n");
  }

  for (const event of events) {
    lines.push(`- **${event.event_id}**`);
    lines.push(`  - ID: ${event.id}`);
    lines.push(`  - Issue: ${event.issue}`);
    lines.push(`  - Timestamp: ${new Date(event.timestamp).toLocaleString()}`);
    lines.push(`  - Ingested: ${new Date(event.ingested_at).toLocaleString()}`);
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push("To view event details:");
  lines.push("```bash");
  lines.push("tools bugsink event <EVENT_UUID>");
  lines.push("```");

  return lines.join("\n");
}

function formatEventDetails(event: BugsinkEventDetail): string {
  const lines: string[] = [];

  lines.push(`## Event: ${event.event_id}`);
  lines.push("");
  lines.push("### Details");
  lines.push("");
  lines.push(`- **ID:** ${event.id}`);
  lines.push(`- **Event ID:** ${event.event_id}`);
  lines.push(`- **Issue:** ${event.issue}`);
  lines.push(`- **Project:** ${String(event.project)}`);
  lines.push(`- **Timestamp:** ${new Date(event.timestamp).toLocaleString()}`);
  lines.push(`- **Ingested:** ${new Date(event.ingested_at).toLocaleString()}`);
  lines.push(`- **Digested:** ${new Date(event.digested_at).toLocaleString()}`);
  lines.push("");

  if (event.stacktrace_md.length > 0) {
    lines.push("### Stacktrace");
    lines.push("");
    lines.push(event.stacktrace_md);
    lines.push("");
  }

  lines.push("To view the full stacktrace:");
  lines.push("```bash");
  lines.push(`tools bugsink stacktrace ${event.id}`);
  lines.push("```");

  return lines.join("\n");
}

export async function eventsCommand(
  issueUuid: string,
  options: EventsOptions = {},
): Promise<void> {
  try {
    const events = await getEvents(issueUuid);

    if (options.json === true) {
      console.log(formatJson(events));
    } else {
      console.log(formatEventsMarkdown(events));
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}

export async function eventCommand(
  uuid: string,
  options: EventOptions = {},
): Promise<void> {
  try {
    const event = await getEvent(uuid);

    if (event == null) {
      console.error(`Error: Event ${uuid} not found`);
      process.exit(1);
    }

    if (options.json === true) {
      console.log(formatJson(event));
    } else {
      console.log(formatEventDetails(event));
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}
