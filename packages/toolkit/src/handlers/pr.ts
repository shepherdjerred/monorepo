import { parseArgs } from "node:util";
import { assetCommand } from "#commands/pr/asset.ts";
import {
  reviewHarvestCommand,
  reviewListCommand,
  reviewResolveCommand,
} from "#commands/pr/review.ts";
import { healthCommand } from "#commands/pr/health.ts";
import { landCommand } from "#commands/pr/land.ts";
import { parseTimeout } from "#lib/ci/arguments.ts";

function helpRequested(args: string[]): boolean {
  return args.includes("--help") || args.includes("-h");
}

function printHealthUsage(): void {
  console.log("Usage: toolkit pr health [PR_NUMBER] [--json]");
}

const LAND_USAGE = `Usage: toolkit pr land [PR] [--head <SHA>] [--timeout <duration>] [--allow-red-main] [--json]

Wait for exact-head merge readiness, then squash-merge with git-spice. Merge
only when the task authorizes it. A red main keeps the wait open until main
recovers unless --allow-red-main is passed.

Exits: 0 merged, 1 check failure/conflict, 2 upstream/usage error, 3 human
intervention, 4 head changed, 6 timeout, 7 PR closed/merged, 8 merge command
failed after readiness. After a fix and push, run pr land again.`;

function printAssetUsage(): void {
  console.log(
    "Usage: toolkit pr asset <PR> <FILE|DIR...> [--markdown] [--profile <name>]",
  );
}

function printReviewUsage(): void {
  console.log(`Usage: toolkit pr review <ACTION> <PR> [OPTIONS]

Actions:
  list <PR>     List provider findings
  resolve <PR>  Resolve a finding (--finding and --evidence required)
  harvest <PR>  Report late review-gate failures (--retry to rerun)

Options:
  --repo <owner/repo>  Repository (default: auto-detect)
  --json               Output as JSON
  --finding <key>      Finding key or exact title
  --evidence <text>    Why a finding is resolved
  --provider <id>      Provider (default: codex)
  --retry              Rerun eligible harvest jobs`);
}

async function handleHealth(args: string[]): Promise<void> {
  if (helpRequested(args)) {
    printHealthUsage();
    return;
  }
  const { values, positionals } = parseArgs({
    args,
    options: {
      json: { type: "boolean", default: false },
    },
    allowPositionals: true,
  });
  await healthCommand(positionals[0], { json: values.json });
}

async function handleLand(args: string[]): Promise<void> {
  if (helpRequested(args)) {
    console.log(LAND_USAGE);
    return;
  }
  const json = args.includes("--json");
  let options: Parameters<typeof landCommand>[1];
  let pr: string | undefined;
  try {
    const { values, positionals } = parseArgs({
      args,
      options: {
        json: { type: "boolean", default: false },
        head: { type: "string" },
        timeout: { type: "string" },
        "allow-red-main": { type: "boolean", default: false },
      },
      allowPositionals: true,
    });
    if (positionals.length > 1)
      throw new Error("Unexpected positional arguments");
    if (values.head !== undefined && !/^[a-f\d]{40}$/i.test(values.head))
      throw new Error("--head must be a full 40-character commit SHA");
    if (positionals[0] !== undefined && !/^[1-9]\d*$/.test(positionals[0]))
      throw new Error("PR must be a positive number");
    pr = positionals[0];
    options = {
      json: values.json,
      head: values.head?.toLowerCase(),
      timeoutMs:
        values.timeout === undefined ? undefined : parseTimeout(values.timeout),
      allowRedMain: values["allow-red-main"],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json)
      console.log(
        JSON.stringify({ outcome: "error", ready: false, error: message }),
      );
    else console.error(`${message}\n${LAND_USAGE}`);
    process.exitCode = 2;
    return;
  }
  await landCommand(pr, options);
}

async function handleAsset(args: string[]): Promise<void> {
  if (helpRequested(args)) {
    printAssetUsage();
    return;
  }
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
  if (helpRequested(args)) {
    printReviewUsage();
    return;
  }
  const { values, positionals } = parseArgs({
    args,
    options: {
      repo: { type: "string" },
      json: { type: "boolean", default: false },
      finding: { type: "string" },
      evidence: { type: "string" },
      provider: { type: "string" },
      retry: { type: "boolean", default: false },
      all: { type: "boolean", default: false },
    },
    allowPositionals: true,
  });
  const [action, ...rest] = positionals;
  const options = {
    repo: values.repo,
    json: values.json,
    finding: values.finding,
    evidence: values.evidence,
    provider: values.provider,
    all: values.retry,
    includeAll: values.all,
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
toolkit pr - monorepo pull request workflows

Subcommands:
  health [PR_NUMBER]         Check PR health (conflicts, CI, approval)
  land [PR]                  Wait for exact-head readiness, then squash-merge
                             with git-spice (only when merging is authorized)
  asset <PR> <FILE|DIR...>   Upload PR media (images, video, asciinema .cast,
                             static demo-site dirs) to public.sjer.red and
                             print URLs. Dirs need a root index.html; .cast
                             files get a generated HTML player page and an
                             agg-rendered GIF preview (requires agg).

  review list [PR]    Current feedback from every reviewer, including author,
                       priority, contents, source handles, and raw API command
  review resolve <PR>  Clear one finding on every surface at once
                       (--finding <key|title> --evidence <text>)
  review harvest <PR…> Report gates that failed only because the review
                       landed late; --retry to actually re-run them

Options:
  --repo <owner/repo>   (review) Repository (default: auto-detect)
  --json                Output as JSON
  --head <SHA>          (land) Pin the full PR head SHA
  --timeout <duration>  (land) Optional deadline (e.g. 2h); default: unlimited
  --allow-red-main      (land) Merge while main is red instead of waiting
  --markdown            (asset) Emit type-appropriate markdown (inline image
                        tags for images, an inline GIF linked to the player
                        for .cast files, labeled links for video/demo pages)
                        instead of bare URLs
  --profile <name>      (asset) AWS profile to use (overrides AWS_PROFILE)
  --finding <key>       (review resolve) Finding key or exact title
  --evidence <text>     (review resolve) Why it is resolved; required
  --provider <id>       Filter list to one provider; resolve defaults to codex
  --all                 (review list) Include resolved and outdated feedback
  --retry               (review harvest) Re-run the eligible jobs

Credentials (asset):
  Uses the standard AWS toolchain. Credentials, endpoint (endpoint_url), and
  region are resolved from ~/.aws/credentials, ~/.aws/config, and AWS_* env
  vars — like the AWS CLI. Pass --profile <name> or set AWS_PROFILE.
`);
    return;
  }

  switch (subcommand) {
    case "health":
      await handleHealth(args);
      break;
    case "land":
      await handleLand(args);
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
