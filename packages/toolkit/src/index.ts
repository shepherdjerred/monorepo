#!/usr/bin/env bun

const TOOLKIT_VERSION = "0.1.0";

function printUsage(): void {
  console.log(`
toolkit - CLI utilities for development workflows

Usage:
  toolkit <command> [subcommand] [options]

Commands:
  fetch <url>                Fetch a web page and save to ~/.recall/fetched/
  fetch <url> --browser      Fetch via PinchTab (real Chrome) for blocked sites
  fetch <url> --crawl        Crawl docs site (follow links, depth 2)

  recall search <query>      Hybrid semantic + keyword search
  recall add <path>          Index file(s) or directory
  recall remove <path>       Remove from index
  recall reindex [--full]    Re-scan all watched directories
  recall status [--perf]     Index stats, daemon health, performance
  recall debug               Full diagnostic check
  recall logs [--follow]     View structured logs
  recall daemon start|stop   Manage background watcher
  recall watch               Run watcher in foreground

  pr health [PR_NUMBER]      Check PR health (conflicts, CI, approval)
  pr logs <RUN_ID>           Get workflow run logs
  pr detect                  Detect PR for current branch
  pr asset <PR> <FILE...>    Upload PR screenshots to public.sjer.red, print URLs

  pagerduty incidents        List open PagerDuty incidents
  pagerduty incident <ID>    View PagerDuty incident details
  pd ...                     Alias for pagerduty

  bugsink issues             List unresolved Bugsink issues
  bugsink issue <ID>         View Bugsink issue details
  bugsink teams              List teams
  bugsink team <UUID>        View team details
  bugsink projects           List projects
  bugsink project <ID>       View project details
  bugsink events <ISSUE>     List events for an issue
  bugsink event <UUID>       View event details
  bugsink stacktrace <EVT>   Get event stacktrace (markdown)
  bugsink releases           List releases
  bugsink release <UUID>     View release details

  grafana dashboards         Search dashboards
  grafana dashboard <UID>    View dashboard details
  grafana datasources        List datasources
  grafana datasource <UID>   View datasource details
  grafana query <EXPR>       Run PromQL query
  grafana metrics            List Prometheus metric names
  grafana labels             List Prometheus label names
  grafana label-values <N>   List values for a Prometheus label
  grafana logs <EXPR>        Run LogQL query
  grafana log-labels         List Loki label names
  grafana log-label-values <N>  List values for a Loki label
  grafana alerts             List alert rules
  grafana alert <UID>        View alert rule details
  grafana annotations        List annotations
  grafana annotate <TEXT>    Create an annotation
  gf ...                     Alias for grafana

Options:
  --version                  Print toolkit version
  --json                     Output as JSON
  --verbose, -v              Verbose output (timing, debug info)

Environment Variables:
  PAGERDUTY_TOKEN            PagerDuty API token
  BUGSINK_URL                Bugsink instance URL
  BUGSINK_TOKEN              Bugsink API token
  GRAFANA_URL                Grafana instance URL
  GRAFANA_API_KEY            Grafana API key or service account token
  SEAWEEDFS_ACCESS_KEY_ID    SeaweedFS S3 access key (pr asset)
  SEAWEEDFS_SECRET_ACCESS_KEY  SeaweedFS S3 secret key (pr asset)
  SEAWEEDFS_S3_ENDPOINT      SeaweedFS S3 endpoint (default seaweedfs.sjer.red)
  SEAWEEDFS_S3_REGION        SeaweedFS S3 region (default us-east-1)

Examples:
  toolkit fetch https://docs.lancedb.com/
  toolkit fetch https://react.dev/ --crawl --depth 1
  toolkit recall search "vector database"
  toolkit recall status --perf
  toolkit pr health
  toolkit pd incidents
  toolkit gf dashboards
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

  if (command === "--version" || command === "version") {
    console.log(`toolkit ${TOOLKIT_VERSION}`);
    process.exit(0);
  }

  switch (command) {
    case "fetch": {
      const { handleFetchCommand } = await import("./handlers/fetch.ts");
      await handleFetchCommand(subcommand, args.slice(1));
      break;
    }
    case "recall": {
      const { handleRecallCommand } = await import("./handlers/recall.ts");
      await handleRecallCommand(subcommand, args.slice(2));
      break;
    }
    case "pr": {
      const { handlePrCommand } = await import("./handlers/pr.ts");
      await handlePrCommand(subcommand, args.slice(2));
      break;
    }
    case "pagerduty":
    case "pd": {
      const { handlePagerDutyCommand } =
        await import("./handlers/pagerduty.ts");
      await handlePagerDutyCommand(subcommand, args.slice(2));
      break;
    }
    case "bugsink": {
      const { handleBugsinkCommand } = await import("./handlers/bugsink.ts");
      await handleBugsinkCommand(subcommand, args.slice(2));
      break;
    }
    case "grafana":
    case "gf": {
      const { handleGrafanaCommand } = await import("./handlers/grafana.ts");
      await handleGrafanaCommand(subcommand, args.slice(2));
      break;
    }
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
