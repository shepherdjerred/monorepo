import Anthropic from "@anthropic-ai/sdk";
import { Octokit } from "@octokit/rest";
import { Context } from "@temporalio/activity";
import * as Sentry from "@sentry/bun";
import { z } from "zod/v4";
import {
  prSummaryCommentsTotal,
  prSummaryCostUsd,
  prSummaryDurationSeconds,
  prSummaryTokensTotal,
} from "#observability/metrics.ts";
import { getTraceContext, withSpan } from "#observability/tracing.ts";
import type { PrSummaryInput } from "#shared/schemas.ts";
import {
  upsertSummaryComment,
  type OctokitForUpsert,
} from "#lib/pr-summary-comment.ts";
import {
  SUMMARY_MARKER,
  buildSummarySystemBlocks,
  buildSummaryUserPrompt,
} from "./summary-prompts.ts";

/**
 * Schema for the subset of GitHub's repos.getContent response we use.
 * The endpoint can return file | dir | symlink | submodule shapes; only
 * `type === "file"` carries the base64 `content` field we want.
 */
const RepoContentFileSchema = z.object({
  type: z.literal("file"),
  content: z.string(),
});

/**
 * Narrow Anthropic SDK surface used by this activity — just the one path
 * we exercise: `messages.stream(...).finalMessage()`. Lets tests pass a
 * plain object stub instead of synthesizing a real Anthropic class
 * instance (which has private fields and resists structural assignment).
 *
 * The real `Anthropic` class from `@anthropic-ai/sdk` is structurally
 * compatible with this type for the single method path in question, so
 * production code passes `new Anthropic(...)` directly with no adapter.
 */
export type AnthropicForSummary = {
  messages: {
    stream: (params: {
      model: string;
      max_tokens: number;
      system: Anthropic.TextBlockParam[];
      messages: { role: "user"; content: string }[];
    }) => {
      finalMessage: () => Promise<Anthropic.Message>;
    };
  };
};

/**
 * Narrow Octokit surface used by this activity. Defined structurally as
 * pure async functions so tests can pass plain mocks without crossing
 * Octokit's branded endpoint method types via `as` assertions. The
 * `adaptOctokit` helper at the bottom of this module wraps a real Octokit
 * into this shape.
 */
export type OctokitForSummary = {
  getDiff: (params: {
    owner: string;
    repo: string;
    pull_number: number;
  }) => Promise<{ data: unknown }>;
  getContent: (params: {
    owner: string;
    repo: string;
    path: string;
    ref: string;
  }) => Promise<{ data: unknown }>;
} & OctokitForUpsert;

const COMPONENT = "pr-summary";

/**
 * Haiku 4.5. Pinned to the dated alias so a silent server-side default shift
 * can't tank our cost / latency targets without us noticing.
 */
const SUMMARY_MODEL = "claude-haiku-4-5";

/**
 * Output cap. Haiku is faster than Sonnet here, but we still need streaming
 * for any meaningful summary — see claude-api skill, the SDK HTTP timeout
 * starts to bite around 16k. We cap at 2k since the prompt enforces ~250
 * words; this gives the model headroom without enabling rambles.
 */
const MAX_OUTPUT_TOKENS = 2048;

/** Maximum diff size we'll embed in the user prompt before we truncate. */
const MAX_DIFF_BYTES = 200_000;

const HEARTBEAT_INTERVAL_MS = 10_000;

type SummaryDeps = {
  anthropic: AnthropicForSummary;
  octokit: OctokitForSummary;
  loadRepoConventionsMarkdown: (input: PrSummaryInput) => Promise<string>;
  now: () => number;
};

export type RunSummaryResult = {
  action: "created" | "updated";
  commentId: number;
  htmlUrl: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  costUsd: number;
  durationMs: number;
  diffBytes: number;
  diffTruncated: boolean;
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
      ...workflowFields(),
      ...getTraceContext(),
      ...fields,
    }),
  );
}

