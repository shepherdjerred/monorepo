import { parseArgs } from "node:util";
import { assetCommand } from "#commands/pr/asset.ts";
import { detectCommand } from "#commands/pr/detect.ts";
import { healthCommand } from "#commands/pr/health.ts";
import { logsCommand } from "#commands/pr/logs.ts";

async function handleHealth(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      repo: { type: "string" },
      json: { type: "boolean", default: false },
    },
    allowPositionals: true,
  });
  await healthCommand(positionals[0], { repo: values.repo, json: values.json });
}

async function handleLogs(args: string[]): Promise<void> {
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
  if (runId == null || runId.length === 0) {
    console.error("Error: Run ID is required");
    console.error(
      "Usage: tools pr logs <run-id> [--failed-only] [--job <name>]",
    );
    process.exit(1);
  }
  await logsCommand(runId, {
    repo: values.repo,
    failedOnly: values["failed-only"],
    job: values.job,
  });
}

async function handleAsset(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      markdown: { type: "boolean", default: false },
    },
    allowPositionals: true,
  });
  const [prNumber, ...files] = positionals;
  await assetCommand(prNumber, files, { markdown: values.markdown });
}

async function handleDetect(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      repo: { type: "string" },
      json: { type: "boolean", default: false },
    },
    allowPositionals: true,
  });
  await detectCommand({ repo: values.repo, json: values.json });
}

export async function handlePrCommand(
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
tools pr - Pull request utilities

Subcommands:
  health [PR_NUMBER]         Check PR health (conflicts, CI, approval)
  logs <RUN_ID>              Get workflow run logs
  detect                     Detect PR for current branch
  asset <PR> <FILE...>       Upload screenshots to public.sjer.red and print URLs

Options:
  --repo <owner/repo>   Repository (default: auto-detect)
  --json                Output as JSON
  --failed-only         (logs) Only show failed job logs
  --job <name>          (logs) Filter to specific job
  --markdown            (asset) Emit markdown image tags instead of bare URLs

Environment (asset):
  SEAWEEDFS_ACCESS_KEY_ID, SEAWEEDFS_SECRET_ACCESS_KEY   SeaweedFS S3 credentials
  SEAWEEDFS_S3_ENDPOINT                                  Override S3 endpoint
`);
    process.exit(0);
  }

  switch (subcommand) {
    case "health":
      await handleHealth(args);
      break;
    case "logs":
      await handleLogs(args);
      break;
    case "detect":
      await handleDetect(args);
      break;
    case "asset":
      await handleAsset(args);
      break;
    default:
      console.error(`Unknown pr subcommand: ${subcommand}`);
      process.exit(1);
  }
}
