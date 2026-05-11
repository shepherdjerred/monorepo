/**
 * Persist a graded eval run + its per-finding TP/FP/FN detail to the
 * `pr_review_eval` Postgres database. Uses Bun.SQL (matches the
 * migrator pattern from Phase 10 Part 1).
 *
 * One row in `eval_runs` per (fixture, bot-run); zero-or-more rows in
 * `eval_findings` per `eval_runs` row.
 *
 * Database credentials are read from the
 * `PR_REVIEW_EVAL_DATABASE_URL` env var (sourced from the
 * postgres-operator-managed Kubernetes secret via the temporal-worker
 * pod's 1Password Connect wiring).
 */
import { Context } from "@temporalio/activity";
import { withSpan } from "#observability/tracing.ts";
import { clusterKey } from "#shared/pr-review/cluster-key.ts";
import type { Fixture, GradeResult } from "#shared/pr-review/eval-fixture.ts";
import {
  prReviewEvalPrecision,
  prReviewEvalRecall,
  prReviewEvalCostUsdPerFixture,
  prReviewEvalLatencySeconds,
  prReviewEvalRunsTotal,
} from "#observability/pr-review-eval-metrics.ts";

const COMPONENT = "pr-review-eval";

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
      activity: "persistEvalRun",
      ...fields,
    }),
  );
}

export type PersistInput = {
  /** Resolved commit SHA of the fixtures repo for this run. */
  fixtureCommitSha: string;
  /** Temporal workflow id (the bot-run identity in the table). */
  botRunId: string;
  /** Monorepo commit SHA the bot was on at replay time. */
  botCommitSha: string;
  /** A/B experiment id, when active. */
  experimentId?: string | undefined;
  variant?: string | undefined;

  /** Per-fixture result + cost/latency. */
  rows: {
    fixture: Fixture;
    grade: GradeResult;
    costUsd: number;
    latencySec: number;
    postedFindingsCount: number;
    startedAt: Date;
    finishedAt: Date;
  }[];
};

export type PersistResult = {
  evalRunIds: number[];
};

function connectionStringOrThrow(): string {
  const url = Bun.env["PR_REVIEW_EVAL_DATABASE_URL"];
  if (url === undefined || url === "") {
    throw new Error(
      "PR_REVIEW_EVAL_DATABASE_URL missing — required for the persist activity",
    );
  }
  return url;
}

