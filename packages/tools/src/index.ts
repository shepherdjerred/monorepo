#!/usr/bin/env bun

import { parseArgs } from "node:util";
import { detectCommand, healthCommand, logsCommand } from "./commands/pr/index.ts";

function printUsage(): void {
  console.log(`
tools - CLI utilities for development workflows

Usage:
  tools <command> [subcommand] [options]

Commands:
  pr health [PR_NUMBER]    Check PR health (conflicts, CI, approval)
  pr logs <RUN_ID>         Get workflow run logs
  pr detect                Detect PR for current branch

Options:
  --repo <owner/repo>      Repository (default: auto-detect from git remote)
  --json                   Output as JSON
  --failed-only            (logs) Only show failed job logs
  --job <name>             (logs) Filter to specific job

Examples:
  tools pr health          Check health of PR for current branch
  tools pr health 123      Check health of PR #123
  tools pr logs 12345678   Get logs for workflow run
  tools pr detect          Find PR for current branch
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

  if (command === "pr") {
    await handlePrCommand(subcommand, args.slice(2));
  } else {
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

main().catch((error: unknown) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
