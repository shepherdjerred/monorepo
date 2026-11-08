#!/usr/bin/env bun

import { requiredCredentialsFor } from "#lib/credential-commands.ts";
import { resolveCredentials } from "#lib/credentials.ts";
import {
  buildPassthroughInvocation,
  isCredentialFreePassthrough,
  runPassthrough,
} from "#lib/passthrough.ts";
import {
  handleWoodpeckerPipelineLsJson,
  isWoodpeckerPipelineLsJson,
} from "#lib/woodpecker/pipeline-ls.ts";

const TOOLKIT_VERSION = "0.1.0";

function printUsage(): void {
  console.log(`
toolkit - the monorepo command hub

Usage:
  toolkit <command> [arguments...]

Platform commands (native CLI passthroughs):
  gh          GitHub CLI (GH_REPO=shepherdjerred/monorepo)
  woodpecker  Woodpecker CI CLI
  git-spice   Stacked branch and PR workflow
  posthog     PostHog CLI (project 549883)
  grafana     GCX (homelab Grafana, brokered token)
  prom        GCX metrics (homelab Grafana)
  loki        GCX logs (homelab Grafana)
  tempo       GCX traces (homelab Grafana)
  temporal    Temporal CLI (--profile homelab)
  argocd      Argo CD CLI (homelab server, --grpc-web)
  cf          Cloudflare CLI
  tailscale   Tailscale CLI
  talosctl    Talos CLI (homelab os:admin talosconfig over a pipe)

Credential helpers (no secrets on disk):
  kube credential              kubectl exec plugin for the homelab admin user
  aws credential <PROFILE>     AWS credential_process for S3-compatible profiles
  run --env NAME[,NAME] -- CMD Run CMD with the named credentials in its env
  credentials flush [NAME...]  Drop cached 1Password reads after a rotation
  credentials references --json Show effective op:// locators without values

Monorepo workflows:
  tracker <COMMAND>           First-party issues, comments, votes and actor identity
  ci wait [PR]                Block until merge readiness or an actionable blocker
  ci explain|main|load        Failure evidence, main health, and CI capacity
  brim [--provider <id>] [--dry-run]  Start a session on the least-used AI subscription
  pr health [PR_NUMBER]        Check merge, exact-head Woodpecker CI, and review
  pr asset <PR> <FILE|DIR...>  Upload review media to public.sjer.red
  pr review <ACTION> <PR>      Inspect or resolve review-provider findings
  deployed [SELECTOR]          Trace a commit or service to the live homelab
  deploy <COMMAND>            Select, promote, approve, and inspect releases
  screenshot <PKG> [ROUTE]     Start a site and capture a browser screenshot
  screenshot-server <PKG>      Start a site without browser credentials
  alerts <list|show>           Query the durable alert ledger
  ops summary [--needs-me]     Summarize the homelab ops snapshot
  bugsink <SUBCOMMAND>         Query self-hosted error tracking
  discord <SUBCOMMAND>         Use the local Discord session daemon
  mc <SUBCOMMAND>              Drive Minecraft sandboxes (WorldEdit, console, snapshots)
  history <SUBCOMMAND>         Search private local agent history

Global options:
  --version                    Print toolkit version
  --help, -h                   Print this help

Passthrough behavior:
  Arguments after a platform command are passed to the native CLI unchanged.
  Explicit flags and environment values override the defaults shown above.

Examples:
  toolkit gh pr view
  toolkit woodpecker pipeline ls shepherdjerred/monorepo
  toolkit prom query 'up == 0'
  toolkit loki query '{namespace="temporal"}'
  toolkit pr health
  toolkit brim --dry-run
  toolkit deployed scout/prod
  toolkit ops summary --needs-me
  toolkit history recent --since 7d
  toolkit history search "kubernetes" --since 30d
  toolkit history show <ID> --query "kubernetes"
`);
}

type SubcommandHandler = (
  subcommand: string | undefined,
  args: string[],
) => Promise<void>;

