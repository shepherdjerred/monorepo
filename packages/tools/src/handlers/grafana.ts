import { parseArgs } from "node:util";
import { dashboardsCommand } from "#commands/grafana/dashboards.ts";
import { dashboardCommand } from "#commands/grafana/dashboard.ts";
import {
  datasourcesCommand,
  datasourceCommand,
} from "#commands/grafana/datasources.ts";
import { queryCommand } from "#commands/grafana/query.ts";
import { metricsCommand } from "#commands/grafana/metrics.ts";
import { labelsCommand, labelValuesCommand } from "#commands/grafana/labels.ts";
import { logsCommand } from "#commands/grafana/logs.ts";
import {
  logLabelsCommand,
  logLabelValuesCommand,
} from "#commands/grafana/log-labels.ts";
import { alertsCommand, alertCommand } from "#commands/grafana/alerts.ts";
import {
  annotationsCommand,
  annotateCommand,
} from "#commands/grafana/annotations.ts";

function parseJsonFlag(args: string[]) {
  return parseArgs({
    args,
    options: { json: { type: "boolean", default: false } },
    allowPositionals: true,
  });
}

function requirePositional(
  positionals: string[],
  name: string,
  usage: string,
): string {
  const val = positionals[0];
  if (val == null || val.length === 0) {
    console.error(`Error: ${name} is required`);
    console.error(`Usage: ${usage}`);
    process.exit(1);
  }
  return val;
}

function parseLimit(raw: string | undefined): number | undefined {
  return raw != null && raw.length > 0 ? Number.parseInt(raw, 10) : undefined;
}

function parseTags(raw: string | undefined): string[] | undefined {
  return raw != null && raw.length > 0 ? raw.split(",") : undefined;
}

async function handleDashboards(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      json: { type: "boolean", default: false },
      query: { type: "string" },
      tag: { type: "string" },
      folder: { type: "string" },
      limit: { type: "string" },
    },
    allowPositionals: true,
  });
  await dashboardsCommand({
    json: values.json,
    query: values.query,
    tag: values.tag,
    folder: values.folder,
    limit: parseLimit(values.limit),
  });
}

async function handleDashboard(args: string[]): Promise<void> {
  const { values, positionals } = parseJsonFlag(args);
  const uid = requirePositional(
    positionals,
    "Dashboard UID",
    "tools grafana dashboard <uid> [--json]",
  );
  await dashboardCommand(uid, { json: values.json });
}

async function handleDatasources(args: string[]): Promise<void> {
  const { values } = parseJsonFlag(args);
  await datasourcesCommand({ json: values.json });
}

async function handleDatasource(args: string[]): Promise<void> {
  const { values, positionals } = parseJsonFlag(args);
  const uid = requirePositional(
    positionals,
    "Datasource UID",
    "tools grafana datasource <uid> [--json]",
  );
  await datasourceCommand(uid, { json: values.json });
}

async function handleQuery(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      json: { type: "boolean", default: false },
      datasource: { type: "string" },
      from: { type: "string" },
      to: { type: "string" },
      instant: { type: "boolean", default: false },
    },
    allowPositionals: true,
  });
  const expr = requirePositional(
    positionals,
    "PromQL expression",
    "tools grafana query <expr> [--datasource <uid>] [--from <time>] [--to <time>] [--instant] [--json]",
  );
  await queryCommand(expr, {
    json: values.json,
    datasource: values.datasource,
    from: values.from,
    to: values.to,
    instant: values.instant,
  });
}

async function handleMetrics(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      json: { type: "boolean", default: false },
      datasource: { type: "string" },
      match: { type: "string" },
    },
    allowPositionals: true,
  });
  await metricsCommand({
    json: values.json,
    datasource: values.datasource,
    match: values.match,
  });
}

async function handleLabels(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      json: { type: "boolean", default: false },
      datasource: { type: "string" },
      metric: { type: "string" },
    },
    allowPositionals: true,
  });
  await labelsCommand({
    json: values.json,
    datasource: values.datasource,
    metric: values.metric,
  });
}

async function handleLabelValues(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      json: { type: "boolean", default: false },
      datasource: { type: "string" },
      metric: { type: "string" },
    },
    allowPositionals: true,
  });
  const labelName = requirePositional(
    positionals,
    "Label name",
    "tools grafana label-values <name> [--datasource <uid>] [--metric <name>] [--json]",
  );
  await labelValuesCommand(labelName, {
    json: values.json,
    datasource: values.datasource,
    metric: values.metric,
  });
}

async function handleLogs(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      json: { type: "boolean", default: false },
      datasource: { type: "string" },
      from: { type: "string" },
      to: { type: "string" },
      limit: { type: "string" },
    },
    allowPositionals: true,
  });
  const expr = requirePositional(
    positionals,
    "LogQL expression",
    "tools grafana logs <expr> [--datasource <uid>] [--from <time>] [--to <time>] [--limit <n>] [--json]",
  );
  await logsCommand(expr, {
    json: values.json,
    datasource: values.datasource,
    from: values.from,
    to: values.to,
    limit: parseLimit(values.limit),
  });
}

async function handleLogLabels(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      json: { type: "boolean", default: false },
      datasource: { type: "string" },
    },
    allowPositionals: true,
  });
  await logLabelsCommand({ json: values.json, datasource: values.datasource });
}

