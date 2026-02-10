#!/usr/bin/env bun

import { parseArgs } from "node:util";
import { detectCommand, healthCommand, logsCommand } from "./commands/pr/index.ts";
import { incidentsCommand, incidentCommand } from "./commands/pagerduty/index.ts";
import { issuesCommand, issueCommand } from "./commands/bugsink/index.ts";

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

Options:
  --json                   Output as JSON

Environment Variables:
  PAGERDUTY_API_KEY        PagerDuty API token
  BUGSINK_URL              Bugsink instance URL (e.g., https://bugsink.example.com)
  BUGSINK_TOKEN            Bugsink API token

Examples:
  tools pr health          Check health of PR for current branch
  tools pd incidents       List open PagerDuty incidents
  tools pd incident P1234  View incident details
  tools bugsink issues     List unresolved Bugsink issues
  tools bugsink issue 123  View issue details
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  const subcommand = args[1];

  if (!command || command === "--help" || command === "-h") {
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
    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
}

async function handlePrCommand(
  subcommand: string | undefined,
  args: string[]
): Promise<void> {
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    console.log(`
tools pr - Pull request utilities

Subcommands:
  health [PR_NUMBER]    Check PR health (conflicts, CI, approval)
  logs <RUN_ID>         Get workflow run logs
  detect                Detect PR for current branch

Options:
  --repo <owner/repo>   Repository (default: auto-detect)
  --json                Output as JSON
  --failed-only         (logs) Only show failed job logs
  --job <name>          (logs) Filter to specific job
`);
    process.exit(0);
  }

  switch (subcommand) {
    case "health":
      await handleHealthCommand(args);
      break;
    case "logs":
      await handleLogsCommand(args);
      break;
    case "detect":
      await handleDetectCommand(args);
      break;
    default:
      console.error(`Unknown pr subcommand: ${subcommand}`);
      process.exit(1);
  }
}

async function handlePagerDutyCommand(
  subcommand: string | undefined,
  args: string[]
): Promise<void> {
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
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
  PAGERDUTY_API_KEY     Required. Your PagerDuty API token.

Examples:
  tools pd incidents
  tools pd incident P1234567
  tools pd incidents --json
`);
    process.exit(0);
  }

  switch (subcommand) {
    case "incidents":
      await handlePagerDutyIncidentsCommand(args);
      break;
    case "incident":
      await handlePagerDutyIncidentCommand(args);
      break;
    default:
      console.error(`Unknown pagerduty subcommand: ${subcommand}`);
      process.exit(1);
  }
}

async function handleBugsinkCommand(
  subcommand: string | undefined,
  args: string[]
): Promise<void> {
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    console.log(`
tools bugsink - Bugsink issue tracking

Subcommands:
  issues                List unresolved issues
  issue <ID>            View issue details with latest event

Options:
  --json                Output as JSON
  --project <slug>      Filter by project
  --limit <n>           Maximum number of results

Environment:
  BUGSINK_URL           Required. Your Bugsink instance URL.
  BUGSINK_TOKEN         Required. Your Bugsink API token.

Examples:
  tools bugsink issues
  tools bugsink issue 12345678
  tools bugsink issues --project my-app
`);
    process.exit(0);
  }

  switch (subcommand) {
    case "issues":
      await handleBugsinkIssuesCommand(args);
      break;
    case "issue":
      await handleBugsinkIssueCommand(args);
      break;
    default:
      console.error(`Unknown bugsink subcommand: ${subcommand}`);
      process.exit(1);
  }
}

async function handleHealthCommand(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      repo: { type: "string" },
      json: { type: "boolean", default: false },
    },
    allowPositionals: true,
  });

  const prNumber = positionals[0];
  await healthCommand(prNumber, {
    repo: values.repo,
    json: values.json,
  });
}

async function handleLogsCommand(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      repo: { type: "string" },
      "failed-only": { type: "boolean", default: false },
      job: { type: "string" },
    },
    allowPositionals: true,
  });

  const runId = positionals[0];
  if (!runId) {
    console.error("Error: Run ID is required");
    console.error("Usage: tools pr logs <run-id> [--failed-only] [--job <name>]");
    process.exit(1);
  }

  await logsCommand(runId, {
    repo: values.repo,
    failedOnly: values["failed-only"],
    job: values.job,
  });
}

async function handleDetectCommand(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      repo: { type: "string" },
      json: { type: "boolean", default: false },
    },
    allowPositionals: true,
  });

  await detectCommand({
    repo: values.repo,
    json: values.json,
  });
}

async function handlePagerDutyIncidentsCommand(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      json: { type: "boolean", default: false },
      status: { type: "string", multiple: true },
      limit: { type: "string" },
    },
    allowPositionals: true,
  });

  const statuses = values.status as
    | ("triggered" | "acknowledged" | "resolved")[]
    | undefined;
  const limit = values.limit ? Number.parseInt(values.limit, 10) : undefined;

  await incidentsCommand({
    json: values.json,
    statuses,
    limit,
  });
}

async function handlePagerDutyIncidentCommand(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      json: { type: "boolean", default: false },
    },
    allowPositionals: true,
  });

  const incidentId = positionals[0];
  if (!incidentId) {
    console.error("Error: Incident ID is required");
    console.error("Usage: tools pd incident <incident-id> [--json]");
    process.exit(1);
  }

  await incidentCommand(incidentId, {
    json: values.json,
  });
}

async function handleBugsinkIssuesCommand(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      json: { type: "boolean", default: false },
      project: { type: "string" },
      limit: { type: "string" },
    },
    allowPositionals: true,
  });

  const limit = values.limit ? Number.parseInt(values.limit, 10) : undefined;

  await issuesCommand({
    json: values.json,
    project: values.project,
    limit,
  });
}

async function handleBugsinkIssueCommand(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      json: { type: "boolean", default: false },
    },
    allowPositionals: true,
  });

  const issueId = positionals[0];
  if (!issueId) {
    console.error("Error: Issue ID is required");
    console.error("Usage: tools bugsink issue <issue-id> [--json]");
    process.exit(1);
  }

  await issueCommand(issueId, {
    json: values.json,
  });
}

main().catch((error: unknown) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
