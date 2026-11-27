#!/usr/bin/env bun
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import {
  collectPostGreenCandidateCommits,
  evaluateThresholds,
  NOV_10_23_BASELINE,
  parseReceiptsContent,
  summarizeMainPipelines,
  summarizePrPipelines,
  summarizeReceipts,
  WoodpeckerPipelineItemSchema,
  type ImpactReceipt,
  type ImpactScorecard,
  type WoodpeckerPipelineItem,
} from "./impact-model.ts";

const DEFAULT_WOODPECKER_URL = "https://woodpecker.sjer.red";
const DEFAULT_GITHUB_REPO = "shepherdjerred/monorepo";
const CompareMergeBaseSchema = z.object({
  merge_base_commit: z.object({
    sha: z.string(),
  }),
});

const USAGE = `Usage: toolkit run --env WOODPECKER_TOKEN --env GH_TOKEN -- bun scripts/ci/merge-guard/measure-merge-guard-impact.ts --since <ISO> [--until <ISO>] [--receipts <path>] [--json]

Measures post-rollout impact of the AI-542 merge-time stale-base overlap guard
across Woodpecker push-main + pull_request pipelines and optional pr-land.ndjson
receipts, comparing against the Nov 10–23 14-day baseline.`;

type WoodpeckerConnection = {
  readonly baseUrl: string;
  readonly repoId: number;
  readonly token: string;
};

function resolveWoodpeckerConnection(
  environment: Readonly<Record<string, string | undefined>>,
): WoodpeckerConnection {
  const token = environment["WOODPECKER_TOKEN"]?.trim();
  if (token === undefined || token === "") {
    throw new Error(
      "WOODPECKER_TOKEN is required (run via `toolkit run --env WOODPECKER_TOKEN -- bun scripts/ci/merge-guard/measure-merge-guard-impact.ts ...`)",
    );
  }
  const baseUrl = z
    .url({ protocol: /^https?$/u })
    .parse(environment["WOODPECKER_URL"] ?? DEFAULT_WOODPECKER_URL);
  const repoId = z.coerce
    .number()
    .int()
    .positive()
    .parse(environment["WOODPECKER_REPO_ID"] ?? "1");
  return { baseUrl, repoId, token };
}

