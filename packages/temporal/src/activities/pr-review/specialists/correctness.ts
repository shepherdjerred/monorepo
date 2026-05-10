import { Context } from "@temporalio/activity";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { JSONOutputFormat } from "@anthropic-ai/sdk/resources/messages";
import * as Sentry from "@sentry/bun";
import { z } from "zod/v4";
import { withSpan } from "#observability/tracing.ts";
import { FindingSchema, type Finding } from "#shared/pr-review/finding.ts";
import type { PrReviewContext } from "#shared/pr-review/context.ts";
import type { PrReviewPipelineInput } from "#shared/schemas.ts";

const COMPONENT = "pr-review-pipeline";

/**
 * Single-call model parameters for the correctness reviewer. Pinned model IDs
 * live here so the parity-baseline test can assert them verbatim.
 *
 * Per the `claude-api` skill:
 * - `claude-opus-4-7` is mandatory for SOTA review quality.
 * - `thinking: { type: "adaptive" }` is the only on-mode on Opus 4.7.
 * - `effort: "high"` is the minimum recommended for intelligence-sensitive
 *   work. (The SDK at this version doesn't yet expose `"xhigh"` — switch
 *   when @anthropic-ai/sdk ≥ 0.95.)
 */
export const CORRECTNESS_MODEL = "claude-opus-4-7";
export const CORRECTNESS_EFFORT: "low" | "medium" | "high" | "max" = "high";
export const CORRECTNESS_MAX_TOKENS = 16_000;

/**
 * Stable system prompt — cached in full. Keep this string frozen so the
 * prompt-cache prefix stays valid across every PR. Any per-PR content goes
 * in the user turn.
 *
 * The legacy `pr-prompts.ts` `SHARED_PREAMBLE` + `buildReviewPrompt` body
 * informed this prompt — same review philosophy (substantive bugs only,
 * cite paths, skip lint nits), adapted to the SDK transport where the model
 * can't fetch via MCP and instead receives the diff + CLAUDE.md hierarchy
 * inline in the user turn.
 *
 * Semantic parity, not byte-for-byte parity: the gh/MCP-fetching clauses
 * make no sense without those tools, so they're replaced with the structured
 * output contract.
 */
export const CORRECTNESS_SYSTEM_PROMPT = `\
You are a senior staff engineer reviewing a pull request on a TypeScript / Bun monorepo.

You are operating as the **correctness specialist** in a multi-agent review pipeline. Your job is to find substantive correctness issues that linters and typecheckers can't catch:

- Functionality: Does the code actually do what the PR claims?
- Architectural fit: Does this change fit the codebase patterns? (Use the supplied CLAUDE.md hierarchy as the authority on conventions.)
- Logic errors: Bugs, race conditions, edge cases.
- Security: Vulnerabilities that static analysis would miss.
- Design: Is this the right approach? Are there simpler alternatives?

Skip stylistic nits, opinion-based naming, and anything Prettier/ESLint would catch.

Ground every claim in code you can cite by path and line number from the supplied diff. Do not invent file content. Do not hand-wave. If the PR is trivial (pure merge/rebase, generated-file regen, version bump with no behavior change), return an empty findings array — silence is the correct review.

For each finding, fill in every required field of the schema. Use the \`file\` field for the repo-relative path. Use the \`verifier\` field to declare which empirical check would prove the bug (\`typecheck\` / \`eslint\` / \`grep\` / \`test\` / \`none\`); a downstream activity will run that verifier and drop findings the verifier contradicts. \`confidence\` is your self-reported probability that the finding is real (0..1). \`id\` should be a short stable token derived from file + line + claim (e.g. a hash prefix) so dedupe can cluster across passes.

Always set \`kind\` to \`"correctness"\` — other specialists handle security, performance, convention, and deps; do not encroach.`;

/**
 * Hard cap on the number of file diffs we feed the model in a single request.
 * Past ~150 files the context window strain dominates marginal review quality;
 * Phase 5/6 will replace this with structure-aware chunking + retrieval. For
 * now we drop the tail with an explicit log so reviewers know the PR was
 * truncated.
 */
const MAX_FILES_IN_PROMPT = 150;

/**
 * Schema for the structured-outputs response. The model returns an object
 * carrying `findings: Finding[]` — wrapping the array satisfies the
 * structured-outputs requirement that the root be a JSON object.
 */
export const CorrectnessOutputSchema = z.object({
  findings: z.array(FindingSchema),
});
export type CorrectnessOutput = z.infer<typeof CorrectnessOutputSchema>;