function workflowFields(): Record<string, unknown> {
  // Defensive: if this is called from a context-less code path (replay
  // script, unit test driver) Context.current() throws. Fall back to an
  // empty fragment so logs still serialize.
  try {
    const info = Context.current().info;
    return {
      workflow: info.workflowType,
      workflowId: info.workflowExecution.workflowId,
      runId: info.workflowExecution.runId,
      activity: info.activityType,
      attempt: info.attempt,
    };
  } catch {
    return {};
  }
}

function captureWithContext(
  error: unknown,
  pr: PrSummaryInput,
  extra: Record<string, unknown> = {},
): void {
  Sentry.withScope((scope) => {
    scope.setTag("component", COMPONENT);
    scope.setTag("repo", `${pr.owner}/${pr.repo}`);
    scope.setContext("pr-summary", {
      owner: pr.owner,
      repo: pr.repo,
      prNumber: pr.prNumber,
      commitSha: pr.commitSha,
      ...extra,
    });
    Sentry.captureException(error);
  });
}

/**
 * Per-token prices for Haiku 4.5 in USD per million tokens. Cache reads bill
 * at ~0.1× input, cache writes (ephemeral / 5-min TTL) at ~1.25× input. We
 * keep the constants colocated with the activity so price changes are easy
 * to spot in code review — pricing drift is one of the few things that can
 * silently blow the $0.10/summary budget.
 */
const HAIKU_PRICING = {
  inputPerMillionUsd: 1,
  outputPerMillionUsd: 5,
  cacheReadPerMillionUsd: 0.1,
  cacheWritePerMillionUsd: 1.25,
} as const;

function estimateCostUsd(usage: Anthropic.Usage): number {
  const inputTokens = usage.input_tokens;
  const outputTokens = usage.output_tokens;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;

  return (
    (inputTokens * HAIKU_PRICING.inputPerMillionUsd) / 1_000_000 +
    (outputTokens * HAIKU_PRICING.outputPerMillionUsd) / 1_000_000 +
    (cacheRead * HAIKU_PRICING.cacheReadPerMillionUsd) / 1_000_000 +
    (cacheWrite * HAIKU_PRICING.cacheWritePerMillionUsd) / 1_000_000
  );
}

async function fetchPrDiff(
  octokit: OctokitForSummary,
  pr: PrSummaryInput,
): Promise<{ diff: string; truncated: boolean; bytes: number }> {
  // The adapter passes `mediaType: { format: "diff" }` to Octokit on our
  // behalf so the API returns a raw unified-diff string. We narrow the
  // returned body with a typeof check.
  const response = await octokit.getDiff({
    owner: pr.owner,
    repo: pr.repo,
    pull_number: pr.prNumber,
  });

  const body: unknown = response.data;
  if (typeof body !== "string") {
    throw new TypeError(
      `Expected diff string from GitHub but got ${typeof body} for ${pr.owner}/${pr.repo}#${String(pr.prNumber)}`,
    );
  }

  const bytes = Buffer.byteLength(body, "utf8");
  if (bytes <= MAX_DIFF_BYTES) {
    return { diff: body, truncated: false, bytes };
  }

  const truncated = `${body.slice(0, MAX_DIFF_BYTES)}\n\n[diff truncated at ${String(MAX_DIFF_BYTES)} bytes; original was ${String(bytes)} bytes]\n`;
  return { diff: truncated, truncated: true, bytes };
}

async function callHaiku(
  anthropic: AnthropicForSummary,
  systemBlocks: Anthropic.TextBlockParam[],
  userPrompt: string,
): Promise<{ text: string; usage: Anthropic.Usage }> {
  // Stream so we don't bump the SDK HTTP timeout if the model is slow.
  // We don't need per-token UX — `finalMessage()` collects the whole thing.
  const stream = anthropic.messages.stream({
    model: SUMMARY_MODEL,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: systemBlocks,
    messages: [{ role: "user", content: userPrompt }],
  });

  const final = await stream.finalMessage();

  let text = "";
  for (const block of final.content) {
    if (block.type === "text") text += block.text;
  }
  if (text.length === 0) {
    throw new Error(
      `Haiku returned no text content (stop_reason=${final.stop_reason ?? "unknown"})`,
    );
  }

  return { text, usage: final.usage };
}

