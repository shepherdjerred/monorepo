/**
 * Reaction-listener activity for the pr-review-bot dismissed-comments
 * learning loop (Phase 9 of packages/docs/plans/2026-05-10_sota-pr-review-bot.md).
 *
 * Two dismissal signals merged into the same Redis store:
 *
 *   1. Thumbs-down (👎) reactions on bot-authored PR review comments.
 *      Weight 1.0 (explicit dismissal).
 *
 *   2. Resolved-without-followup-commit-within-24h: a PR is closed/merged
 *      ≥24h after the bot's comment AND no commit between the comment's
 *      sha and HEAD touched the file the bot flagged. Weight 0.5 (soft
 *      dismissal — two of these dismiss together with cumulative weight
 *      ≥ 1.0 in the dedupe activity).
 *
 * The activity is idempotent on its full window (we LRANGE the key first
 * and skip entries whose hash already appears). The reaction-listener
 * workflow drives it on a 15-minute schedule.
 *
 * Pass-level helpers live in `lib/pr-review/reaction-listener-helpers.ts`.
 */
import { Context } from "@temporalio/activity";
import { Octokit } from "octokit";
import { createHash } from "node:crypto";
import { withSpan } from "#observability/tracing.ts";
import { type EmbedDeps } from "#lib/pr-review/embedding.ts";
import { type RedisSend } from "#lib/pr-review/dismissed-store.ts";
import {
  prReviewDedupeRedisErrorTotal,
  prReviewReactionPollErrorTotal,
} from "#observability/pr-review-metrics.ts";
import {
  runThumbsDownPass,
  type Counters,
  type IngestOctokit,
  type PassContext,
} from "#lib/pr-review/reaction-listener-helpers.ts";
import { runResolvedWithoutFollowupPass } from "#lib/pr-review/reaction-listener-resolved.ts";
import { getRedis } from "./dedupe.ts";

const COMPONENT = "pr-review-pipeline";
const DEFAULT_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days
const DEFAULT_WINDOW_HOURS = 48;

function defaultHeartbeat(note: string): void {
  Context.current().heartbeat({ phase: `ingest-dismissals:${note}` });
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
      activity: "ingestDismissals",
      ...fields,
    }),
  );
}

export type IngestDismissalsInput = {
  /** ISO 8601; the upper bound is "now". */
  readonly since: string;
  /** Optional override for the heuristic window. Defaults to 48h. */
  readonly windowHours?: number;
};

export type IngestDismissalsResult = {
  /** Cursor for the next poll — workflow stores and re-sends as `since`. */
  readonly maxObservedAt: string;
  readonly thumbsDownIngested: number;
  readonly resolvedWithoutFollowupIngested: number;
  readonly skippedDuplicates: number;
  readonly erroredFindings: number;
};

/**
 * Compute the SHA-256 hash that uniquely identifies a finding for dedupe
 * keying. Mirrors the finding-id derivation rule from the post activity.
 */
export function computeFindingHash(
  file: string,
  kind: string,
  normalizedClaim: string,
): string {
  return createHash("sha256")
    .update(`${file}${kind}${normalizedClaim}`)
    .digest("hex");
}

export type IngestDeps = {
  readonly octokit?: IngestOctokit;
  readonly redis?: RedisSend | null;
  readonly embed?: EmbedDeps;
  readonly now?: () => Date;
  readonly ttlSeconds?: number;
  readonly botLogin?: string;
  /** Heartbeat hook; defaults to Temporal Activity Context. Tests stub this. */
  readonly heartbeat?: (note: string) => void;
};

/**
 * Pure implementation for unit testing — accepts injected Octokit and
 * Redis dependencies, no Temporal context.
 */
