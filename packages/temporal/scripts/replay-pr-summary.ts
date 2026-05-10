#!/usr/bin/env bun
/**
 * Replay the SDK-native PR summary activity against recently merged PRs,
 * read-only (`--dry-run` writes the body to stdout instead of posting).
 *
 * Default usage:
 *   ANTHROPIC_API_KEY=... GITHUB_PERSONAL_ACCESS_TOKEN=... \
 *     bun run packages/temporal/scripts/replay-pr-summary.ts \
 *       --repo shepherdjerred/monorepo --count 10 --dry-run
 *
 * Used as the Phase 7 verification gate: replay against the last 10 merged
 * PRs, manually grade the resulting summaries for factual accuracy and
 * absence of hallucinated paths. Also produces aggregate cost / latency
 * stats so we can confirm the ≤$0.10/summary target.
 */
import Anthropic from "@anthropic-ai/sdk";
import { Octokit } from "@octokit/rest";
import { parseArgs } from "node:util";
import { z } from "zod/v4";
import {
  adaptOctokit,
  runPrSummary,
  type OctokitForSummary,
} from "#activities/pr-review/summary.ts";
import { SUMMARY_MARKER } from "#activities/pr-review/summary-prompts.ts";
import type { PrSummaryInput } from "#shared/schemas.ts";

type CliOptions = {
  repo: string;
  count: number;
  dryRun: boolean;
};

type MergedPr = {
  number: number;
  title: string;
  baseRef: string;
  headRef: string;
  headSha: string;
  author: string;
};

type ReplayRow = {
  prNumber: number;
  title: string;
  action: "created" | "updated" | "dry-run";
  costUsd: number;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  diffBytes: number;
  diffTruncated: boolean;
};

/** Matches the GitHub contents API "file" response shape used by the loader. */
const RepoContentFileSchema = z.object({
  type: z.literal("file"),
  content: z.string(),
});

function parseCliArgs(argv: string[]): CliOptions {
  const { values } = parseArgs({
    args: argv,
    options: {
      repo: { type: "string", default: "shepherdjerred/monorepo" },
      count: { type: "string", default: "10" },
      "dry-run": { type: "boolean", default: true },
    },
    allowPositionals: false,
  });

  const repo = values.repo;
  if (!repo.includes("/")) {
    throw new Error(`--repo must be in owner/name form, got: ${repo}`);
  }
  const count = Number.parseInt(values.count, 10);
  if (Number.isNaN(count) || count <= 0 || count > 100) {
    throw new Error(
      `--count must be a positive integer ≤ 100, got: ${values.count}`,
    );
  }
  return { repo, count, dryRun: values["dry-run"] };
}

async function listRecentMergedPrs(
  octokit: Octokit,
  owner: string,
  repo: string,
  count: number,
): Promise<MergedPr[]> {
  const result: MergedPr[] = [];
  const iterator = octokit.paginate.iterator(octokit.rest.pulls.list, {
    owner,
    repo,
    state: "closed",
    per_page: 50,
    sort: "updated",
    direction: "desc",
  });
  for await (const page of iterator) {
    for (const pr of page.data) {
      if (pr.merged_at === null) continue;
      if (pr.user === null) continue;
      result.push({
        number: pr.number,
        title: pr.title,
        baseRef: pr.base.ref,
        headRef: pr.head.ref,
        headSha: pr.head.sha,
        author: pr.user.login,
      });
      if (result.length >= count) return result;
    }
  }
  return result;
}

async function loadConventionsMarkdown(
  octokit: Octokit,
  pr: PrSummaryInput,
): Promise<string> {
  try {
    const response = await octokit.rest.repos.getContent({
      owner: pr.owner,
      repo: pr.repo,
      path: "CLAUDE.md",
      ref: pr.commitSha,
    });
    const parsed = RepoContentFileSchema.safeParse(response.data);
    if (!parsed.success) return "";
    return Buffer.from(parsed.data.content, "base64").toString("utf8");
  } catch {
    return "";
  }
}

/**
 * Adapter that wraps the real OctokitForSummary in a stub that captures the
 * comment body that would be posted but never actually mutates anything on
 * GitHub. Lists no existing comments so the upsert helper always falls
 * through to createComment — closer to "what would a fresh PR look like"
 * than "what would the next push see".
 */