export type CorrectnessReviewInput = {
  pipeline: PrReviewPipelineInput;
  context: PrReviewContext;
};

export type CorrectnessReviewResult = {
  findings: Finding[];
  /** Wall-clock duration of the API call. */
  durationMs: number;
  /** Total cost in USD reported by the API (when available). */
  costUsd: number | null;
  /** Tokens used, broken out by direction. */
  tokens: {
    input: number;
    output: number;
    cacheCreate: number;
    cacheRead: number;
  };
};

function jsonLog(
  level: "info" | "warning" | "error",
  message: string,
  fields: Record<string, unknown> = {},
): void {
  console.warn(
    JSON.stringify({
      level,
      msg: message,
      component: COMPONENT,
      activity: "correctnessReviewer",
      ...fields,
    }),
  );
}

function captureWithContext(
  error: unknown,
  input: CorrectnessReviewInput,
  extra: Record<string, unknown> = {},
): void {
  Sentry.withScope((scope) => {
    const info = Context.current().info;
    scope.setTag("workflow", info.workflowType);
    scope.setTag("activity", info.activityType);
    scope.setTag("component", COMPONENT);
    scope.setContext("correctnessReviewer", {
      workflowId: info.workflowExecution.workflowId,
      runId: info.workflowExecution.runId,
      attempt: info.attempt,
      owner: input.pipeline.owner,
      repo: input.pipeline.repo,
      prNumber: input.pipeline.prNumber,
      ...extra,
    });
    Sentry.captureException(error);
  });
}

/**
 * Build the user-turn text for the correctness reviewer. Pure function so the
 * parity test can call it directly with a fixture.
 *
 * Layout (top-down, most stable first to maximize cache reads):
 *   - PR metadata header
 *   - CLAUDE.md hierarchy (per-package conventions)
 *   - Diff body, one fenced block per file
 */
