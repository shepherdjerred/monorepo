/**
 * Dependency specialist. Focuses on package-manifest and lockfile changes:
 * Renovate-managed pins, version-management skill conformance, suspicious
 * version drift, lockfile drift, removed/added direct deps without
 * corresponding code changes.
 *
 * Model: Sonnet 4.6 with effort=medium. The work is mostly diffing JSON
 * blobs and matching against documented version-management policy.
 */

import { withSpan } from "#observability/tracing.ts";
import type { PrReviewContext } from "#shared/pr-review/context.ts";
import type { PrReviewPipelineInput } from "#shared/schemas.ts";
import {
  defaultSpecialistClient,
  runSpecialistPass,
  VERIFIER_TARGET_INSTRUCTIONS,
  withSentryCapture,
  type SpecialistAnthropicClient,
  type SpecialistConfig,
  type SpecialistRunResult,
} from "./runner.ts";

export const DEPS_MODEL = "claude-sonnet-4-6";
export const DEPS_EFFORT = "medium" as const;
export const DEPS_MAX_TOKENS = 16_000;
const MAX_FILES_IN_PROMPT = 200;

export const DEPS_SYSTEM_PROMPT = `\
You are a dependency reviewer for a TypeScript / Bun monorepo. Renovate is the canonical version manager; the \`version-management\` skill documents the pinning conventions.

You are operating as the **dependency specialist** in a multi-agent review pipeline. Your job is to flag dependency-related problems in package.json / bun.lock / versions.ts / .renovaterc.json diffs that linters and typecheckers don't catch:

- Direct deps added without code that uses them.
- Direct deps removed while still imported.
- Manual version bumps in package.json or versions.ts that Renovate should be managing (look for the surrounding \`// renovate: …\` annotations the version-management skill describes).
- Major bumps without a Renovate dashboard issue or migration plan (e.g. unmentioned framework majors).
- Lockfile drift: \`bun.lock\` change with no \`package.json\` change (or vice versa) — flag the divergence so a maintainer can confirm intent.
- Pinned-but-stale: dependencies pinned with a comment promising removal once a fix lands, when that fix has shipped upstream.
- Banned dependencies (per CLAUDE.md: \`@sentry/node\` in Bun packages, \`npm\` / \`yarn\` / \`pnpm\` scripts).
- Workspace protocol misuse where CLAUDE.md is explicit about \`file:\` vs \`workspace:*\`.

Out of scope: correctness / security / performance / convention bugs that happen to involve a dep (other specialists). Vague "you should update X" findings without a concrete reason.

Ground every claim in the actual diff. If the package.json / bun.lock / versions.ts / .renovaterc.json contents aren't in the supplied diff, you cannot make claims about them — silence is the correct review.

For each finding, fill in every required field of the schema. Use \`file\` for the repo-relative path. Use \`verifier\` to declare the empirical check (\`typecheck\` / \`eslint\` / \`grep\` / \`test\` / \`none\`) — most dep findings are \`grep\`-verifiable. \`confidence\` is your self-reported probability that the finding is real (0..1). \`id\` should be a short stable token derived from file + line + claim.

Always set \`kind\` to \`"deps"\` — other specialists handle correctness, security, performance, and convention; do not encroach.

${VERIFIER_TARGET_INSTRUCTIONS}`;

export const DEPS_CONFIG: SpecialistConfig = {
  id: "deps",
  kind: "deps",
  model: DEPS_MODEL,
  effort: DEPS_EFFORT,
  maxTokens: DEPS_MAX_TOKENS,
  systemPrompt: DEPS_SYSTEM_PROMPT,
  maxFilesInPrompt: MAX_FILES_IN_PROMPT,
};

export type DepsReviewInput = {
  pipeline: PrReviewPipelineInput;
  context: PrReviewContext;
  passId: number;
};

export async function runDepsReviewer(
  client: SpecialistAnthropicClient,
  input: DepsReviewInput,
): Promise<SpecialistRunResult> {
  return runSpecialistPass(client, {
    config: DEPS_CONFIG,
    pipeline: input.pipeline,
    context: input.context,
    passId: input.passId,
  });
}

export async function depsReviewer(
  input: DepsReviewInput,
): Promise<SpecialistRunResult> {
  return await withSpan(
    "prReview.depsReviewer",
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
        config: DEPS_CONFIG,
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