function buildDryRunOctokit(
  real: OctokitForSummary,
  captured: { body?: string },
): OctokitForSummary {
  return {
    listComments: real.listComments,
    paginateListComments: () =>
      (async function* () {
        yield { data: [] };
        await Promise.resolve();
      })(),
    createComment: (params) => {
      captured.body = params.body;
      return Promise.resolve({ data: { id: 0, html_url: "(dry-run)" } });
    },
    updateComment: (params) => {
      captured.body = params.body;
      return Promise.resolve({
        data: { id: params.comment_id, html_url: "(dry-run)" },
      });
    },
    getDiff: real.getDiff,
    getContent: real.getContent,
  };
}

function percentile(sorted: readonly number[], pct: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(pct * sorted.length));
  return sorted[idx] ?? 0;
}

function logJson(
  level: "info" | "warning" | "error",
  fields: Record<string, unknown>,
): void {
  // Use console.warn so the JSON line goes to stderr — stdout is reserved for
  // the per-PR summary body in dry-run mode (printed via process.stdout below).
  console.warn(
    JSON.stringify({ level, component: "pr-summary-replay", ...fields }),
  );
}

async function main(): Promise<void> {
  const opts = parseCliArgs(Bun.argv.slice(2));
  const [owner, repo] = opts.repo.split("/", 2);
  if (owner === undefined || repo === undefined) {
    throw new Error(`bad repo arg: ${opts.repo}`);
  }

  const anthropicKey = Bun.env["ANTHROPIC_API_KEY"];
  const githubToken = Bun.env["GITHUB_PERSONAL_ACCESS_TOKEN"];
  if (anthropicKey === undefined || anthropicKey === "") {
    throw new Error("ANTHROPIC_API_KEY environment variable is required");
  }
  if (githubToken === undefined || githubToken === "") {
    throw new Error(
      "GITHUB_PERSONAL_ACCESS_TOKEN environment variable is required",
    );
  }

  const anthropic = new Anthropic({ apiKey: anthropicKey });
  const octokit = new Octokit({ auth: githubToken });

  const prs = await listRecentMergedPrs(octokit, owner, repo, opts.count);
  logJson("info", {
    msg: "Selected merged PRs for replay",
    count: prs.length,
    dryRun: opts.dryRun,
  });

  const realAdapter = adaptOctokit(octokit);
  const rows: ReplayRow[] = [];

  for (const pr of prs) {
    const input: PrSummaryInput = {
      owner,
      repo,
      prNumber: pr.number,
      commitSha: pr.headSha,
      baseRef: pr.baseRef,
      headRef: pr.headRef,
      prTitle: pr.title,
      prAuthor: pr.author,
    };

    const captured: { body?: string } = {};
    const octo: OctokitForSummary = opts.dryRun
      ? buildDryRunOctokit(realAdapter, captured)
      : realAdapter;

    try {
      const result = await runPrSummary(input, {
        anthropic,
        octokit: octo,
        loadRepoConventionsMarkdown: (i) => loadConventionsMarkdown(octokit, i),
        now: () => Date.now(),
      });
      rows.push({
        prNumber: pr.number,
        title: pr.title,
        action: opts.dryRun ? "dry-run" : result.action,
        costUsd: result.costUsd,
        durationMs: result.durationMs,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        cacheReadInputTokens: result.cacheReadInputTokens,
        diffBytes: result.diffBytes,
        diffTruncated: result.diffTruncated,
      });
      if (opts.dryRun && captured.body !== undefined) {
        // Stdout for the bodies so a human can pipe them to a file for grading.
        process.stdout.write(
          `\n========= PR #${String(pr.number)}: ${pr.title} =========\n\n`,
        );
        process.stdout.write(captured.body);
        process.stdout.write(
          `\n\n========= end PR #${String(pr.number)} =========\n\n`,
        );
      }
    } catch (error: unknown) {
      logJson("error", {
        msg: "Replay run failed",
        prNumber: pr.number,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (rows.length === 0) {
    logJson("warning", { msg: "No PRs replayed" });
    return;
  }
  const costs = rows.map((r) => r.costUsd).toSorted((a, b) => a - b);
  const durations = rows.map((r) => r.durationMs).toSorted((a, b) => a - b);

  logJson("info", {
    msg: "Replay complete",
    total: rows.length,
    costUsdP50: percentile(costs, 0.5),
    costUsdP95: percentile(costs, 0.95),
    costUsdMax: costs.at(-1) ?? 0,
    overTenCents: rows.filter((r) => r.costUsd > 0.1).length,
    durationMsP50: percentile(durations, 0.5),
    durationMsP95: percentile(durations, 0.95),
    marker: SUMMARY_MARKER,
  });
}

async function run(): Promise<void> {
  try {
    await main();
  } catch (error: unknown) {
    logJson("error", {
      msg: "Replay script failed",
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }
}

void run();
