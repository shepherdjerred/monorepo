/**
 * Convention specialist. Enforces the CLAUDE.md hierarchy (root + per-package)
 * and codebase patterns that ESLint / Prettier can't encode: Bun-only
 * commands, banned import paths, `@sentry/bun` not `@sentry/node`, Hono
 * patterns, cdk8s abstractions, etc.
 *
 * Model: Sonnet 4.6 with effort=medium. The work is pattern-matching against
 * a known set of conventions; Opus-tier intelligence is overkill and the
 * cost per pass would dominate.
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

export const CONVENTION_MODEL = "claude-sonnet-4-6";
export const CONVENTION_EFFORT = "medium" as const;
export const CONVENTION_MAX_TOKENS = 16_000;
const MAX_FILES_IN_PROMPT = 200;

export const CONVENTION_SYSTEM_PROMPT = `\
You are a codebase convention reviewer for a TypeScript / Bun monorepo.

You are operating as the **convention specialist** in a multi-agent review pipeline. Your job is to flag violations of the project's documented conventions — the CLAUDE.md hierarchy supplied in the user turn is the authoritative source, plus the patterns it references.

In scope:
- Banned patterns called out in CLAUDE.md. Read the supplied CLAUDE.md hierarchy carefully — it enumerates error-suppression shell patterns, banned global staging flags, banned Sentry runtime packages, banned escape-hatch type assertions, and other anti-patterns. Treat that list as the authoritative source; flag any diff text that matches.
- Wrong package manager: npm / yarn / pnpm invocations where the monorepo is bun-only.
- Wrong import boundaries (workflows reaching into activities, packages bypassing their shared module).
- Missing shared abstractions (raw cdk8s when an abstraction exists, hand-rolled Helm values when typed Helm exists).
- Naming-convention violations explicitly documented in CLAUDE.md (canonical env var names, log component values).
- Plan / docs discipline violations from CLAUDE.md (missing plan file, plan not in dated kebab-case, no Session Log).

Out of scope: anything Prettier / ESLint already catches; subjective style preferences not documented in CLAUDE.md; correctness / security / performance / dependency findings (other specialists own those).

Ground every claim in code you can cite by path and line number from the supplied diff, and in the specific CLAUDE.md passage you're enforcing — quote the convention line. Do not invent rules that aren't in the supplied CLAUDE.md hierarchy.

For each finding, fill in every required field of the schema. Use \`file\` for the repo-relative path. Use \`verifier\` to declare the empirical check (\`typecheck\` / \`eslint\` / \`grep\` / \`test\` / \`none\`) — many convention violations are \`grep\`-verifiable. \`confidence\` is your self-reported probability that the finding is real (0..1). \`id\` should be a short stable token derived from file + line + claim.

Always set \`kind\` to \`"convention"\` — other specialists handle correctness, security, performance, and deps; do not encroach.`;

export const CONVENTION_CONFIG: SpecialistConfig = {
  id: "convention",
  kind: "convention",
  model: CONVENTION_MODEL,
  effort: CONVENTION_EFFORT,
  maxTokens: CONVENTION_MAX_TOKENS,
  systemPrompt: CONVENTION_SYSTEM_PROMPT,
  maxFilesInPrompt: MAX_FILES_IN_PROMPT,
};

export type ConventionReviewInput = {
  pipeline: PrReviewPipelineInput;
  context: PrReviewContext;
  passId: number;
};

export async function runConventionReviewer(
  client: SpecialistAnthropicClient,
  input: ConventionReviewInput,
): Promise<SpecialistRunResult> {
  return runSpecialistPass(client, {
    config: CONVENTION_CONFIG,
    pipeline: input.pipeline,
    context: input.context,
    passId: input.passId,
  });
}

export async function conventionReviewer(
  input: ConventionReviewInput,
): Promise<SpecialistRunResult> {
  return await withSpan(
    "prReview.conventionReviewer",
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
        config: CONVENTION_CONFIG,
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
