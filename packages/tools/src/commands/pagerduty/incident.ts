import {
  getIncident,
  getIncidentNotes,
  getIncidentLogEntries,
  type PagerDutyIncident,
  type PagerDutyNote,
  type PagerDutyLogEntry,
} from "../../lib/pagerduty/index.ts";
import { getStatusEmoji } from "../../lib/pagerduty/format.ts";
import { formatJson } from "../../lib/output/index.ts";

export type IncidentOptions = {
  json?: boolean | undefined;
};

function formatIncidentDetails(
  incident: PagerDutyIncident,
  notes: PagerDutyNote[],
  logEntries: PagerDutyLogEntry[],
): string {
  const lines: string[] = [];

  lines.push(
    `## Incident #${String(incident.incident_number)}: ${incident.title}`,
  );
  lines.push("");

  // Status section
  lines.push(
    `### Status: ${getStatusEmoji(incident.status)} ${incident.status.toUpperCase()}`,
  );
  lines.push("");

  // Details
  lines.push("### Details");
  lines.push("");
  lines.push(`- **ID:** ${incident.id}`);
  lines.push(`- **Service:** ${incident.service.summary}`);
  lines.push(`- **Urgency:** ${incident.urgency}`);

  if (incident.priority != null) {
    lines.push(`- **Priority:** ${incident.priority.name}`);
  }

  if (incident.description != null && incident.description.length > 0) {
    lines.push(`- **Description:** ${incident.description}`);
  }

  lines.push(`- **Escalation Policy:** ${incident.escalation_policy.summary}`);

  if (incident.teams.length > 0) {
    const teams = incident.teams.map((t) => t.summary).join(", ");
    lines.push(`- **Teams:** ${teams}`);
  }

  if (incident.assignments.length > 0) {
    const assignees = incident.assignments
      .map((a) => a.assignee.summary)
      .join(", ");
    lines.push(`- **Assigned to:** ${assignees}`);
  }

  lines.push(
    `- **Created:** ${new Date(incident.created_at).toLocaleString()}`,
  );
  lines.push(
    `- **Last Updated:** ${new Date(incident.updated_at).toLocaleString()}`,
  );
  lines.push(`- **URL:** ${incident.html_url}`);
  lines.push("");

  // Acknowledgements
  if (incident.acknowledgements.length > 0) {
    lines.push("### Acknowledgements");
    lines.push("");
    for (const ack of incident.acknowledgements) {
      const at = new Date(ack.at).toLocaleString();
      lines.push(`- ${ack.acknowledger.summary} at ${at}`);
    }
    lines.push("");
  }

  // Notes
  if (notes.length > 0) {
    lines.push("### Notes");
    lines.push("");
    for (const note of notes) {
      const createdAt = new Date(note.created_at).toLocaleString();
      lines.push(`**${note.user.summary}** (${createdAt}):`);
      lines.push("");
      lines.push(`> ${note.content}`);
      lines.push("");
    }
  }

  // Timeline (recent log entries)
  if (logEntries.length > 0) {
    lines.push("### Timeline (Recent)");
    lines.push("");
    for (const entry of logEntries.slice(0, 10)) {
      const createdAt = new Date(entry.created_at).toLocaleString();
      const agent = entry.agent?.summary ?? "System";
      lines.push(`- **${createdAt}** - ${entry.summary} (${agent})`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export async function incidentCommand(
  incidentId: string,
  options: IncidentOptions = {},
): Promise<void> {
  try {
    const incident = await getIncident(incidentId);

    if (incident == null) {
      console.error(`Error: Incident ${incidentId} not found`);
      process.exit(1);
    }

    if (options.json === true) {
      const notes = await getIncidentNotes(incidentId);
      const logEntries = await getIncidentLogEntries(incidentId);
      console.log(formatJson({ incident, notes, logEntries }));
    } else {
      const [notes, logEntries] = await Promise.all([
        getIncidentNotes(incidentId),
        getIncidentLogEntries(incidentId),
      ]);
      console.log(formatIncidentDetails(incident, notes, logEntries));
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}
