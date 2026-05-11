/**
 * Shared SDK call helper for the five Phase 3 specialists.
 *
 * Each specialist (correctness, security, perf, convention, deps) differs
 * only in (system prompt, model, effort, kind, max_tokens). The SDK call
 * shape, prompt-cache placement, user-text layout, token bookkeeping, and
 * error handling are identical across all of them — this file is that
 * shared core.
 *
 * The legacy single-call `correctness.ts` predates this helper and
 * deliberately stays self-contained for its parity test. New specialists go
 * through `runSpecialistPass` instead.
 */

import { Context } from "@temporalio/activity";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { JSONOutputFormat } from "@anthropic-ai/sdk/resources/messages";
import * as Sentry from "@sentry/bun";
import { z } from "zod/v4";
import {
  FindingSchema,
  type Finding,
  type FindingKind,
} from "#shared/pr-review/finding.ts";
import type { PrFileDiff, PrReviewContext } from "#shared/pr-review/context.ts";
import type { PrReviewPipelineInput } from "#shared/schemas.ts";
import { permuteFiles } from "#lib/diff-slicing.ts";

const COMPONENT = "pr-review-pipeline";

/**
 * Effort tier per the `claude-api` skill. Opus 4.7 + adaptive thinking
 * replaces the plan's deprecated `budget_tokens: 24000` — depth is
 * controlled here. The SDK at the current pinned version exposes
 * `"low" | "medium" | "high" | "max"`; swap in `"xhigh"` (added in 4.7) once
 * the SDK type catches up.
 */
export type SpecialistEffort = "low" | "medium" | "high" | "max";

/**
 * Static, per-PR-stable configuration for a single specialist. Lives outside
 * `SpecialistRequest` so callers can construct it once at module load and
 * reuse it across passes.
 */
export type SpecialistConfig = {
  /** Specialist identifier used as a metric label, span attribute, and PRNG seed. */
  readonly id: "correctness" | "security" | "perf" | "convention" | "deps";
  /** `FindingKind` this specialist is allowed to emit. Enforced by Zod refinement. */
  readonly kind: FindingKind;
  /** Pinned Anthropic model id. */
  readonly model: string;
  /** Effort tier (Opus 4.7 adaptive thinking depth). */
  readonly effort: SpecialistEffort;
  /** Output cap. Each specialist's findings array is small; 16k is generous. */
  readonly maxTokens: number;
  /** Frozen system prompt. Cached on every call via `cache_control: ephemeral`. */
  readonly systemPrompt: string;
  /** Maximum file count to include in the user turn (truncation tail dropped). */
  readonly maxFilesInPrompt: number;
};

/**
 * One pass of a specialist over a (possibly permuted) view of the diff.
 */
export type SpecialistRequest = {
  config: SpecialistConfig;
  pipeline: PrReviewPipelineInput;
  context: PrReviewContext;
  /** 0..N-1, where N = PASSES_PER_SPECIALIST. */
  passId: number;
};

/**
 * Specialist output shape. Wraps findings in an object because the API's
 * structured-outputs `json_schema` requires an object root.
 */
export type SpecialistOutput = {
  findings: Finding[];
};

export type SpecialistRunResult = {
  findings: Finding[];
  durationMs: number;
  costUsd: number | null;
  tokens: {
    input: number;
    output: number;
    cacheCreate: number;
    cacheRead: number;
  };
};

/**
 * Minimal client surface — same trick as `CorrectnessAnthropicClient`:
 * the SDK's `messages.parse` return type is generic on the schema, awkward
 * to mock, so we depend on a structural slice with the exact fields we
 * read off of it.
 */
export type SpecialistAnthropicClient = {
  messages: {
    parse: (params: {
      model: string;
      max_tokens: number;
      thinking: { type: "adaptive" };
      output_config: {
        effort: SpecialistEffort;
        format: JSONOutputFormat;
      };
      system: {
        type: "text";
        text: string;
        cache_control?: { type: "ephemeral" };
      }[];
      messages: { role: "user"; content: string }[];
    }) => Promise<{
      parsed_output: SpecialistOutput | null;
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
 * Build the user turn text for a specialist pass. Layout matches
 * `buildCorrectnessUserText` so prompt-cache prefixes hit identically across
 * specialists — the only volatile slice is the changed-files order, which
 * sits at the bottom of the user turn (after the breakpoint).
 *
 * The file list is permuted by `permuteFiles({ specialistId, passId })`;
 * pass 0 is the identity, so single-pass replay matches the canonical order.
 */
export function buildSpecialistUserText(request: SpecialistRequest): string {
  const { config, pipeline, context, passId } = request;
  const ordered = permuteFiles({
    files: context.changedFiles,
    specialistId: config.id,
    passId,
  });
  const filesIncluded = ordered.slice(0, config.maxFilesInPrompt);
  const filesDropped = ordered.length - filesIncluded.length;

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
  lines.push(`- Specialist pass: ${config.id} #${String(passId)}`);
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
    lines.push(...renderFileBlock(f));
  }
  return lines.join("\n");
}

function renderFileBlock(f: PrFileDiff): string[] {
  const out: string[] = [];
  out.push(
    `### \`${f.path}\` — ${f.status} (+${String(f.additions)} / -${String(f.deletions)})`,
  );
  out.push("");
  if (f.patch === null) {
    out.push(
      "_Patch unavailable (binary file or patch exceeds GitHub's limit). Treat as opaque._",
    );
  } else {
    out.push("```diff");
    out.push(f.patch);
    out.push("```");
  }
  out.push("");
  return out;
}

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
      activity: "specialistPass",
      ...fields,
    }),
  );
}

