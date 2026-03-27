import { parseArgs } from "node:util";
import { incidentsCommand } from "#commands/pagerduty/incidents.ts";
import { incidentCommand } from "#commands/pagerduty/incident.ts";

async function handleIncidents(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      json: { type: "boolean", default: false },
      status: { type: "string", multiple: true },
      limit: { type: "string" },
    },
    allowPositionals: true,
  });
  const statuses = values.status?.map((s) => {
    if (s === "triggered" || s === "acknowledged" || s === "resolved") {
      return s;
    }
    throw new Error(
      `Invalid status: ${s}. Must be triggered, acknowledged, or resolved.`,
    );
  });
  const limit =
    values.limit != null && values.limit.length > 0
      ? Number.parseInt(values.limit, 10)
      : undefined;
  await incidentsCommand({ json: values.json, statuses, limit });
}

async function handleIncident(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: { json: { type: "boolean", default: false } },
    allowPositionals: true,
  });
  const incidentId = positionals[0];
  if (incidentId == null || incidentId.length === 0) {
    console.error("Error: Incident ID is required");
    console.error("Usage: tools pd incident <incident-id> [--json]");
    process.exit(1);
  }
  await incidentCommand(incidentId, { json: values.json });
}

export async function handlePagerDutyCommand(
  subcommand: string | undefined,
  args: string[],
): Promise<void> {
  if (
    subcommand == null ||
    subcommand.length === 0 ||
    subcommand === "--help" ||
    subcommand === "-h"
  ) {
    console.log(`
tools pagerduty (pd) - PagerDuty incident management

Subcommands:
  incidents             List open incidents (triggered + acknowledged)
  incident <ID>         View incident details with notes and timeline

Options:
  --json                Output as JSON
  --status <status>     Filter by status (triggered, acknowledged, resolved)
  --limit <n>           Maximum number of results

Environment:
  PAGERDUTY_TOKEN       Required. Your PagerDuty API token.

Examples:
  tools pd incidents
  tools pd incident P1234567
  tools pd incidents --json
`);
    process.exit(0);
  }

  switch (subcommand) {
    case "incidents":
      await handleIncidents(args);
      break;
    case "incident":
      await handleIncident(args);
      break;
    default:
      console.error(`Unknown pagerduty subcommand: ${subcommand}`);
      process.exit(1);
  }
}