async function fetchJson(
  url: URL,
  token: string,
  fetcher: typeof fetch,
): Promise<unknown> {
  const response = await fetcher(url, {
    headers: { authorization: `Bearer ${token}` },
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(
      `Woodpecker request failed (${String(response.status)}): ${url.pathname}`,
    );
  }
  return await response.json();
}

async function listWindowPipelines(options: {
  readonly conn: WoodpeckerConnection;
  readonly events: readonly string[];
  readonly branch?: string | undefined;
  readonly sinceSec: number;
  readonly untilSec: number;
  readonly fetcher: typeof fetch;
}): Promise<WoodpeckerPipelineItem[]> {
  const collected: WoodpeckerPipelineItem[] = [];
  for (let page = 1; page <= 40; page++) {
    const query = new URLSearchParams({
      event: options.events.join(","),
      perPage: "50",
      page: String(page),
    });
    if (options.branch !== undefined) {
      query.set("branch", options.branch);
    }
    const url = new URL(
      `/api/repos/${String(options.conn.repoId)}/pipelines?${query.toString()}`,
      options.conn.baseUrl,
    );
    const batch = z
      .array(WoodpeckerPipelineItemSchema)
      .parse(await fetchJson(url, options.conn.token, options.fetcher));
    for (const item of batch) {
      const created = item.created ?? 0;
      if (
        options.events.includes(item.event) &&
        (options.branch === undefined || item.branch === options.branch) &&
        created >= options.sinceSec &&
        created <= options.untilSec
      ) {
        collected.push(item);
      }
    }
    const oldest = batch.at(-1)?.created;
    if (
      batch.length < 50 ||
      (oldest !== undefined && oldest < options.sinceSec)
    ) {
      break;
    }
  }
  return collected;
}

async function hydrateFailedMainWorkflows(
  pipelines: readonly WoodpeckerPipelineItem[],
  conn: WoodpeckerConnection,
  fetcher: typeof fetch,
): Promise<WoodpeckerPipelineItem[]> {
  const hydrated: WoodpeckerPipelineItem[] = [];
  for (const item of pipelines) {
    const status = item.status.toLowerCase();
    if (
      (status === "failure" || status === "error") &&
      item.workflows.length === 0
    ) {
      const detailUrl = new URL(
        `/api/repos/${String(conn.repoId)}/pipelines/${String(item.number)}`,
        conn.baseUrl,
      );
      hydrated.push(
        WoodpeckerPipelineItemSchema.parse(
          await fetchJson(detailUrl, conn.token, fetcher),
        ),
      );
    } else {
      hydrated.push(item);
    }
  }
  return hydrated;
}

function gitMergeBaseWithMain(commitSha: string): string | null {
  if (!/^[0-9a-f]{7,40}$/iu.test(commitSha)) {
    return null;
  }
  const proc = Bun.spawnSync(["git", "merge-base", commitSha, "origin/main"], {
    stdout: "pipe",
    stderr: "ignore",
  });
  if (proc.exitCode !== 0) {
    return null;
  }
  const sha = proc.stdout.toString().trim();
  return sha.length > 0 ? sha : null;
}

async function resolveCommitMergeBase(
  commitSha: string,
  options: {
    readonly environment: Readonly<Record<string, string | undefined>>;
    readonly fetcher: typeof fetch;
  },
): Promise<string | null> {
  const local = gitMergeBaseWithMain(commitSha);
  if (local !== null) {
    return local;
  }
  const ghToken = options.environment["GH_TOKEN"]?.trim();
  if (ghToken === undefined || ghToken === "") {
    return null;
  }
  const githubRepo =
    options.environment["GITHUB_REPOSITORY"]?.trim() ?? DEFAULT_GITHUB_REPO;
  const compareUrl = new URL(
    `https://api.github.com/repos/${githubRepo}/compare/main...${encodeURIComponent(commitSha)}`,
  );
  try {
    const response = await options.fetcher(compareUrl, {
      headers: {
        authorization: `Bearer ${ghToken}`,
        accept: "application/vnd.github+json",
      },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      return null;
    }
    const parsed = CompareMergeBaseSchema.safeParse(await response.json());
    return parsed.success ? parsed.data.merge_base_commit.sha : null;
  } catch {
    return null;
  }
}

async function hydrateCandidateMergeBases(
  prPipelines: readonly WoodpeckerPipelineItem[],
  receiptItems: readonly ImpactReceipt[],
  options: {
    readonly environment: Readonly<Record<string, string | undefined>>;
    readonly fetcher: typeof fetch;
    readonly resolveMergeBase?:
      | ((commitSha: string) => Promise<string | null> | string | null)
      | undefined;
  },
): Promise<Map<string, string>> {
  const mergeBaseByCommit = new Map<string, string>();
  for (const receipt of receiptItems) {
    mergeBaseByCommit.set(receipt.headSha, receipt.mergeBaseSha);
  }
  const candidates = collectPostGreenCandidateCommits(prPipelines).filter(
    (sha) => !mergeBaseByCommit.has(sha),
  );
  for (const sha of candidates) {
    const resolved =
      options.resolveMergeBase === undefined
        ? await resolveCommitMergeBase(sha, options)
        : await options.resolveMergeBase(sha);
    if (resolved !== null) {
      mergeBaseByCommit.set(sha, resolved);
    }
  }
  return mergeBaseByCommit;
}

export async function buildImpactScorecard(options: {
  readonly sinceIso: string;
  readonly untilIso: string;
  readonly receiptsPath: string;
  readonly environment?:
    Readonly<Record<string, string | undefined>> | undefined;
  readonly fetcher?: typeof fetch | undefined;
  readonly resolveMergeBase?:
    ((commitSha: string) => Promise<string | null> | string | null) | undefined;
}): Promise<ImpactScorecard> {
  const sinceMs = Date.parse(options.sinceIso);
  const untilMs = Date.parse(options.untilIso);
  if (!Number.isFinite(sinceMs) || !Number.isFinite(untilMs)) {
    throw new TypeError(
      "--since and --until must be valid ISO-8601 timestamps",
    );
  }
  if (untilMs < sinceMs) {
    throw new Error("--until must not precede --since");
  }
  const env = options.environment ?? Bun.env;
  const conn = resolveWoodpeckerConnection(env);
  const fetcher = options.fetcher ?? fetch;
  const sinceSec = Math.floor(sinceMs / 1000);
  const untilSec = Math.ceil(untilMs / 1000);

  const [rawMain, prPipelines] = await Promise.all([
    listWindowPipelines({
      conn,
      events: ["push"],
      branch: "main",
      sinceSec,
      untilSec,
      fetcher,
    }),
    listWindowPipelines({
      conn,
      events: ["pull_request", "pull_request_metadata"],
      sinceSec,
      untilSec,
      fetcher,
    }),
  ]);
  const mainPipelines = await hydrateFailedMainWorkflows(
    rawMain,
    conn,
    fetcher,
  );

  const receiptFile = Bun.file(options.receiptsPath);
  const receiptsAvailable = await receiptFile.exists();
  const receiptItems = receiptsAvailable
    ? parseReceiptsContent(await receiptFile.text(), sinceMs, untilMs)
    : [];
  const mergeBaseByCommit = await hydrateCandidateMergeBases(
    prPipelines,
    receiptItems,
    {
      environment: env,
      fetcher,
      resolveMergeBase: options.resolveMergeBase,
    },
  );

  const days = Math.max((untilMs - sinceMs) / 86_400_000, 1 / 24);
  const main = summarizeMainPipelines(mainPipelines, days);
  const pullRequests = summarizePrPipelines(prPipelines, {
    mergeBaseByCommit,
    receipts: receiptItems,
  });
  const receipts = summarizeReceipts(
    receiptItems,
    receiptsAvailable,
    options.receiptsPath,
  );
  const decision = evaluateThresholds({ main, pullRequests, receipts });

  return {
    window: {
      since: new Date(sinceMs).toISOString(),
      until: new Date(untilMs).toISOString(),
      days,
    },
    main,
    pullRequests,
    receipts,
    baseline: NOV_10_23_BASELINE,
    decision,
  };
}

function pct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

export function formatImpactMarkdown(scorecard: ImpactScorecard): string {
  const lines = [
    `## Merge-Guard Impact Scorecard (${scorecard.window.since} .. ${scorecard.window.until})`,
    "",
    `**Window:** ${scorecard.window.days.toFixed(2)} day(s) | **Verdict:** **${scorecard.decision.verdict}**`,
    "",
    "| Metric | Nov 10–23 Baseline (14d) | Observed Window | Keep Threshold | Rollback Trigger |",
    "| --- | ---: | ---: | ---: | ---: |",
    `| \`main\` \`verify\` failure onsets / day | ${scorecard.baseline.verifyOnsetsPerDay.toFixed(2)} (${scorecard.baseline.staleSkewIncidentsPerDay.toFixed(2)} skew) | ${scorecard.main.verifyOnsetsPerDay.toFixed(2)} (${String(scorecard.main.verifyFailureOnsets)} onsets / ${String(scorecard.main.completedVerifyPipelines)} runs) | <= 0.50 / day | — |`,
    `| Post-green PR restack rate (Woodpecker) | ${pct(scorecard.baseline.postGreenRestackRate)} | ${pct(scorecard.pullRequests.postGreenRestackRate)} (${String(scorecard.pullRequests.postGreenRestackedPrs)} / ${String(scorecard.pullRequests.prsWithGreenHead)} PRs) | < 25.0% | > 35.0% |`,
    `| \`pr-land.ndjson\` stale block rate | 0.0% | ${scorecard.receipts.available ? `${pct(scorecard.receipts.staleBlockRate)} (${String(scorecard.receipts.staleBlocked)} / ${String(scorecard.receipts.totalEvaluations)})` : "n/a (no local file)"} | < 25.0% | > 35.0% |`,
    `| \`>= 2\` post-green restack rate | ${pct(scorecard.baseline.twoPlusRestackRate)} | ${pct(scorecard.pullRequests.twoPlusRestackRate)} (${String(scorecard.pullRequests.twoPlusRestackedPrs)} / ${String(scorecard.pullRequests.prsWithGreenHead)} PRs) | < 3.0% | >= 5.0% |`,
    `| Disjoint behind-\`main\` merges allowed | — | ${scorecard.receipts.available ? String(scorecard.receipts.disjointClean) : "n/a"} | — | — |`,
    `| Skews caught on post-green restack | 0 | ${String(scorecard.pullRequests.skewsCaughtOnRestack)} | — | — |`,
    "",
    "### Rationale",
    ...scorecard.decision.reasons.map((reason) => `- ${reason}`),
  ];
  if (scorecard.decision.rollbackActions.length > 0) {
    lines.push(
      "",
      "### Rollback Actions",
      ...scorecard.decision.rollbackActions.map((action) => `- ${action}`),
    );
  }
  return lines.join("\n");
}

export async function runMeasureMergeGuardCli(
  argv: readonly string[],
  options?: {
    readonly environment?:
      Readonly<Record<string, string | undefined>> | undefined;
    readonly fetcher?: typeof fetch | undefined;
    readonly now?: (() => Date) | undefined;
    readonly writeOut?: ((text: string) => void) | undefined;
  },
): Promise<number> {
  const env = options?.environment ?? Bun.env;
  const writeOut =
    options?.writeOut ??
    ((text: string) => {
      console.log(text);
    });
  if (argv.includes("--help") || argv.includes("-h")) {
    writeOut(USAGE);
    return 0;
  }
  const { values } = parseArgs({
    args: [...argv],
    options: {
      since: { type: "string" },
      until: { type: "string" },
      receipts: { type: "string" },
      json: { type: "boolean", default: false },
    },
    strict: true,
  });
  if (values.since === undefined || values.since.trim() === "") {
    console.error("Missing required --since <ISO> argument.\n" + USAGE);
    return 2;
  }
  const defaultStateDir =
    env["TOOLKIT_STATE_DIR"] ??
    path.join(os.homedir(), ".local", "state", "toolkit");
  const receiptsPath =
    values.receipts ?? path.join(defaultStateDir, "pr-land.ndjson");
  const untilIso =
    values.until ?? (options?.now ?? (() => new Date()))().toISOString();

  const scorecard = await buildImpactScorecard({
    sinceIso: values.since,
    untilIso,
    receiptsPath,
    environment: env,
    fetcher: options?.fetcher,
  });

  writeOut(
    values.json
      ? JSON.stringify(scorecard, null, 2)
      : formatImpactMarkdown(scorecard),
  );
  return 0;
}

if (import.meta.main) {
  process.exitCode = await runMeasureMergeGuardCli(Bun.argv.slice(2));
}