function envOrThrow(name: string): string {
  const v = Bun.env[name];
  if (v === undefined || v === "") {
    throw new Error(`${name} environment variable is required`);
  }
  return v;
}

/**
 * Pure implementation — caller injects Anthropic, Octokit, repo-conventions
 * loader, and a clock. Production wraps this with real clients; tests mock
 * them. Heartbeats are driven by the surrounding Temporal activity, not by
 * this function, so the same code path runs under the replay script.
 */
export async function runPrSummary(
  pr: PrSummaryInput,
  deps: SummaryDeps,
): Promise<RunSummaryResult> {
  return withSpan(
    "pr-summary.run",
    {
      "pr.owner": pr.owner,
      "pr.repo": pr.repo,
      "pr.number": pr.prNumber,
      "pr.commit": pr.commitSha,
      "pr.model": SUMMARY_MODEL,
    },
    async (span) => {
      const startMs = deps.now();

      const { diff, truncated, bytes } = await fetchPrDiff(deps.octokit, pr);
      jsonLog("info", "Fetched PR diff", {
        diffBytes: bytes,
        truncated,
        prNumber: pr.prNumber,
      });
      span.setAttribute("pr.diff_bytes", bytes);
      span.setAttribute("pr.diff_truncated", truncated);

      const conventionsMarkdown = await deps.loadRepoConventionsMarkdown(pr);
      const systemBlocks = buildSummarySystemBlocks({
        repoConventionsMarkdown: conventionsMarkdown,
      });
      const userPrompt = buildSummaryUserPrompt({ pr, diff });

      const { text, usage } = await callHaiku(
        deps.anthropic,
        systemBlocks,
        userPrompt,
      );

      const costUsd = estimateCostUsd(usage);

      prSummaryTokensTotal.inc(
        { model: SUMMARY_MODEL, direction: "input" },
        usage.input_tokens,
      );
      prSummaryTokensTotal.inc(
        { model: SUMMARY_MODEL, direction: "output" },
        usage.output_tokens,
      );
      const cacheRead = usage.cache_read_input_tokens ?? 0;
      const cacheCreate = usage.cache_creation_input_tokens ?? 0;
      if (cacheRead > 0) {
        prSummaryTokensTotal.inc(
          { model: SUMMARY_MODEL, direction: "cache_read" },
          cacheRead,
        );
      }
      if (cacheCreate > 0) {
        prSummaryTokensTotal.inc(
          { model: SUMMARY_MODEL, direction: "cache_create" },
          cacheCreate,
        );
      }
      prSummaryCostUsd.observe({ model: SUMMARY_MODEL }, costUsd);
      span.setAttribute("pr.summary.cost_usd", costUsd);
      span.setAttribute("pr.summary.input_tokens", usage.input_tokens);
      span.setAttribute("pr.summary.output_tokens", usage.output_tokens);
      span.setAttribute(
        "pr.summary.cache_read_tokens",
        usage.cache_read_input_tokens ?? 0,
      );

      const upsert = await upsertSummaryComment({
        octokit: deps.octokit,
        owner: pr.owner,
        repo: pr.repo,
        prNumber: pr.prNumber,
        body: text,
        marker: SUMMARY_MARKER,
      });

      prSummaryCommentsTotal.inc({ action: upsert.action });
      const durationMs = deps.now() - startMs;
      prSummaryDurationSeconds.observe(
        { model: SUMMARY_MODEL, action: upsert.action },
        durationMs / 1000,
      );

      jsonLog("info", "Posted PR summary", {
        action: upsert.action,
        commentId: upsert.commentId,
        htmlUrl: upsert.htmlUrl,
        durationMs,
        costUsd,
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
        cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
      });

      return {
        action: upsert.action,
        commentId: upsert.commentId,
        htmlUrl: upsert.htmlUrl,
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
        cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
        costUsd,
        durationMs,
        diffBytes: bytes,
        diffTruncated: truncated,
      };
    },
  );
}

