#!/usr/bin/env bun

import {
  buildPassthroughInvocation,
  runPassthrough,
} from "#lib/passthrough.ts";

const TOOLKIT_VERSION = "0.1.0";

function printUsage(): void {
  console.log(`
toolkit - the monorepo command hub

Usage:
  toolkit <command> [arguments...]

Platform commands (native CLI passthroughs):
  gh          GitHub CLI (GH_REPO=shepherdjerred/monorepo)
  bk          Buildkite CLI (organization sjerred)
  git-spice   Stacked branch and PR workflow
  linear      Linear CLI (--workspace sjerred)
  posthog     PostHog CLI (project 549883)
  grafana     GCX (--context homelab)
  prom        GCX metrics (--context homelab)
  loki        GCX logs (--context homelab)
  tempo       GCX traces (--context homelab)
  temporal    Temporal CLI (--profile homelab)
  argocd      Argo CD CLI (homelab server, --grpc-web)
  cf          Cloudflare CLI
  tailscale   Tailscale CLI

Monorepo workflows:
  pr health [PR_NUMBER]        Check merge, exact-head Buildkite CI, and review
  pr asset <PR> <FILE|DIR...>  Upload review media to public.sjer.red
  pr review <ACTION> <PR>      Inspect or resolve review-provider findings
  deployed [SELECTOR]          Trace a commit or service to the live homelab
  screenshot <PKG> [ROUTE]     Start a site and capture a browser screenshot
  alerts <list|show>           Query the durable alert ledger
  bugsink <SUBCOMMAND>         Query or resolve self-hosted error tracking
  discord <SUBCOMMAND>         Use the local Discord session daemon
  history <SUBCOMMAND>         Search private local agent history

Global options:
  --version                    Print toolkit version
  --help, -h                   Print this help

Passthrough behavior:
  Arguments after a platform command are passed to the native CLI unchanged.
  Explicit flags and environment values override the defaults shown above.

Examples:
  toolkit gh pr view
  toolkit bk build list --pipeline monorepo --branch main
  toolkit prom query 'up == 0'
  toolkit loki query '{namespace="temporal"}'
  toolkit pr health
  toolkit deployed scout/prod
  toolkit history recent --since 7d
  toolkit history search "kubernetes" --since 30d
  toolkit history show <ID> --query "kubernetes"
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (
    command === "--help" ||
    command === "-h" ||
    command === undefined ||
    command.length === 0
  ) {
    printUsage();
    return;
  }

  if (command === "--version" || command === "version") {
    console.log(`toolkit ${TOOLKIT_VERSION}`);
    return;
  }

  const passthrough = buildPassthroughInvocation(
    command,
    args.slice(1),
    Bun.env,
  );
  if (passthrough !== null) {
    process.exit(await runPassthrough(passthrough));
  }

  const subcommand = args[1];
  switch (command) {
    case "pr": {
      const { handlePrCommand } = await import("./handlers/pr.ts");
      await handlePrCommand(subcommand, args.slice(2));
      return;
    }
    case "deployed": {
      const { handleDeployedCommand } = await import("./handlers/deployed.ts");
      await handleDeployedCommand(subcommand, args.slice(1));
      return;
    }
    case "screenshot": {
      const { handleScreenshotCommand } =
        await import("./handlers/screenshot.ts");
      await handleScreenshotCommand(subcommand, args.slice(1));
      return;
    }
    case "alerts": {
      const { handleAlertsCommand } = await import("./handlers/alerts.ts");
      await handleAlertsCommand(subcommand, args.slice(2));
      return;
    }
    case "bugsink": {
      const { handleBugsinkCommand } = await import("./handlers/bugsink.ts");
      await handleBugsinkCommand(subcommand, args.slice(2));
      return;
    }
    case "discord": {
      const { handleDiscordCommand } = await import("./handlers/discord.ts");
      await handleDiscordCommand(subcommand, args.slice(2));
      return;
    }
    case "history": {
      const { handleHistoryCommand } = await import("./handlers/history.ts");
      await handleHistoryCommand(subcommand, args.slice(2));
      return;
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
