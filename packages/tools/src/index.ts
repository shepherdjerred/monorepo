#!/usr/bin/env bun

import { handlePrCommand } from "./handlers/pr.ts";
import { handlePagerDutyCommand } from "./handlers/pagerduty.ts";
import { handleBugsinkCommand } from "./handlers/bugsink.ts";
import { handleGrafanaCommand } from "./handlers/grafana.ts";

function printUsage(): void {
  console.log(`
tools - CLI utilities for development workflows

Usage:
  tools <command> [subcommand] [options]

Commands:
  pr health [PR_NUMBER]    Check PR health (conflicts, CI, approval)
  pr logs <RUN_ID>         Get workflow run logs
  pr detect                Detect PR for current branch

  pagerduty incidents      List open PagerDuty incidents
  pagerduty incident <ID>  View PagerDuty incident details
  pd ...                   Alias for pagerduty

  bugsink issues           List unresolved Bugsink issues
  bugsink issue <ID>       View Bugsink issue details
  bugsink teams            List teams
  bugsink team <UUID>      View team details
  bugsink projects         List projects
  bugsink project <ID>     View project details
  bugsink events <ISSUE>   List events for an issue
  bugsink event <UUID>     View event details
  bugsink stacktrace <EVT> Get event stacktrace (markdown)
  bugsink releases         List releases
  bugsink release <UUID>   View release details

  grafana dashboards       Search dashboards
  grafana dashboard <UID>  View dashboard details
  grafana datasources      List datasources
  grafana datasource <UID> View datasource details
  grafana query <EXPR>     Run PromQL query
  grafana metrics          List Prometheus metric names
  grafana labels           List Prometheus label names
  grafana label-values <N> List values for a Prometheus label
  grafana logs <EXPR>      Run LogQL query
  grafana log-labels       List Loki label names
  grafana log-label-values <N>  List values for a Loki label
  grafana alerts           List alert rules
  grafana alert <UID>      View alert rule details
  grafana annotations      List annotations
  grafana annotate <TEXT>  Create an annotation
  gf ...                   Alias for grafana

Options:
  --json                   Output as JSON

Environment Variables:
  PAGERDUTY_API_KEY        PagerDuty API token
  BUGSINK_URL              Bugsink instance URL (e.g., https://bugsink.example.com)
  BUGSINK_TOKEN            Bugsink API token
  GRAFANA_URL              Grafana instance URL (e.g., https://grafana.example.com)
  GRAFANA_API_KEY          Grafana API key or service account token

Examples:
  tools pr health          Check health of PR for current branch
  tools pd incidents       List open PagerDuty incidents
  tools pd incident P1234  View incident details
  tools bugsink issues     List unresolved Bugsink issues
  tools bugsink issue 123  View issue details
  tools bugsink teams      List teams
  tools gf dashboards      Search Grafana dashboards
  tools gf query 'up'      Run a PromQL query
  tools gf logs '{app="myapp"}'  Query Loki logs
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  const subcommand = args[1];

  if (
    command == null ||
    command.length === 0 ||
    command === "--help" ||
    command === "-h"
  ) {
    printUsage();
    process.exit(0);
  }

  switch (command) {
    case "pr":
      await handlePrCommand(subcommand, args.slice(2));
      break;
    case "pagerduty":
    case "pd":
      await handlePagerDutyCommand(subcommand, args.slice(2));
      break;
    case "bugsink":
      await handleBugsinkCommand(subcommand, args.slice(2));
      break;
    case "grafana":
    case "gf":
      await handleGrafanaCommand(subcommand, args.slice(2));
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
}

try {
  await main();
} catch (error: unknown) {
  console.error("Fatal error:", error);
  process.exit(1);
}
