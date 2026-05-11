/**
 * Performance specialist. Identifies algorithmic and resource-usage
 * regressions: O(n^2) loops in hot paths, missing batching, unnecessary
 * I/O in hot paths, leaked timers / event listeners, excessive allocations,
 * unbounded growth.
 *
 * Model: Opus 4.7 + adaptive thinking + effort=high. Performance review
 * benefits less from extended thinking than correctness — the heuristics
 * are pattern-based — but Opus 4.7's literal instruction-following still
 * earns its keep.
 */

import { withSpan } from "#observability/tracing.ts";
import type { PrReviewContext } from "#shared/pr-review/context.ts";
import type { PrReviewPipelineInput } from "#shared/schemas.ts";
import {
  defaultSpecialistClient,
  runSpecialistPass,
  withSentryCapture,
  type SpecialistAnthropicClient,
  type SpecialistConfig,
  type SpecialistRunResult,
} from "./runner.ts";

export const PERF_MODEL = "claude-opus-4-7";
export const PERF_EFFORT = "high" as const;
export const PERF_MAX_TOKENS = 16_000;
const MAX_FILES_IN_PROMPT = 150;

export const PERF_SYSTEM_PROMPT = `\
You are a performance engineer reviewing a pull request on a TypeScript / Bun monorepo.

You are operating as the **performance specialist** in a multi-agent review pipeline. Your job is to find performance regressions and resource-usage defects that benchmarks would surface but pre-merge tooling cannot:

- Algorithmic complexity: O(n²) or worse on data that can grow; cubic time hidden behind \`Array#filter\` inside \`Array#map\`; pathological regex backtracking.
- I/O in hot paths: synchronous filesystem calls inside request handlers; per-row database calls in a loop (N+1).
- Missed batching / streaming: collecting an entire result set instead of streaming; sending one HTTP request per item instead of one batched call.
- Resource leaks: unbounded caches, unawaited timers, event listeners not removed, file handles not closed.
- Excessive allocations: cloning large objects every call, building strings via repeated concatenation in a tight loop.
- Concurrency anti-patterns: serializing work that should be parallel via \`Promise.all\`; sleeping in retries without backoff.

Out of scope: micro-optimizations with no measurable impact ("you could use \`for\` instead of \`forEach\`" — skip). Be quantitative when you can ("this loop is O(files × callers) ≈ 10⁶ per PR review"). If the PR is performance-neutral, return an empty findings array.

Ground every claim in code you can cite by path and line number from the supplied diff. Do not invent file content. The supplied CLAUDE.md hierarchy may flag hot paths or performance-critical packages.

For each finding, fill in every required field of the schema. Use \`file\` for the repo-relative path. Use \`verifier\` to declare the empirical check (\`typecheck\` / \`eslint\` / \`grep\` / \`test\` / \`none\`). Performance bugs are often unverifiable in this list — use \`"none"\` honestly rather than overclaiming. \`confidence\` is your self-reported probability that the finding is real (0..1). \`id\` should be a short stable token derived from file + line + claim.

Always set \`kind\` to \`"performance"\` — other specialists handle correctness, security, convention, and deps; do not encroach.`;

export const PERF_CONFIG: SpecialistConfig = {
  id: "perf",
  kind: "performance",
  model: PERF_MODEL,
  effort: PERF_EFFORT,
  maxTokens: PERF_MAX_TOKENS,
  systemPrompt: PERF_SYSTEM_PROMPT,
  maxFilesInPrompt: MAX_FILES_IN_PROMPT,
};

export type PerfReviewInput = {
  pipeline: PrReviewPipelineInput;
  context: PrReviewContext;
  passId: number;
};

export async function runPerfReviewer(
  client: SpecialistAnthropicClient,
  input: PerfReviewInput,
): Promise<SpecialistRunResult> {
  return runSpecialistPass(client, {
    config: PERF_CONFIG,
    pipeline: input.pipeline,
    context: input.context,
    passId: input.passId,
  });
}

export async function perfReviewer(
  input: PerfReviewInput,
): Promise<SpecialistRunResult> {
  return await withSpan(
    "prReview.perfReviewer",
    {
      "pr.owner": input.pipeline.owner,
      "pr.repo": input.pipeline.repo,
      "pr.number": input.pipeline.prNumber,
      "specialist.pass": input.passId,
      "changedFiles.count": input.context.changedFiles.length,
      "claudeMd.count": input.context.claudeMdHierarchy.length,
    },
    async () => {
      const client = defaultSpecialistClient();
      const request = {
        config: PERF_CONFIG,
        pipeline: input.pipeline,
        context: input.context,
        passId: input.passId,
      };
      try {
        return await runSpecialistPass(client, request);
      } catch (error: unknown) {
        withSentryCapture(request)(error);
        throw error;
      }
    },
  );
}
