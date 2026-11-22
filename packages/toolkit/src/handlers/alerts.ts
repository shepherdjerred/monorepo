import { parseArgs } from "node:util";
import { z } from "zod";
import {
  AlertScopeSchema,
  SuppressionStateSchema,
  getAlert,
  listAlerts,
  type Alert,
} from "#lib/alerts.ts";

const StateFilterSchema = z.enum(["open", "resolved", "all"]);

const ALERTS_HELP = `toolkit alerts list [--scope <ops|house|all>] [--suppression <none|silenced|inhibited|unprocessed>] [filters] [--json]
toolkit alerts show <occurrence-id> [--json]

Filters for list:
  --scope <ops|house|all>      Alert scope filter
  --suppression <state>        Suppression state (none, silenced, inhibited, unprocessed)
  --state <open|resolved|all>  Lifecycle state filter (default: open)
  --limit <N|all>              Maximum alerts to return, or "all" to paginate exhaustively (default: 100)
  --severity <level>           Filter by severity (critical, warning, info, unknown)
  --namespace <name>           Filter by Kubernetes namespace
  --alertname <name>           Filter by exact alertname
  --search <text>              Search summary, alertname, fingerprint, or namespace
  --opened-from <instant>      Filter openedAt >= RFC 3339 instant
  --opened-to <instant>        Filter openedAt <= RFC 3339 instant
  --resolved-from <instant>    Filter resolvedAt >= RFC 3339 instant
  --resolved-to <instant>      Filter resolvedAt <= RFC 3339 instant
  --json                       Print JSON output

Environment: ALERT_DASHBOARD_URL (defaults to Hub at https://hub.tailnet-1a49.ts.net)`;

function printAlert(alert: Alert): void {
  const namespace = alert.namespace === null ? "" : ` [${alert.namespace}]`;
  console.log(
    `${alert.severity.toUpperCase()} ${alert.alertname}${namespace} — ${alert.summary}`,
  );
  console.log(
    `  ${alert.lifecycleState}/${alert.suppressionState} opened ${alert.openedAt} id=${alert.id}`,
  );
}

async function handleList(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      help: { type: "boolean", short: "h", default: false },
      json: { type: "boolean", default: false },
      scope: { type: "string" },
      suppression: { type: "string" },
      state: { type: "string" },
      severity: { type: "string" },
      namespace: { type: "string" },
      alertname: { type: "string" },
      search: { type: "string" },
      "opened-from": { type: "string" },
      "opened-to": { type: "string" },
      "resolved-from": { type: "string" },
      "resolved-to": { type: "string" },
      limit: { type: "string" },
    },
    allowPositionals: false,
  });
  if (values.help) {
    console.log(ALERTS_HELP);
    return;
  }
  const scope =
    values.scope === undefined
      ? undefined
      : AlertScopeSchema.parse(values.scope);
  const suppressionState =
    values.suppression === undefined
      ? undefined
      : SuppressionStateSchema.parse(values.suppression);
  const parsedState = StateFilterSchema.parse(values.state ?? "open");
  const lifecycleState = parsedState === "all" ? undefined : parsedState;
  const limit = values.limit ?? "100";
  const query = Object.fromEntries(
    Object.entries({
      scope,
      suppressionState,
      lifecycleState,
      severity: values.severity,
      namespace: values.namespace,
      alertname: values.alertname,
      search: values.search,
      openedFrom: values["opened-from"],
      openedTo: values["opened-to"],
      resolvedFrom: values["resolved-from"],
      resolvedTo: values["resolved-to"],
      limit,
    }).flatMap(([key, value]) => (value === undefined ? [] : [[key, value]])),
  );
  const alerts = await listAlerts(query);
  if (values.json) console.log(JSON.stringify(alerts, null, 2));
  else if (alerts.length === 0) console.log("No alerts matched.");
  else for (const alert of alerts) printAlert(alert);
}

async function handleShow(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      help: { type: "boolean", short: "h", default: false },
      json: { type: "boolean", default: false },
    },
    allowPositionals: true,
  });
  if (values.help) {
    console.log(ALERTS_HELP);
    return;
  }
  const id = positionals[0];
  if (id === undefined)
    throw new Error("Usage: toolkit alerts show <occurrence-id> [--json]");
  const alert = await getAlert(id);
  if (values.json) console.log(JSON.stringify(alert, null, 2));
  else {
    printAlert(alert);
    for (const event of alert.events)
      console.log(`  ${event.occurredAt} ${event.type} (${event.source})`);
  }
}

export async function handleAlertsCommand(
  subcommand: string | undefined,
  args: string[],
): Promise<void> {
  if (
    subcommand === undefined ||
    subcommand === "--help" ||
    subcommand === "-h"
  ) {
    console.log(ALERTS_HELP);
    return;
  }
  if (subcommand === "list") await handleList(args);
  else if (subcommand === "show") await handleShow(args);
  else throw new Error(`Unknown alerts subcommand: ${subcommand}`);
}