/**
 * Default CLAUDE.md / AGENTS.md loader. Reads the root CLAUDE.md of the
 * repo via the GitHub contents API at the PR's head commit. Falls back to
 * an empty string if the file isn't present — the prompt is still useful
 * without it, just slightly less repo-aware.
 *
 * We deliberately do NOT read these files from disk on the worker — the
 * worker's local checkout (if any) is a different repo than the one being
 * reviewed. The contents API at the head SHA gives us the exact convention
 * doc the PR author was working against.
 */
async function defaultLoadRepoConventionsMarkdown(
  octokit: OctokitForSummary,
  pr: PrSummaryInput,
): Promise<string> {
  try {
    const response = await octokit.getContent({
      owner: pr.owner,
      repo: pr.repo,
      path: "CLAUDE.md",
      ref: pr.commitSha,
    });
    const parsed = RepoContentFileSchema.safeParse(response.data);
    if (!parsed.success) {
      // Not a regular file (could be dir/symlink/submodule) or shape we
      // don't recognize. Bot still runs without repo context.
      return "";
    }
    // GitHub returns base64 with line wraps. Buffer.from handles both.
    return Buffer.from(parsed.data.content, "base64").toString("utf8");
  } catch (error: unknown) {
    // 404 is expected for repos that don't use CLAUDE.md; anything else is
    // worth logging but not failing the summary over.
    jsonLog("warning", "Failed to load CLAUDE.md from PR head", {
      error: error instanceof Error ? error.message : String(error),
      prNumber: pr.prNumber,
    });
    return "";
  }
}

/**
 * Adapt a real Octokit instance to the narrow `OctokitForSummary` surface
 * `runPrSummary` expects. Each endpoint is wrapped in a pure async function
 * so the resulting shape matches the structural interface exactly — no
 * Octokit endpoint branding to fight, no `as` assertions to bridge.
 */
export function adaptOctokit(octokit: Octokit): OctokitForSummary {
  return {
    listComments: (params) => octokit.rest.issues.listComments(params),
    createComment: (params) => octokit.rest.issues.createComment(params),
    updateComment: (params) => octokit.rest.issues.updateComment(params),
    paginateListComments: (params) =>
      octokit.paginate.iterator(octokit.rest.issues.listComments, params),
    getDiff: (params) =>
      octokit.rest.pulls.get({
        ...params,
        mediaType: { format: "diff" },
      }),
    getContent: (params) => octokit.rest.repos.getContent(params),
  };
}

export type PrSummaryActivities = typeof prSummaryActivities;

export const prSummaryActivities = {
  async runPrSummaryWorkflow(pr: PrSummaryInput): Promise<RunSummaryResult> {
    const anthropicKey = envOrThrow("ANTHROPIC_API_KEY");
    const githubToken = envOrThrow("GITHUB_PERSONAL_ACCESS_TOKEN");

    const anthropic = new Anthropic({ apiKey: anthropicKey });
    const octokit = new Octokit({ auth: githubToken });
    const adapter = adaptOctokit(octokit);

    const heartbeat = setInterval(() => {
      try {
        Context.current().heartbeat({
          prNumber: pr.prNumber,
          commitSha: pr.commitSha,
        });
      } catch {
        // outside activity context — ignore
      }
    }, HEARTBEAT_INTERVAL_MS);

    try {
      return await runPrSummary(pr, {
        anthropic,
        octokit: adapter,
        loadRepoConventionsMarkdown: (input) =>
          defaultLoadRepoConventionsMarkdown(adapter, input),
        now: () => Date.now(),
      });
    } catch (error: unknown) {
      captureWithContext(error, pr);
      throw error;
    } finally {
      clearInterval(heartbeat);
    }
  },
};