async function persistImpl(input: PersistInput): Promise<PersistResult> {
  return await withSpan(
    "prReviewEval.persist",
    {
      fixtureCommitSha: input.fixtureCommitSha,
      botRunId: input.botRunId,
      rows: input.rows.length,
    },
    async () => {
      const sql = new Bun.SQL(connectionStringOrThrow());
      const evalRunIds: number[] = [];
      try {
        for (const row of input.rows) {
          Context.current().heartbeat({
            phase: "persist",
            fixtureId: row.fixture.id,
          });
          const [insertedRun] = await sql<{ id: number }[]>`
            INSERT INTO eval_runs (
              fixture_id,
              fixture_commit_sha,
              fixture_category,
              bot_run_id,
              bot_commit_sha,
              experiment_id,
              variant,
              tp,
              fp,
              fn,
              precision_value,
              recall_value,
              latency_seconds,
              cost_usd,
              posted_findings,
              started_at,
              finished_at
            )
            VALUES (
              ${row.fixture.id},
              ${input.fixtureCommitSha},
              ${row.fixture.category}::fixture_category,
              ${input.botRunId},
              ${input.botCommitSha},
              ${input.experimentId ?? null},
              ${input.variant ?? null},
              ${row.grade.tp},
              ${row.grade.fp},
              ${row.grade.fn},
              ${row.grade.precision},
              ${row.grade.recall},
              ${row.latencySec},
              ${row.costUsd},
              ${row.postedFindingsCount},
              ${row.startedAt.toISOString()},
              ${row.finishedAt.toISOString()}
            )
            RETURNING id
          `;
          if (insertedRun === undefined) {
            throw new Error(
              `INSERT INTO eval_runs returned no row for fixture ${row.fixture.id}`,
            );
          }
          evalRunIds.push(insertedRun.id);

          // Per-finding rows. We persist TP / FP / FN with the same
          // cluster-key the grader uses so a future regression-drill
          // query can join on cluster_key across runs.
          for (const tp of row.grade.tpDetails) {
            await sql`
              INSERT INTO eval_findings (
                eval_run_id, outcome, cluster_key,
                file, line_start, line_end, kind, severity, verifier, claim
              ) VALUES (
                ${insertedRun.id},
                'tp'::eval_finding_outcome,
                ${clusterKey(tp.matched.file, tp.matched.lineStart)},
                ${tp.matched.file},
                ${tp.matched.lineStart},
                ${tp.matched.lineEnd},
                ${tp.matched.kind}::finding_kind,
                ${tp.matched.severity}::finding_severity,
                ${tp.matched.verifier}::finding_verifier,
                ${tp.matched.claim}
              )
            `;
          }
          for (const fp of row.grade.fpDetails) {
            await sql`
              INSERT INTO eval_findings (
                eval_run_id, outcome, cluster_key, claim, matched_pattern
              ) VALUES (
                ${insertedRun.id},
                'fp'::eval_finding_outcome,
                ${"fp:" + String(insertedRun.id) + ":" + fp.matchedPattern},
                ${fp.claim},
                ${fp.matchedPattern}
              )
            `;
          }
          for (const fn of row.grade.fnDetails) {
            await sql`
              INSERT INTO eval_findings (
                eval_run_id, outcome, cluster_key,
                file, line_start, line_end, kind, severity, verifier, claim
              ) VALUES (
                ${insertedRun.id},
                'fn'::eval_finding_outcome,
                ${clusterKey(fn.expected.file, fn.expected.lineStart)},
                ${fn.expected.file},
                ${fn.expected.lineStart},
                ${fn.expected.lineEnd},
                ${fn.expected.kind}::finding_kind,
                ${fn.expected.severity}::finding_severity,
                ${fn.expected.verifier}::finding_verifier,
                ${fn.expected.claim}
              )
            `;
          }

          // Per-fixture Prometheus observation. Histograms get one
          // sample per fixture; the per-category gauges below aggregate.
          prReviewEvalCostUsdPerFixture.observe(
            { category: row.fixture.category },
            row.costUsd,
          );
          prReviewEvalLatencySeconds.observe(
            { category: row.fixture.category },
            row.latencySec,
          );
        }

        // Per-category precision/recall gauges + a `total` aggregate so
        // the dashboard can show category-specific quality drops without
        // good categories masking bad ones. Computed from the rows in
        // memory rather than re-querying Postgres — cheaper and the data
        // is identical to what we just wrote.
        const byCategory = new Map<
          string,
          { tp: number; fp: number; fn: number }
        >();
        const total = { tp: 0, fp: 0, fn: 0 };
        for (const row of input.rows) {
          const cat = row.fixture.category;
          const existing = byCategory.get(cat) ?? { tp: 0, fp: 0, fn: 0 };
          existing.tp += row.grade.tp;
          existing.fp += row.grade.fp;
          existing.fn += row.grade.fn;
          byCategory.set(cat, existing);
          total.tp += row.grade.tp;
          total.fp += row.grade.fp;
          total.fn += row.grade.fn;
        }
        for (const [cat, counts] of byCategory) {
          const p =
            counts.tp + counts.fp === 0
              ? 1
              : counts.tp / (counts.tp + counts.fp);
          const r =
            counts.tp + counts.fn === 0
              ? 1
              : counts.tp / (counts.tp + counts.fn);
          prReviewEvalPrecision.set({ category: cat }, p);
          prReviewEvalRecall.set({ category: cat }, r);
        }
        const totalP =
          total.tp + total.fp === 0 ? 1 : total.tp / (total.tp + total.fp);
        const totalR =
          total.tp + total.fn === 0 ? 1 : total.tp / (total.tp + total.fn);
        prReviewEvalPrecision.set({ category: "total" }, totalP);
        prReviewEvalRecall.set({ category: "total" }, totalR);
        prReviewEvalRunsTotal.inc({ outcome: "ok" });

        jsonLog("info", "Persisted eval runs", {
          count: evalRunIds.length,
        });
        return { evalRunIds };
      } finally {
        await sql.close();
      }
    },
  );
}

export type EvalPersistActivities = typeof evalPersistActivities;

export const evalPersistActivities = {
  async prReviewEvalPersist(input: PersistInput): Promise<PersistResult> {
    return persistImpl(input);
  },
};