export async function ingestDismissalsImpl(
  owner: string,
  repo: string,
  input: IngestDismissalsInput,
  deps: IngestDeps,
): Promise<IngestDismissalsResult> {
  const now = (deps.now ?? (() => new Date()))();
  const heartbeat = deps.heartbeat ?? defaultHeartbeat;
  const since = new Date(input.since);
  const windowHours = input.windowHours ?? DEFAULT_WINDOW_HOURS;
  const windowStart = new Date(now.getTime() - windowHours * 60 * 60 * 1000);
  // Lower bound: max(`since`, now-window). Never re-scan a duplicate window.
  const lowerBound =
    since.getTime() > windowStart.getTime() ? since : windowStart;
  const botLogin = deps.botLogin ?? "pr-review-bot";
  const ttlSeconds = deps.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const embed = deps.embed ?? {};

  const redis = deps.redis === undefined ? getRedis() : deps.redis;
  if (redis === null) {
    prReviewDedupeRedisErrorTotal.inc({ stage: "connect" });
    jsonLog("warning", "REDIS_URL unset; skipping ingest", {
      lowerBound: lowerBound.toISOString(),
    });
    return {
      maxObservedAt: now.toISOString(),
      thumbsDownIngested: 0,
      resolvedWithoutFollowupIngested: 0,
      skippedDuplicates: 0,
      erroredFindings: 0,
    };
  }
  if (deps.octokit === undefined) {
    prReviewReactionPollErrorTotal.inc({ stage: "github" });
    jsonLog("error", "octokit not injected and no env auth available", {});
    return {
      maxObservedAt: now.toISOString(),
      thumbsDownIngested: 0,
      resolvedWithoutFollowupIngested: 0,
      skippedDuplicates: 0,
      erroredFindings: 0,
    };
  }

  const ctx: PassContext = {
    owner,
    repo,
    octokit: deps.octokit,
    redis,
    embed,
    now,
    lowerBound,
    botLogin,
    ttlSeconds,
    heartbeat,
  };
  const counters: Counters = {
    thumbsDownIngested: 0,
    resolvedIngested: 0,
    skipped: 0,
    errored: 0,
    maxObserved: lowerBound,
  };

  await runThumbsDownPass(ctx, counters);
  await runResolvedWithoutFollowupPass(ctx, counters);

  jsonLog("info", "ingestDismissals completed", {
    owner,
    repo,
    thumbsDownIngested: counters.thumbsDownIngested,
    resolvedIngested: counters.resolvedIngested,
    skipped: counters.skipped,
    errored: counters.errored,
    maxObservedAt: counters.maxObserved.toISOString(),
  });

  return {
    maxObservedAt: counters.maxObserved.toISOString(),
    thumbsDownIngested: counters.thumbsDownIngested,
    resolvedWithoutFollowupIngested: counters.resolvedIngested,
    skippedDuplicates: counters.skipped,
    erroredFindings: counters.errored,
  };
}

export type IngestDismissalsActivities = typeof ingestDismissalsActivities;

export const ingestDismissalsActivities = {
  async prReviewIngestDismissals(
    repo: { owner: string; repo: string },
    input: IngestDismissalsInput,
  ): Promise<IngestDismissalsResult> {
    return await withSpan(
      "prReview.ingestDismissals",
      { "pr.owner": repo.owner, "pr.repo": repo.repo },
      async () => {
        const token = Bun.env["GH_TOKEN"] ?? "";
        if (token === "") {
          prReviewReactionPollErrorTotal.inc({ stage: "github" });
          jsonLog("error", "GH_TOKEN unset; skipping ingest", {});
          return {
            maxObservedAt: new Date().toISOString(),
            thumbsDownIngested: 0,
            resolvedWithoutFollowupIngested: 0,
            skippedDuplicates: 0,
            erroredFindings: 0,
          };
        }
        const octokit = new Octokit({ auth: token });
        // Bootstrap and post activities widen the concrete Octokit
        // instance to a minimal slice via structural typing — the
        // safeParse schemas at runtime are the actual contract.
        return await ingestDismissalsImpl(repo.owner, repo.repo, input, {
          octokit,
          embed: {},
        });
      },
    );
  },
};
