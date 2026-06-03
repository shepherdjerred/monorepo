import Anthropic from "@anthropic-ai/sdk";
import { Octokit } from "@octokit/rest";
import { Context } from "@temporalio/activity";
import * as Sentry from "@sentry/bun";
import { traceAnthropic } from "@shepherdjerred/llm-observability";
import {
  prSummaryCommentsTotal,
  prSummaryCostUsd,
  prSummaryDurationSeconds,
  prSummaryTokensTotal,
} from "#observability/metrics.ts";
import { getTraceContext, withSpan } from "#observability/tracing.ts";
import { emitOtel } from "#observability/log.ts";
import type { PrSummaryInput } from "#shared/schemas.ts";
import {
  upsertSummaryComment,
  type OctokitForUpsert,
} from "#lib/pr-summary-comment.ts";
import { createGitHubAppInstallationToken } from "#lib/github-app-token.ts";
import { workflowExecutionContext } from "#activities/temporal-context.ts";
import {
  recordProviderIssue,
  resolveProviderIssue,
} from "#activities/pr-review/provider-metrics.ts";
import {
  SUMMARY_MARKER,
  buildSummarySystemBlocks,
  buildSummaryUserPrompt,
} from "./summary-prompts.ts";
import { renderOversizedSummary } from "./summary-oversized.ts";
import { estimateCostUsd } from "./summary-cost.ts";
import { fetchPrDiff, type OctokitForSummaryDiff } from "./summary-diff.ts";
import {
  loadRepoConventionsMarkdown,
  type OctokitForSummaryConventions,
} from "./summary-conventions.ts";

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
export type OctokitForSummary = OctokitForSummaryDiff &
  OctokitForSummaryConventions &
  OctokitForUpsert;

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
  summaryMode: "llm" | "oversized";
};

function jsonLog(
  level: "info" | "warning" | "error",
  message: string,
  fields: Record<string, unknown> = {},
): void {
  const flow = workflowFields();
  console.warn(
    JSON.stringify({
      level,
      msg: message,
      component: COMPONENT,
      ...flow,
      ...getTraceContext(),
      ...fields,
    }),
  );
  emitOtel(level, message, { module: COMPONENT, ...flow, ...fields });
}

function workflowFields(): Record<string, unknown> {
  // Defensive: if this is called from a context-less code path (replay
  // script, unit test driver) Context.current() throws. Fall back to an
  // empty fragment so logs still serialize.
  try {
    const info = Context.current().info;
    return {
      workflow: info.workflowType,
      ...workflowExecutionContext(info),
      activity: info.activityType,
      attempt: info.attempt,
    };
  } catch {
    return {};
  }
}

function classifyAnthropicProviderIssue(
  error: unknown,
): "credit_balance_low" | "rate_limit" | null {
  const message = error instanceof Error ? error.message : String(error);
  const lowerMessage = message.toLowerCase();
  if (lowerMessage.includes("credit balance is too low")) {
    return "credit_balance_low";
  }
  if (
    lowerMessage.includes("rate_limit_error") ||
    lowerMessage.includes("rate limit") ||
    lowerMessage.includes("429")
  ) {
    return "rate_limit";
  }
  return null;
}

function captureWithContext(
  error: unknown,
  pr: PrSummaryInput,
  extra: Record<string, unknown> = {},
): void {
  const providerIssueKind = classifyAnthropicProviderIssue(error);
  if (providerIssueKind !== null) {
    recordProviderIssue({
      app: "temporal",
      provider: "anthropic",
      kind: providerIssueKind,
      source: "pr_summary",
    });
    jsonLog("warning", "Anthropic provider issue recorded", {
      providerIssueKind,
      owner: pr.owner,
      repo: pr.repo,
      prNumber: pr.prNumber,
    });
    return;
  }

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

async function callHaiku(
  anthropic: AnthropicForSummary,
  systemBlocks: Anthropic.TextBlockParam[],
  userPrompt: string,
): Promise<{ text: string; usage: Anthropic.Usage }> {
  const messages = [{ role: "user", content: userPrompt }] as const;
  // Stream so we don't bump the SDK HTTP timeout if the model is slow.
  // We don't need per-token UX — `finalMessage()` collects the whole thing.
  const final = await traceAnthropic(
    {
      service: "temporal",
      callSite: "pr-summary",
      request: {
        model: SUMMARY_MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: systemBlocks,
        messages: [...messages],
      },
    },
    async () =>
      anthropic.messages
        .stream({
          model: SUMMARY_MODEL,
          max_tokens: MAX_OUTPUT_TOKENS,
          system: systemBlocks,
          messages: [...messages],
        })
        .finalMessage(),
  );

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

      const { diff, truncated, bytes, files, oversized } = await fetchPrDiff(
        deps.octokit,
        pr,
      );
      jsonLog("info", "Fetched PR diff", {
        diffBytes: bytes,
        truncated,
        changedFiles: files.length,
        oversized,
        prNumber: pr.prNumber,
      });
      span.setAttribute("pr.diff_bytes", bytes);
      span.setAttribute("pr.diff_truncated", truncated);
      span.setAttribute("pr.changed_files", files.length);
      span.setAttribute("pr.summary.oversized", oversized);

      if (oversized) {
        const body = renderOversizedSummary(pr, files);
        const upsert = await upsertSummaryComment({
          octokit: deps.octokit,
          owner: pr.owner,
          repo: pr.repo,
          prNumber: pr.prNumber,
          body,
          marker: SUMMARY_MARKER,
        });
        prSummaryCommentsTotal.inc({ action: upsert.action });
        const durationMs = deps.now() - startMs;
        prSummaryDurationSeconds.observe(
          { model: SUMMARY_MODEL, action: upsert.action },
          durationMs / 1000,
        );
        jsonLog("info", "Posted oversized PR summary", {
          action: upsert.action,
          commentId: upsert.commentId,
          htmlUrl: upsert.htmlUrl,
          durationMs,
          changedFiles: files.length,
          diffBytes: bytes,
        });
        return {
          action: upsert.action,
          commentId: upsert.commentId,
          htmlUrl: upsert.htmlUrl,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          costUsd: 0,
          durationMs,
          diffBytes: bytes,
          diffTruncated: true,
          summaryMode: "oversized",
        };
      }

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
      resolveProviderIssue({
        app: "temporal",
        provider: "anthropic",
        kind: "credit_balance_low",
        source: "pr_summary",
      });
      resolveProviderIssue({
        app: "temporal",
        provider: "anthropic",
        kind: "rate_limit",
        source: "pr_summary",
      });

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
        summaryMode: "llm",
      };
    },
  );
}

async function defaultLoadRepoConventionsMarkdown(
  octokit: OctokitForSummary,
  pr: PrSummaryInput,
): Promise<string> {
  return loadRepoConventionsMarkdown(octokit, pr, (message, fields) => {
    jsonLog("warning", message, fields);
  });
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
    listFiles: (params) =>
      octokit.paginate.iterator(octokit.rest.pulls.listFiles, {
        ...params,
        per_page: 100,
      }),
    getContent: (params) => octokit.rest.repos.getContent(params),
  };
}

export type PrSummaryActivities = typeof prSummaryActivities;

export const prSummaryActivities = {
  async runPrSummaryPipeline(pr: PrSummaryInput): Promise<RunSummaryResult> {
    const authToken = envOrThrow("CLAUDE_CODE_OAUTH_TOKEN");
    const tokenResult = await createGitHubAppInstallationToken();
    const githubToken = tokenResult.token;

    const anthropic = new Anthropic({ authToken });
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
