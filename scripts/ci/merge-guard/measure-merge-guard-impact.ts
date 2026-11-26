#!/usr/bin/env bun
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import {
  evaluateThresholds,
  formatImpactMarkdown,
  NOV_10_23_BASELINE,
  parseReceiptsContent,
  summarizeMainPipelines,
  summarizePrPipelines,
  summarizeReceipts,
  WoodpeckerPipelineItemSchema,
  type ImpactScorecard,
  type WoodpeckerPipelineItem,
} from "./impact-model.ts";

const DEFAULT_WOODPECKER_URL = "https://woodpecker.sjer.red";

const USAGE = `Usage: toolkit run --env WOODPECKER_TOKEN -- bun scripts/ci/merge-guard/measure-merge-guard-impact.ts --since <ISO> [--until <ISO>] [--receipts <path>] [--json]

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

export async function buildImpactScorecard(options: {
  readonly sinceIso: string;
  readonly untilIso: string;
  readonly receiptsPath: string;
  readonly environment?:
    Readonly<Record<string, string | undefined>> | undefined;
  readonly fetcher?: typeof fetch | undefined;
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
  const conn = resolveWoodpeckerConnection(options.environment ?? Bun.env);
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

  const days = Math.max((untilMs - sinceMs) / 86_400_000, 1 / 24);
  const main = summarizeMainPipelines(mainPipelines, days);
  const pullRequests = summarizePrPipelines(prPipelines);
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
