import { parseArgs } from "node:util";
import { assetCommand } from "#commands/pr/asset.ts";
import {
  reviewHarvestCommand,
  reviewListCommand,
  reviewResolveCommand,
} from "#commands/pr/review.ts";
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
      profile: { type: "string" },
    },
    allowPositionals: true,
  });
  const [prNumber, ...files] = positionals;
  await assetCommand(prNumber, files, {
    markdown: values.markdown,
    profile: values.profile,
  });
}

async function handleReview(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      repo: { type: "string" },
      json: { type: "boolean", default: false },
      finding: { type: "string" },
      evidence: { type: "string" },
      retry: { type: "boolean", default: false },
    },
    allowPositionals: true,
  });
  const [action, ...rest] = positionals;
  const options = {
    repo: values.repo,
    json: values.json,
    finding: values.finding,
    evidence: values.evidence,
    all: values.retry,
  };
  // Handled before the switch rather than as a case: `process.exit` returns
  // `never`, so a `break` there is unreachable code while its absence reads as
  // a fallthrough.
  if (action === undefined) {
    console.error("Usage: toolkit pr review <list|resolve|harvest> <pr>");
    process.exit(1);
  }
  switch (action) {
    case "list":
      await reviewListCommand(rest[0], options);
      return;
    case "resolve":
      await reviewResolveCommand(rest[0], options);
      return;
    case "harvest":
      await reviewHarvestCommand(rest, options);
      return;
    default:
      console.error(
        `Unknown pr review action: ${action}. Expected list, resolve, or harvest.`,
      );
      process.exit(1);
  }
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
    subcommand === "--help" ||
    subcommand === "-h" ||
    subcommand == null ||
    subcommand.length === 0
  ) {
    console.log(`
tools pr - Pull request utilities

Subcommands:
  health [PR_NUMBER]         Check PR health (conflicts, CI, approval)
  logs <RUN_ID>              Get workflow run logs
  detect                     Detect PR for current branch
  asset <PR> <FILE|DIR...>   Upload PR media (images, video, asciinema .cast,
                             static demo-site dirs) to public.sjer.red and
                             print URLs. Dirs need a root index.html; .cast
                             files get a generated HTML player page.

  review list <PR>     Every provider finding, deduplicated across the
                       surfaces it was posted on, with both handles
  review resolve <PR>  Clear one finding on every surface at once
                       (--finding <key|title> --evidence <text>)
  review harvest <PR…> Report gates that failed only because the review
                       landed late; --retry to actually re-run them

Options:
  --repo <owner/repo>   Repository (default: auto-detect)
  --json                Output as JSON
  --failed-only         (logs) Only show failed job logs
  --job <name>          (logs) Filter to specific job
  --markdown            (asset) Emit type-appropriate markdown (inline image
                        tags for images, labeled links for video/demo/player
                        pages) instead of bare URLs
  --profile <name>      (asset) AWS profile to use (overrides AWS_PROFILE)
  --finding <key>       (review resolve) Finding key or exact title
  --evidence <text>     (review resolve) Why it is resolved; required
  --retry               (review harvest) Re-run the eligible jobs

Credentials (asset):
  Uses the standard AWS toolchain. Credentials, endpoint (endpoint_url), and
  region are resolved from ~/.aws/credentials, ~/.aws/config, and AWS_* env
  vars — like the AWS CLI. Pass --profile <name> or set AWS_PROFILE.
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
    case "review":
      await handleReview(args);
      break;
    default:
      console.error(`Unknown pr subcommand: ${subcommand}`);
      process.exit(1);
  }
}
