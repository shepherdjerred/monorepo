#!/usr/bin/env bun
/**
 * Replay the pr-review pipeline against a real PR. Read-only; never posts.
 *
 * Usage:
 *   bun run packages/temporal/scripts/replay-pr-review.ts --pr 826
 *   bun run packages/temporal/scripts/replay-pr-review.ts --pr 826 --deterministic-only
 *   bun run packages/temporal/scripts/replay-pr-review.ts --pr 724 --baseline
 *
 * Defaults to the monorepo's own repo (`shepherdjerred/monorepo`). Override
 * with `--owner` and `--repo`.
 *
 * Requires:
 *   - GITHUB_APP_ID / GITHUB_APP_INSTALLATION_ID / GITHUB_APP_PRIVATE_KEY
 *                              - read access to the target repo
 *   - CLAUDE_CODE_OAUTH_TOKEN  - full replay with specialist LLM calls
 *   - ANTHROPIC_API_KEY        - legacy `--baseline` mode only
 */

import { Octokit } from "octokit";
import Anthropic from "@anthropic-ai/sdk";
import {
  cleanupWorkdir,
  runBootstrap,
} from "#activities/pr-review/bootstrap.ts";
import { enrichBootstrapWithWorkdir } from "#activities/pr-review/bootstrap-enrich.ts";
import { deterministicSignalActivities } from "#activities/pr-review/deterministic-signals.ts";
import {
  buildCorrectnessUserText,
  makeCorrectnessClient,
  runCorrectnessReviewer,
} from "#activities/pr-review/specialists/correctness.ts";
import { CORRECTNESS_CONFIG } from "#activities/pr-review/specialists/correctness-adapter.ts";
import { SECURITY_CONFIG } from "#activities/pr-review/specialists/security.ts";
import { PERF_CONFIG } from "#activities/pr-review/specialists/perf.ts";
import { CONVENTION_CONFIG } from "#activities/pr-review/specialists/convention.ts";
import { DEPS_CONFIG } from "#activities/pr-review/specialists/deps.ts";
import {
  defaultSpecialistClient,
  runSpecialistPass,
  type SpecialistAnthropicClient,
  type SpecialistConfig,
  type SpecialistRunResult,
} from "#activities/pr-review/specialists/runner.ts";
import { runWithConcurrency } from "#activities/pr-review/specialists.ts";
import {
  buildInlineReviewComments,
  markerFor,
  renderCommentBody,
} from "#activities/pr-review/post-render.ts";
import { runVerifyFindings } from "#activities/pr-review/verify.ts";
import { makeBunSpawnVerifierRunner } from "#activities/pr-review/verify-runner.ts";
import {
  voteOnFindings,
  type AnnotatedFinding,
} from "#activities/pr-review/consensus.ts";
import { dedupeActivities } from "#activities/pr-review/dedupe.ts";
import type { BootstrapResult } from "#activities/pr-review/bootstrap.ts";
import type { Finding } from "#shared/pr-review/finding.ts";
import { createGitHubAppInstallationToken } from "#lib/github-app-token.ts";
import type { PrReviewPipelineInput } from "#shared/schemas.ts";
import { PASSES_PER_SPECIALIST } from "#lib/diff-slicing.ts";
import { runToolkitRecallSearch } from "#lib/hybrid-retrieval.ts";
import { defaultWorkdirDeps } from "#lib/pr-review-workdir.ts";

type CliArgs = {
  owner: string;
  repo: string;
  prNumber: number;
  baseline: boolean;
  deterministicOnly: boolean;
  keepWorkdir: boolean;
  printPrompt: boolean;
};

const REPLAY_SPECIALISTS: readonly SpecialistConfig[] = [
  CORRECTNESS_CONFIG,
  SECURITY_CONFIG,
  PERF_CONFIG,
  CONVENTION_CONFIG,
  DEPS_CONFIG,
];

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
  let deterministicOnly = false;
  let keepWorkdir = false;
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
      case "--deterministic-only":
        deterministicOnly = true;
        break;
      case "--keep-workdir":
        keepWorkdir = true;
        break;
      case "--print-prompt":
        printPrompt = true;
        break;
      default:
        throw new Error(`unknown flag: ${a}`);
    }
  }
  if (baseline && deterministicOnly) {
    throw new Error(
      "--baseline and --deterministic-only are mutually exclusive",
    );
  }
  if (prNumberRaw === undefined) {
    throw new Error("--pr <number> is required");
  }
  const prNumber = Number.parseInt(prNumberRaw, 10);
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    throw new Error(`invalid --pr value: ${prNumberRaw}`);
  }
  return {
    owner,
    repo,
    prNumber,
    baseline,
    deterministicOnly,
    keepWorkdir,
    printPrompt,
  };
}