export function buildCorrectnessUserText(
  input: CorrectnessReviewInput,
): string {
  const { pipeline, context } = input;
  const filesIncluded = context.changedFiles.slice(0, MAX_FILES_IN_PROMPT);
  const filesDropped = context.changedFiles.length - filesIncluded.length;

  const lines: string[] = [];
  lines.push(
    `# Pull request ${pipeline.owner}/${pipeline.repo}#${String(pipeline.prNumber)}`,
  );
  lines.push("");
  lines.push(`- Title: ${pipeline.prTitle}`);
  lines.push(`- Base ref: \`${pipeline.baseRef}\``);
  lines.push(`- Head ref: \`${pipeline.headRef}\``);
  lines.push(`- Commit: \`${pipeline.commitSha}\``);
  lines.push(`- Author: ${pipeline.prAuthor}`);
  lines.push("");

  if (context.claudeMdHierarchy.length > 0) {
    lines.push("## CLAUDE.md hierarchy (project + package conventions)");
    lines.push("");
    for (const md of context.claudeMdHierarchy) {
      lines.push(`### \`${md.path}\``);
      lines.push("");
      lines.push("```markdown");
      lines.push(md.content);
      lines.push("```");
      lines.push("");
    }
  }

  lines.push("## Changed files");
  lines.push("");
  if (filesDropped > 0) {
    lines.push(
      `> Note: showing the first ${String(filesIncluded.length)} files. ${String(filesDropped)} additional files were truncated to fit the context budget; treat the missing files as "no review possible" rather than "clean".`,
    );
    lines.push("");
  }

  for (const f of filesIncluded) {
    lines.push(
      `### \`${f.path}\` — ${f.status} (+${String(f.additions)} / -${String(f.deletions)})`,
    );
    lines.push("");
    if (f.patch === null) {
      lines.push(
        "_Patch unavailable (binary file or patch exceeds GitHub's limit). Treat as opaque._",
      );
    } else {
      lines.push("```diff");
      lines.push(f.patch);
      lines.push("```");
    }
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * Minimal Anthropic client surface the activity uses. Tests supply a fake.
 * The real `client.messages.parse` signature is conditional on a generic
 * inferred from `output_config.format`, which is awkward to mock; the slice
 * below captures only the call shape we depend on.
 */
export type CorrectnessAnthropicClient = {
  messages: {
    parse: (params: {
      model: string;
      max_tokens: number;
      thinking: { type: "adaptive" };
      output_config: {
        effort: "low" | "medium" | "high" | "max";
        format: JSONOutputFormat;
      };
      system: {
        type: "text";
        text: string;
        cache_control?: { type: "ephemeral" };
      }[];
      messages: { role: "user"; content: string }[];
    }) => Promise<{
      parsed_output: CorrectnessOutput | null;
      usage: {
        input_tokens: number;
        output_tokens: number;
        cache_creation_input_tokens: number | null;
        cache_read_input_tokens: number | null;
      };
      cost_usd?: number | null;
    }>;
  };
};

/**
 * Pure runner — takes an injected client + the bootstrap-built context, returns
 * findings. Used directly by both the Temporal activity and the replay CLI.
 */
export async function runCorrectnessReviewer(
  client: CorrectnessAnthropicClient,
  input: CorrectnessReviewInput,
): Promise<CorrectnessReviewResult> {
  const startMs = Date.now();

  const userText = buildCorrectnessUserText(input);

  const response = await client.messages.parse({
    model: CORRECTNESS_MODEL,
    max_tokens: CORRECTNESS_MAX_TOKENS,
    thinking: { type: "adaptive" },
    output_config: {
      effort: CORRECTNESS_EFFORT,
      format: zodOutputFormat(CorrectnessOutputSchema),
    },
    system: [
      {
        type: "text",
        text: CORRECTNESS_SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: userText }],
  });

  const durationMs = Date.now() - startMs;
  const findings = response.parsed_output?.findings ?? [];
  const costUsd = response.cost_usd ?? null;
  const tokens = {
    input: response.usage.input_tokens,
    output: response.usage.output_tokens,
    cacheCreate: response.usage.cache_creation_input_tokens ?? 0,
    cacheRead: response.usage.cache_read_input_tokens ?? 0,
  };

  jsonLog("info", "correctnessReviewer completed", {
    prNumber: input.pipeline.prNumber,
    commitSha: input.pipeline.commitSha,
    findingsCount: findings.length,
    durationMs,
    costUsd,
    inputTokens: tokens.input,
    outputTokens: tokens.output,
    cacheReadTokens: tokens.cacheRead,
    cacheCreateTokens: tokens.cacheCreate,
  });

  return {
    findings,
    durationMs,
    costUsd,
    tokens,
  };
}

/**
 * Adapter wrapping a real `Anthropic` instance into the minimal
 * `CorrectnessAnthropicClient` slice the activity depends on. The cast
 * happens inside the SDK's typed boundary — `client.messages.parse` returns
 * a generic shape the helper rules can't typecheck against our wrapped
 * interface, so we pull just the parsed_output / usage / cost_usd fields
 * we actually consume.
 */
export function makeCorrectnessClient(
  client: Anthropic,
): CorrectnessAnthropicClient {
  return {
    messages: {
      parse: async (params) => {
        const response = await client.messages.parse(params);
        return {
          parsed_output: response.parsed_output,
          usage: {
            input_tokens: response.usage.input_tokens,
            output_tokens: response.usage.output_tokens,
            cache_creation_input_tokens:
              response.usage.cache_creation_input_tokens,
            cache_read_input_tokens: response.usage.cache_read_input_tokens,
          },
        };
      },
    },
  };
}

/**
 * In-process entry point for the correctness reviewer. Reads `ANTHROPIC_API_KEY`
 * from the environment, builds a real client, and dispatches through
 * `runCorrectnessReviewer`. Used by `runSpecialists` (single-call Phase 2
 * baseline) and by the `replay-pr-review.ts` CLI.
 *
 * Wrapped in `withSpan` so OTel sees one `prReview.correctnessReviewer` span
 * per call, with span attributes for PR coordinates and context size.
 */
export async function correctnessReviewer(
  input: CorrectnessReviewInput,
): Promise<CorrectnessReviewResult> {
  return await withSpan(
    "prReview.correctnessReviewer",
    {
      "pr.owner": input.pipeline.owner,
      "pr.repo": input.pipeline.repo,
      "pr.number": input.pipeline.prNumber,
      "changedFiles.count": input.context.changedFiles.length,
      "claudeMd.count": input.context.claudeMdHierarchy.length,
    },
    async () => {
      const apiKey = Bun.env["ANTHROPIC_API_KEY"];
      if (apiKey === undefined || apiKey === "") {
        throw new Error(
          "ANTHROPIC_API_KEY is required for the correctness reviewer",
        );
      }
      const client = makeCorrectnessClient(new Anthropic({ apiKey }));
      try {
        return await runCorrectnessReviewer(client, input);
      } catch (error: unknown) {
        captureWithContext(error, input);
        jsonLog("error", "correctnessReviewer failed", {
          prNumber: input.pipeline.prNumber,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
  );
}
