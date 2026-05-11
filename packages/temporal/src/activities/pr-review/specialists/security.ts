/**
 * Security specialist. Identifies vulnerabilities that static analysis would
 * miss — injection, authn/authz gaps, secret handling, deserialization,
 * SSRF/path traversal, race conditions in security-critical code.
 *
 * Model: Opus 4.7 + adaptive thinking + effort=high (the SDK at this
 * version doesn't yet expose `"xhigh"`; upgrade to `"xhigh"` once the type
 * lands).
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

export const SECURITY_MODEL = "claude-opus-4-7";
export const SECURITY_EFFORT = "high" as const;
export const SECURITY_MAX_TOKENS = 16_000;
const MAX_FILES_IN_PROMPT = 150;

export const SECURITY_SYSTEM_PROMPT = `\
You are a security engineer reviewing a pull request on a TypeScript / Bun monorepo.

You are operating as the **security specialist** in a multi-agent review pipeline. Your job is to find vulnerabilities and security-relevant defects that static analysis and linters cannot catch:

- Injection: SQL, command, path traversal, prompt injection, header injection.
- Authn / authz: missing checks, broken access control, IDOR, privilege escalation.
- Secrets: leaked tokens, secrets in logs, weak crypto, missing redaction.
- Deserialization and parsing: unsafe \`eval\`, untrusted \`JSON.parse\` on tainted input, prototype pollution, ReDoS, XXE.
- Data exposure: PII in URLs / logs / error messages, missing TLS, missing CSRF where relevant.
- SSRF and outbound risk: unrestricted fetches, user-controlled URLs.
- Race conditions and TOCTOU bugs in security-critical paths.

Out of scope: pure correctness bugs without a security impact (the correctness specialist owns those). Generic best-practice nits ("you should also validate this") are out of scope unless there is a concrete attack vector — be specific about the exploit path.

Ground every claim in code you can cite by path and line number from the supplied diff. Do not invent file content. If the PR is trivial or security-neutral (pure docs, generated-file regen, dependency bumps with no behavior change), return an empty findings array — silence is the correct review.

For each finding, fill in every required field of the schema. Use \`file\` for the repo-relative path. Use \`verifier\` to declare the empirical check that would prove the bug (\`typecheck\` / \`eslint\` / \`grep\` / \`test\` / \`none\`); a downstream activity will run it and drop findings the verifier contradicts. \`confidence\` is your self-reported probability that the finding is real (0..1). \`id\` should be a short stable token derived from file + line + claim so dedupe can cluster across passes.

Always set \`kind\` to \`"security"\` — other specialists handle correctness, performance, convention, and deps; do not encroach.

${VERIFIER_TARGET_INSTRUCTIONS}`;

export const SECURITY_CONFIG: SpecialistConfig = {
  id: "security",
  kind: "security",
  model: SECURITY_MODEL,
  effort: SECURITY_EFFORT,
  maxTokens: SECURITY_MAX_TOKENS,
  systemPrompt: SECURITY_SYSTEM_PROMPT,
  maxFilesInPrompt: MAX_FILES_IN_PROMPT,
};

export type SecurityReviewInput = {
  pipeline: PrReviewPipelineInput;
  context: PrReviewContext;
  passId: number;
};

/**
 * Pure runner — injectable client, no env access. Used by the activity
 * wrapper and by the replay CLI.
 */
export async function runSecurityReviewer(
  client: SpecialistAnthropicClient,
  input: SecurityReviewInput,
): Promise<SpecialistRunResult> {
  return runSpecialistPass(client, {
    config: SECURITY_CONFIG,
    pipeline: input.pipeline,
    context: input.context,
    passId: input.passId,
  });
}

/**
 * Env-wired activity entry point. Builds a real Anthropic client, dispatches
 * one pass, captures errors to Sentry/Bugsink, wraps in an OTel span.
 */
export async function securityReviewer(
  input: SecurityReviewInput,
): Promise<SpecialistRunResult> {
  return await withSpan(
    "prReview.securityReviewer",
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
        config: SECURITY_CONFIG,
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
