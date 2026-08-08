import { parseArgs } from "node:util";
import { getAlert, listAlerts, type Alert } from "#lib/alerts.ts";

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
      json: { type: "boolean", default: false },
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
  const query = Object.fromEntries(
    Object.entries({
      lifecycleState: values.state,
      severity: values.severity,
      namespace: values.namespace,
      alertname: values.alertname,
      search: values.search,
      openedFrom: values["opened-from"],
      openedTo: values["opened-to"],
      resolvedFrom: values["resolved-from"],
      resolvedTo: values["resolved-to"],
      limit: values.limit,
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
    options: { json: { type: "boolean", default: false } },
    allowPositionals: true,
  });
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
    console.log(
      "toolkit alerts list [filters] [--json]\ntoolkit alerts show <occurrence-id> [--json]\n\nEnvironment: ALERT_DASHBOARD_URL (defaults to the tailnet Alerts service)",
    );
    return;
  }
  if (subcommand === "list") await handleList(args);
  else if (subcommand === "show") await handleShow(args);
  else throw new Error(`Unknown alerts subcommand: ${subcommand}`);
}