function printUsage(): void {
  const lines = [
    "Usage: replay-pr-review.ts --pr <number> [--owner X] [--repo Y] [--baseline] [--deterministic-only] [--keep-workdir] [--print-prompt]",
    "",
    "Default mode runs the current read-only review pipeline: bootstrap with a",
    "real workdir, deterministic signals, specialists, consensus, verification,",
    "dedupe, and comment rendering.",
    "",
    "Flags:",
    "  --pr <number>          PR number to replay (required)",
    "  --owner <login>        Repo owner (default: shepherdjerred)",
    "  --repo <name>          Repo name (default: monorepo)",
    "  --baseline             Run the legacy single-correctness-specialist path.",
    "  --deterministic-only   Skip LLM specialists; useful for verifier/signal regressions.",
    "  --keep-workdir         Do not delete the cloned PR workdir after replay.",
    "  --print-prompt         In --baseline mode, dump the user prompt to stderr.",
    "  -h, --help             Show this message",
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

function heartbeat(note: string): void {
  process.stderr.write(`  bootstrap heartbeat: ${note}\n`);
}

function workflowIdFor(input: PrReviewPipelineInput): string {
  return `pr-review-replay-${input.owner}-${input.repo}-${String(input.prNumber)}-${input.commitSha}`;
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

async function bootstrapReplayContext(
  octokit: Octokit,
  pipeline: PrReviewPipelineInput,
  ghToken: string,
): Promise<BootstrapResult> {
  process.stderr.write(
    `Bootstrap: listing files + walking agent instructions hierarchy at ${pipeline.commitSha.slice(0, 7)}...\n`,
  );
  const base = await runBootstrap(octokit, pipeline, heartbeat);
  process.stderr.write(
    `  ${String(base.changedFiles.length)} files, ${String(base.claudeMdHierarchy.length)} instruction files\n`,
  );

  process.stderr.write(
    "Bootstrap: cloning PR head + building retrieval context...\n",
  );
  const enriched = await enrichBootstrapWithWorkdir({
    base,
    pipeline,
    workflowId: workflowIdFor(pipeline),
    env: { GH_TOKEN: ghToken },
    deps: {
      workdir: defaultWorkdirDeps,
      recallSearch: runToolkitRecallSearch,
    },
    heartbeat,
  });
  process.stderr.write(
    `  workdir=${enriched.workdir}; retrieved=${String(enriched.retrievedSymbols.length)}; blockDiffs=${String(enriched.blockDiffs.length)}\n`,
  );
  return enriched;
}

async function runLegacyBaseline(
  octokit: Octokit,
  args: CliArgs,
): Promise<string> {
  const anthropicKey = requireEnv("ANTHROPIC_API_KEY");
  process.stderr.write(
    `Fetching ${args.owner}/${args.repo}#${String(args.prNumber)}...\n`,
  );
  const pipeline = await fetchPipelineInput(octokit, args);

  const context = await runBootstrap(octokit, pipeline, heartbeat);
  if (args.printPrompt) {
    process.stderr.write("\n--- USER PROMPT START ---\n");
    process.stderr.write(buildCorrectnessUserText({ pipeline, context }));
    process.stderr.write("\n--- USER PROMPT END ---\n\n");
  }

  process.stderr.write(
    "Invoking legacy correctnessReviewer baseline (Anthropic SDK, claude-opus-4-8, effort=high)...\n",
  );
  const client = makeCorrectnessClient(new Anthropic({ apiKey: anthropicKey }));
  const result = await runCorrectnessReviewer(client, {
    pipeline,
    context,
  });

  process.stderr.write(
    `Done in ${String(result.durationMs)}ms; ${String(result.findings.length)} findings; cost ~$${String(result.costUsd ?? "n/a")}; tokens in=${String(result.tokens.input)} out=${String(result.tokens.output)} cacheRead=${String(result.tokens.cacheRead)}\n\n`,
  );

  return renderCommentBody(
    { pipeline, findings: result.findings, changedFiles: context.changedFiles },
    markerFor(workflowIdFor(pipeline)),
  );
}

async function runOneSpecialistPass(input: {
  client: SpecialistAnthropicClient;
  config: SpecialistConfig;
  pipeline: PrReviewPipelineInput;
  context: BootstrapResult;
  passId: number;
}): Promise<{
  config: SpecialistConfig;
  passId: number;
  result: SpecialistRunResult;
} | null> {
  try {
    const result = await runSpecialistPass(input.client, {
      config: input.config,
      pipeline: input.pipeline,
      context: input.context,
      passId: input.passId,
    });
    return { config: input.config, passId: input.passId, result };
  } catch (error: unknown) {
    process.stderr.write(
      `  specialist ${input.config.id} pass ${String(input.passId)} failed: ${
        error instanceof Error ? error.message : String(error)
      }\n`,
    );
    return null;
  }
}

async function runReplaySpecialists(input: {
  pipeline: PrReviewPipelineInput;
  context: BootstrapResult;
}): Promise<AnnotatedFinding[]> {
  requireEnv("CLAUDE_CODE_OAUTH_TOKEN");
  const client = defaultSpecialistClient();
  const jobs: (() => Promise<{
    config: SpecialistConfig;
    passId: number;
    result: SpecialistRunResult;
  } | null>)[] = [];

  for (const config of REPLAY_SPECIALISTS) {
    for (let passId = 0; passId < PASSES_PER_SPECIALIST; passId += 1) {
      jobs.push(() =>
        runOneSpecialistPass({
          client,
          config,
          pipeline: input.pipeline,
          context: input.context,
          passId,
        }),
      );
    }
  }

  const results = await runWithConcurrency(jobs, 3);
  const annotated: AnnotatedFinding[] = [];
  let failedPasses = 0;
  for (const result of results) {
    if (result === null) {
      failedPasses += 1;
      continue;
    }
    for (const finding of result.result.findings) {
      annotated.push({
        finding,
        specialistId: result.config.id,
        passId: result.passId,
      });
    }
  }
  process.stderr.write(
    `Specialists: ${String(annotated.length)} raw findings; ${String(failedPasses)} failed passes\n`,
  );
  return annotated;
}

async function runCurrentPipeline(
  octokit: Octokit,
  args: CliArgs,
  ghToken: string,
): Promise<string> {
  process.stderr.write(
    `Fetching ${args.owner}/${args.repo}#${String(args.prNumber)}...\n`,
  );
  const pipeline = await fetchPipelineInput(octokit, args);
  const context = await bootstrapReplayContext(octokit, pipeline, ghToken);
  let shouldCleanup = !args.keepWorkdir;

  try {
    const [machineFindings, specialistFindings] = await Promise.all([
      deterministicSignalActivities.prReviewDeterministicSignals({ context }),
      args.deterministicOnly
        ? Promise.resolve<AnnotatedFinding[]>([])
        : runReplaySpecialists({ pipeline, context }),
    ]);
    process.stderr.write(
      `Deterministic signals: ${String(machineFindings.length)} annotated findings\n`,
    );
    const deterministicFindingCount = new Set(
      machineFindings.map((finding) => finding.finding.id),
    ).size;
    const specialistFindingCount = new Set(
      specialistFindings.map((finding) => finding.finding.id),
    ).size;

    const annotated = [...machineFindings, ...specialistFindings];
    const consensusFindings: Finding[] = voteOnFindings({ annotated });
    process.stderr.write(
      `Consensus: ${String(annotated.length)} in -> ${String(consensusFindings.length)} kept\n`,
    );

    const verifiedFindings = await runVerifyFindings(
      makeBunSpawnVerifierRunner(context.workdir),
      consensusFindings,
    );
    process.stderr.write(
      `Verification: ${String(consensusFindings.length)} in -> ${String(verifiedFindings.length)} kept\n`,
    );

    const dedupedFindings = await dedupeActivities.prReviewDedupe({
      owner: pipeline.owner,
      repo: pipeline.repo,
      findings: verifiedFindings,
    });
    process.stderr.write(
      `Dedupe: ${String(verifiedFindings.length)} in -> ${String(dedupedFindings.length)} kept\n\n`,
    );
    const inline = buildInlineReviewComments({
      pipeline,
      findings: dedupedFindings,
      changedFiles: context.changedFiles,
      existingMarkers: new Set<string>(),
    });
    process.stderr.write(
      `Inline build: ${String(inline.summary.posted)} postable; ${String(inline.summary.skippedUnanchored)} unanchored; ${String(inline.summary.skippedUnverified)} unverified; ${String(inline.summary.skippedDuplicate)} duplicate\n\n`,
    );

    if (args.keepWorkdir) {
      shouldCleanup = false;
      process.stderr.write(`Kept workdir: ${context.workdir}\n`);
    }

    return renderCommentBody(
      {
        pipeline,
        findings: dedupedFindings,
        changedFiles: context.changedFiles,
        stageCounts: {
          deterministicFindings: deterministicFindingCount,
          specialistFindings: specialistFindingCount,
          consensusFindings: consensusFindings.length,
          verifiedFindings: verifiedFindings.length,
          dedupedFindings: dedupedFindings.length,
        },
      },
      markerFor(workflowIdFor(pipeline)),
      inline.summary,
    );
  } finally {
    if (shouldCleanup && context.workdir.length > 0) {
      await cleanupWorkdir(context.workdir);
    }
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const tokenResult = await createGitHubAppInstallationToken();
  const ghToken = tokenResult.token;
  const octokit = new Octokit({ auth: ghToken });

  const body = args.baseline
    ? await runLegacyBaseline(octokit, args)
    : await runCurrentPipeline(octokit, args, ghToken);

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