function captureWithContext(error: unknown, request: SpecialistRequest): void {
  Sentry.withScope((scope) => {
    const info = Context.current().info;
    scope.setTag("workflow", info.workflowType);
    scope.setTag("activity", info.activityType);
    scope.setTag("component", COMPONENT);
    scope.setTag("specialist", request.config.id);
    scope.setContext("specialistPass", {
      workflowId: info.workflowExecution.workflowId,
      runId: info.workflowExecution.runId,
      attempt: info.attempt,
      owner: request.pipeline.owner,
      repo: request.pipeline.repo,
      prNumber: request.pipeline.prNumber,
      specialist: request.config.id,
      passId: request.passId,
    });
    Sentry.captureException(error);
  });
}

/**
 * Output schema factory: every specialist's schema has the same shape but
 * adds a Zod refinement pinning `kind` to the specialist's own category.
 * This is the second layer of defense after the system prompt — even if
 * the model hallucinates a `kind: "security"` from the correctness
 * specialist, the schema rejects it.
 */
export function specialistOutputSchema(
  expectedKind: FindingKind,
): z.ZodType<SpecialistOutput> {
  return z.object({
    findings: z.array(
      FindingSchema.refine((f) => f.kind === expectedKind, {
        message: `Specialist may only emit kind="${expectedKind}"`,
      }),
    ),
  });
}

/**
 * Run one specialist pass. Pure with respect to the injected client.
 * Caller is expected to:
 *
 *   1. Persist `costUsd` into the `pr_review_cost_usd{model, specialist}`
 *      histogram and `durationMs` into `pr_review_specialist_latency_seconds`.
 *   2. Aggregate findings across (5 specialists × N passes) before passing
 *      to `consensusVote`.
 *
 * Errors propagate; the activity wrapper handles retry policy.
 */
export async function runSpecialistPass(
  client: SpecialistAnthropicClient,
  request: SpecialistRequest,
): Promise<SpecialistRunResult> {
  const startMs = Date.now();
  const userText = buildSpecialistUserText(request);
  const schema = specialistOutputSchema(request.config.kind);

  const response = await client.messages.parse({
    model: request.config.model,
    max_tokens: request.config.maxTokens,
    thinking: { type: "adaptive" },
    output_config: {
      effort: request.config.effort,
      format: zodOutputFormat(schema),
    },
    system: [
      {
        type: "text",
        text: request.config.systemPrompt,
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

  jsonLog("info", "specialistPass completed", {
    specialist: request.config.id,
    passId: request.passId,
    prNumber: request.pipeline.prNumber,
    findingsCount: findings.length,
    durationMs,
    costUsd,
    inputTokens: tokens.input,
    outputTokens: tokens.output,
    cacheReadTokens: tokens.cacheRead,
    cacheCreateTokens: tokens.cacheCreate,
  });

  return { findings, durationMs, costUsd, tokens };
}

/**
 * Adapter wrapping a real `Anthropic` SDK instance. Mirrors
 * `makeCorrectnessClient` in `correctness.ts`. The SDK's `messages.parse`
 * signature is generic on the schema; we narrow to the structural slice
 * we actually consume so call sites stay typed without `as unknown` casts.
 */
export function makeSpecialistClient(
  client: Anthropic,
): SpecialistAnthropicClient {
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
 * Build a real Anthropic-backed client, reading `ANTHROPIC_API_KEY` from
 * the environment. Throws if the key is missing — callers should treat this
 * as a deployment misconfiguration, not a per-PR failure.
 */
export function defaultSpecialistClient(): SpecialistAnthropicClient {
  const apiKey = Bun.env["ANTHROPIC_API_KEY"];
  if (apiKey === undefined || apiKey === "") {
    throw new Error("ANTHROPIC_API_KEY is required for specialist activities");
  }
  return makeSpecialistClient(new Anthropic({ apiKey }));
}

/**
 * Public Sentry-capture wrapper for specialist failures. Each specialist
 * activity wraps `runSpecialistPass` in this so per-pass exceptions land in
 * Bugsink/Sentry with full PR + specialist context.
 */
export function withSentryCapture(
  request: SpecialistRequest,
): (error: unknown) => void {
  return (error: unknown) => {
    captureWithContext(error, request);
  };
}
