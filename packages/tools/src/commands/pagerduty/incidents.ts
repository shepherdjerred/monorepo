import {
  getIncidents,
  type PagerDutyIncident,
  type PagerDutyIncidentStatus,
} from "../../lib/pagerduty/index.ts";
import { getStatusEmoji } from "../../lib/pagerduty/format.ts";
import { formatJson } from "../../lib/output/index.ts";

export type IncidentsOptions = {
  json?: boolean | undefined;
  statuses?: PagerDutyIncidentStatus[] | undefined;
  limit?: number | undefined;
};

function getUrgencyEmoji(urgency: string): string {
  return urgency === "high" ? "\uD83D\uDD25" : "";
}

function formatIncident(incident: PagerDutyIncident): string {
  const lines: string[] = [];

  const urgencyEmoji = getUrgencyEmoji(incident.urgency);
  const statusEmoji = getStatusEmoji(incident.status);

  lines.push(
    `- ${statusEmoji} **${String(incident.incident_number)}**: ${incident.title}${urgencyEmoji ? ` ${urgencyEmoji}` : ""}`,
  );
  lines.push(`  - Service: ${incident.service.summary}`);
  lines.push(`  - Status: ${incident.status}`);

  if (incident.assignments.length > 0) {
    const assignees = incident.assignments
      .map((a) => a.assignee.summary)
      .join(", ");
    lines.push(`  - Assigned to: ${assignees}`);
  }

  const createdAt = new Date(incident.created_at);
  lines.push(`  - Created: ${createdAt.toLocaleString()}`);
  lines.push(`  - URL: ${incident.html_url}`);

  return lines.join("\n");
}

function formatIncidentsMarkdown(incidents: PagerDutyIncident[]): string {
  const lines: string[] = [];

  lines.push("## PagerDuty Incidents");
  lines.push("");

  if (incidents.length === 0) {
    lines.push("No open incidents found.");
    return lines.join("\n");
  }

  const triggered = incidents.filter((i) => i.status === "triggered");
  const acknowledged = incidents.filter((i) => i.status === "acknowledged");

  if (triggered.length > 0) {
    lines.push(`### \uD83D\uDD34 Triggered (${String(triggered.length)})`);
    lines.push("");
    for (const incident of triggered) {
      lines.push(formatIncident(incident));
      lines.push("");
    }
  }

  if (acknowledged.length > 0) {
    lines.push(
      `### \uD83D\uDFE1 Acknowledged (${String(acknowledged.length)})`,
    );
    lines.push("");
    for (const incident of acknowledged) {
      lines.push(formatIncident(incident));
      lines.push("");
    }
  }

  lines.push("---");
  lines.push("");
  lines.push("To view incident details:");
  lines.push("```bash");
  lines.push("tools pd incident <INCIDENT_ID>");
  lines.push("```");

  return lines.join("\n");
}

export async function incidentsCommand(
  options: IncidentsOptions = {},
): Promise<void> {
  try {
    const incidents = await getIncidents({
      statuses: options.statuses,
      limit: options.limit,
    });

    if (options.json === true) {
      console.log(formatJson(incidents));
    } else {
      console.log(formatIncidentsMarkdown(incidents));
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}