/** Workflow commands dispatched as `<command> <subcommand> [args...]`. */
const SUBCOMMAND_HANDLERS = new Map<string, () => Promise<SubcommandHandler>>([
  [
    "tracker",
    () => import("./handlers/tracker.ts").then((m) => m.handleTrackerCommand),
  ],
  ["ci", () => import("./handlers/ci.ts").then((m) => m.handleCiCommand)],
  [
    "deploy",
    () => import("./handlers/deploy.ts").then((m) => m.handleDeployCommand),
  ],
  [
    "alerts",
    () => import("./handlers/alerts.ts").then((m) => m.handleAlertsCommand),
  ],
  ["ops", () => import("./handlers/ops.ts").then((m) => m.handleOpsCommand)],
  [
    "bugsink",
    () => import("./handlers/bugsink.ts").then((m) => m.handleBugsinkCommand),
  ],
  [
    "discord",
    () => import("./handlers/discord.ts").then((m) => m.handleDiscordCommand),
  ],
  ["mc", () => import("./handlers/mc.ts").then((m) => m.handleMcCommand)],
  [
    "history",
    () => import("./handlers/history.ts").then((m) => m.handleHistoryCommand),
  ],
]);

/**
 * Brokered credentials resolve into Bun.env just in time; passthrough
 * children inherit exactly the assembled env. Discord proceeds when either
 * identity resolves since bot and user tokens serve different commands.
 * `daemon status`/`stop` never resolve: they only read daemon state.
 */
async function resolveCommandCredentials(
  command: string,
  args: readonly string[],
): Promise<void> {
  const subcommand = args[1];
  // CI validates help and arguments before resolving its operational credentials.
  if (command === "ci" || command === "deploy") {
    return;
  }
  if (
    command === "discord" &&
    subcommand === "daemon" &&
    (args[2] === "status" || args[2] === "stop")
  ) {
    return;
  }
  if (command !== "discord") {
    await resolveCredentials(
      requiredCredentialsFor(command, subcommand, Bun.env, args.slice(1)),
    );
    return;
  }
  const names = requiredCredentialsFor(command, subcommand, Bun.env);
  const failures: string[] = [];
  for (const name of names) {
    try {
      await resolveCredentials([name]);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (failures.length === names.length) {
    throw new Error(failures.join("\n"));
  }
}

/** Commands that resolve their own credentials and never export them. */
async function runBrokeredCommand(
  command: string,
  args: readonly string[],
): Promise<number | null> {
  switch (command) {
    case "talosctl": {
      const { runTalosctl } = await import("./commands/brokered/talosctl.ts");
      return runTalosctl(args);
    }
    case "kube": {
      if (args[0] !== "credential") {
        console.error("Usage: toolkit kube credential");
        return 2;
      }
      const { runKubeCredential } =
        await import("./commands/brokered/kube-credential.ts");
      return runKubeCredential(args.slice(1));
    }
    case "aws": {
      if (args[0] !== "credential") {
        console.error("Usage: toolkit aws credential <PROFILE>");
        return 2;
      }
      const { runAwsCredential } =
        await import("./commands/brokered/aws-credential.ts");
      return runAwsCredential(args.slice(1));
    }
    case "run": {
      const { runWithCredentials } = await import("./commands/brokered/run.ts");
      return runWithCredentials(args);
    }
    case "credentials": {
      const { runCredentialsCommand } =
        await import("./commands/brokered/credentials.ts");
      return runCredentialsCommand(args);
    }
    default:
      return null;
  }
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

  const brokeredExit = await runBrokeredCommand(command, args.slice(1));
  if (brokeredExit !== null) {
    process.exit(brokeredExit);
  }

  if (!isCredentialFreePassthrough(command, args.slice(1))) {
    await resolveCommandCredentials(command, args);
  }

  if (isWoodpeckerPipelineLsJson(command, args.slice(1))) {
    await handleWoodpeckerPipelineLsJson(args.slice(1));
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
  const loadSubcommandHandler = SUBCOMMAND_HANDLERS.get(command);
  if (loadSubcommandHandler !== undefined) {
    const handler = await loadSubcommandHandler();
    await handler(subcommand, args.slice(2));
    return;
  }
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
    case "screenshot-server": {
      const { screenshotServerCommand } =
        await import("./commands/screenshot/server.ts");
      if (subcommand === undefined || args.length !== 2) {
        console.error("Usage: toolkit screenshot-server <package>");
        process.exit(1);
      }
      await screenshotServerCommand(subcommand);
      return;
    }
    case "brim": {
      const { handleBrimCommand } = await import("./handlers/brim.ts");
      await handleBrimCommand(args.slice(1));
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
