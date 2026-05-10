#!/usr/bin/env bun
/**
 * Replay the pr-review pipeline against a real PR — read-only, never posts.
 *
 * Usage:
 *   bun run packages/temporal/scripts/replay-pr-review.ts --pr 724 --baseline
 *
 * Defaults to the monorepo's own repo (`shepherdjerred/monorepo`). Override
 * with `--owner` and `--repo`.
 *
 * Local-only execution: bypasses the Temporal server and calls the bootstrap
 * and correctnessReviewer functions directly. Suitable for iterating on the
 * prompt locally and for the "replay against last 50 PRs" continuous-eval
 * use case in later phases. For full-fidelity replay through the worker,
 * trigger a webhook redelivery from the GitHub UI on a test PR — that
 * exercises the real workflow path with retries, OTel spans, etc.
 *
 * Requires:
 *   - GH_TOKEN          — read access to the target repo
 *   - ANTHROPIC_API_KEY — passed to the Anthropic SDK by correctnessReviewer
 */

import { Octokit } from "octokit";
import Anthropic from "@anthropic-ai/sdk";
import { runBootstrap } from "#activities/pr-review/bootstrap.ts";
import {
  buildCorrectnessUserText,
  makeCorrectnessClient,
  runCorrectnessReviewer,
} from "#activities/pr-review/specialists/correctness.ts";
import { markerFor, renderCommentBody } from "#activities/pr-review/post.ts";
import type { PrReviewPipelineInput } from "#shared/schemas.ts";

type CliArgs = {
  owner: string;
  repo: string;
  prNumber: number;
  baseline: boolean;
  printPrompt: boolean;
};

function takeValue(argv: readonly string[], i: number, flag: string): string {
  const v = argv[i];
  if (typeof v !== "string") {
    throw new TypeError(`${flag} requires a value`);
  }
  return v;
}

function parseArgs(argv: readonly string[]): CliArgs {
  let owner = "shepherdjerred";
  let repo = "monorepo";
  let prNumberRaw: string | undefined;
  let baseline = false;
  let printPrompt = false;

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === undefined) {
      continue;
    }
    if (a === "--help" || a === "-h") {
      printUsage();
      process.exit(0);
    }
    switch (a) {
      case "--owner":
        i += 1;
        owner = takeValue(argv, i, "--owner");
        break;
      case "--repo":
        i += 1;
        repo = takeValue(argv, i, "--repo");
        break;
      case "--pr":
        i += 1;
        prNumberRaw = takeValue(argv, i, "--pr");
        break;
      case "--baseline":
        baseline = true;
        break;
      case "--print-prompt":
        printPrompt = true;
        break;
      default:
        throw new Error(`unknown flag: ${a}`);
    }
  }
  if (prNumberRaw === undefined) {
    throw new Error("--pr <number> is required");
  }
  const prNumber = Number.parseInt(prNumberRaw, 10);
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    throw new Error(`invalid --pr value: ${prNumberRaw}`);
  }
  return { owner, repo, prNumber, baseline, printPrompt };
}

function printUsage(): void {
  const lines = [
    "Usage: replay-pr-review.ts --pr <number> [--owner X] [--repo Y] [--baseline] [--print-prompt]",
    "",
    "Flags:",
    "  --pr <number>     PR number to replay (required)",
    "  --owner <login>   Repo owner (default: shepherdjerred)",
    "  --repo <name>     Repo name (default: monorepo)",
    "  --baseline        Run the single-specialist (correctness only) baseline.",
    "                    Phase 2's only mode — phases 3+ will add --consensus etc.",
    "  --print-prompt    Also dump the system + user prompt to stderr before the",
    "                    SDK call, for prompt-iteration work.",
    "  -h, --help        Show this message",
  ];
  for (const line of lines) {
    process.stderr.write(`${line}\n`);
  }
}

function requireEnv(name: string): string {
  const v = Bun.env[name];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`${name} environment variable is required`);
  }
  return v;
}

async function fetchPipelineInput(
  octokit: Octokit,
  args: CliArgs,
): Promise<PrReviewPipelineInput> {
  const { data: pr } = await octokit.rest.pulls.get({
    owner: args.owner,
    repo: args.repo,
    pull_number: args.prNumber,
  });
  return {
    owner: args.owner,
    repo: args.repo,
    prNumber: args.prNumber,
    commitSha: pr.head.sha,
    baseRef: pr.base.ref,
    headRef: pr.head.ref,
    prTitle: pr.title,
    prAuthor: pr.user.login,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.baseline) {
    process.stderr.write(
      "Phase 2 only supports --baseline (single-specialist parity baseline). " +
        "Pass --baseline to proceed.\n",
    );
    process.exit(2);
  }
  const ghToken = requireEnv("GH_TOKEN");
  const anthropicKey = requireEnv("ANTHROPIC_API_KEY");

  const octokit = new Octokit({ auth: ghToken });
  process.stderr.write(
    `Fetching ${args.owner}/${args.repo}#${String(args.prNumber)}...\n`,
  );
  const pipelineInput = await fetchPipelineInput(octokit, args);

  process.stderr.write(
    `Bootstrap: listing files + walking CLAUDE.md hierarchy at ${pipelineInput.commitSha.slice(0, 7)}...\n`,
  );
  const context = await runBootstrap(octokit, pipelineInput, (note) => {
    process.stderr.write(`  bootstrap heartbeat: ${note}\n`);
  });
  process.stderr.write(
    `  ${String(context.changedFiles.length)} files, ${String(context.claudeMdHierarchy.length)} CLAUDE.md files\n`,
  );

  if (args.printPrompt) {
    process.stderr.write("\n--- USER PROMPT START ---\n");
    process.stderr.write(
      buildCorrectnessUserText({ pipeline: pipelineInput, context }),
    );
    process.stderr.write("\n--- USER PROMPT END ---\n\n");
  }

  process.stderr.write(
    "Invoking correctnessReviewer (Anthropic SDK, claude-opus-4-7, effort=high)...\n",
  );
  const client = makeCorrectnessClient(new Anthropic({ apiKey: anthropicKey }));
  const result = await runCorrectnessReviewer(client, {
    pipeline: pipelineInput,
    context,
  });

  process.stderr.write(
    `Done in ${String(result.durationMs)}ms; ${String(result.findings.length)} findings; cost ~$${String(result.costUsd ?? "n/a")}; tokens in=${String(result.tokens.input)} out=${String(result.tokens.output)} cacheRead=${String(result.tokens.cacheRead)}\n\n`,
  );

  // Render the would-be comment exactly as postReview would.
  const fakeWorkflowId = `pr-review-pipeline-${args.owner}-${args.repo}-${String(args.prNumber)}-${pipelineInput.commitSha}`;
  const marker = markerFor(fakeWorkflowId);
  const body = renderCommentBody(
    { pipeline: pipelineInput, findings: result.findings },
    marker,
  );
  // The would-be comment goes to stdout so the operator can pipe it into a
  // file or `gh pr view --comments` diff for parity checking. Side-channel
  // diagnostic output stays on stderr.
  process.stdout.write(body);
  process.stdout.write("\n");
}

void (async (): Promise<void> => {
  try {
    await main();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`replay-pr-review failed: ${message}\n`);
    if (error instanceof Error && error.stack !== undefined) {
      process.stderr.write(`${error.stack}\n`);
    }
    process.exit(1);
  }
})();