async function handleLogLabelValues(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      json: { type: "boolean", default: false },
      datasource: { type: "string" },
    },
    allowPositionals: true,
  });
  const labelName = requirePositional(
    positionals,
    "Label name",
    "tools grafana log-label-values <name> [--datasource <uid>] [--json]",
  );
  await logLabelValuesCommand(labelName, {
    json: values.json,
    datasource: values.datasource,
  });
}

async function handleAlerts(args: string[]): Promise<void> {
  const { values } = parseJsonFlag(args);
  await alertsCommand({ json: values.json });
}

async function handleAlert(args: string[]): Promise<void> {
  const { values, positionals } = parseJsonFlag(args);
  const uid = requirePositional(
    positionals,
    "Alert rule UID",
    "tools grafana alert <uid> [--json]",
  );
  await alertCommand(uid, { json: values.json });
}

async function handleAnnotations(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      json: { type: "boolean", default: false },
      dashboard: { type: "string" },
      from: { type: "string" },
      to: { type: "string" },
      tags: { type: "string" },
      limit: { type: "string" },
    },
    allowPositionals: true,
  });
  const dashboard =
    values.dashboard != null && values.dashboard.length > 0
      ? Number.parseInt(values.dashboard, 10)
      : undefined;
  await annotationsCommand({
    json: values.json,
    dashboard,
    from: values.from,
    to: values.to,
    tags: parseTags(values.tags),
    limit: parseLimit(values.limit),
  });
}

async function handleAnnotate(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      json: { type: "boolean", default: false },
      dashboard: { type: "string" },
      "panel-id": { type: "string" },
      tags: { type: "string" },
    },
    allowPositionals: true,
  });
  const text = requirePositional(
    positionals,
    "Annotation text",
    "tools grafana annotate <text> [--dashboard <uid>] [--tags <t1,t2>] [--json]",
  );
  const panelId =
    values["panel-id"] != null && values["panel-id"].length > 0
      ? Number.parseInt(values["panel-id"], 10)
      : undefined;
  await annotateCommand(text, {
    json: values.json,
    dashboardUID: values.dashboard,
    panelId,
    tags: parseTags(values.tags),
  });
}

export async function handleGrafanaCommand(
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
tools grafana (gf) - Grafana observability

Subcommands:
  dashboards            Search dashboards
  dashboard <UID>       View dashboard details with panels
  datasources           List datasources
  datasource <UID>      View datasource details
  query <EXPR>          Run a PromQL query
  metrics               List Prometheus metric names
  labels                List Prometheus label names
  label-values <NAME>   List values for a Prometheus label
  logs <EXPR>           Run a LogQL query
  log-labels            List Loki label names
  log-label-values <N>  List values for a Loki label
  alerts                List alert rules
  alert <UID>           View alert rule details
  annotations           List annotations
  annotate <TEXT>       Create an annotation

Options:
  --json                Output as JSON
  --datasource <uid>    Datasource UID (auto-discovers default if omitted)
  --from <time>         Start time (e.g., 30m, 1h, 24h, 7d, ISO timestamp)
  --to <time>           End time (default: now)
  --instant             (query) Instant query instead of range
  --query <text>        (dashboards) Search query
  --tag <tag>           (dashboards) Filter by tag
  --folder <uid>        (dashboards) Filter by folder UID
  --match <pattern>     (metrics) Filter metric names
  --metric <name>       (labels) Filter by metric name
  --limit <n>           Maximum number of results
  --tags <t1,t2>        (annotations) Filter/set tags (comma-separated)
  --dashboard <uid>     (annotations) Filter by dashboard UID

Environment:
  GRAFANA_URL           Required. Your Grafana instance URL.
  GRAFANA_API_KEY       Required. Your Grafana API key or service account token.

Examples:
  tools gf dashboards
  tools gf dashboards --query "kubernetes" --tag "prod"
  tools gf dashboard abc123
  tools gf query 'up' --from 24h
  tools gf metrics --match "http_*"
  tools gf label-values job
  tools gf logs '{app="myapp"}' --limit 50
  tools gf log-label-values namespace
  tools gf alerts
  tools gf annotations --from 24h
  tools gf annotate "Deployment v1.2.3" --tags deploy,prod
`);
    process.exit(0);
  }

  switch (subcommand) {
    case "dashboards":
      await handleDashboards(args);
      break;
    case "dashboard":
      await handleDashboard(args);
      break;
    case "datasources":
      await handleDatasources(args);
      break;
    case "datasource":
      await handleDatasource(args);
      break;
    case "query":
      await handleQuery(args);
      break;
    case "metrics":
      await handleMetrics(args);
      break;
    case "labels":
      await handleLabels(args);
      break;
    case "label-values":
      await handleLabelValues(args);
      break;
    case "logs":
      await handleLogs(args);
      break;
    case "log-labels":
      await handleLogLabels(args);
      break;
    case "log-label-values":
      await handleLogLabelValues(args);
      break;
    case "alerts":
      await handleAlerts(args);
      break;
    case "alert":
      await handleAlert(args);
      break;
    case "annotations":
      await handleAnnotations(args);
      break;
    case "annotate":
      await handleAnnotate(args);
      break;
    default:
      console.error(`Unknown grafana subcommand: ${subcommand}`);
      process.exit(1);
  }
}
