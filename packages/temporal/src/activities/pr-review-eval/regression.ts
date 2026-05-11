/**
 * Compute the trailing-7-day mean precision from `eval_runs` and
 * compare it to the current run's mean. Flip the
 * `pr_review_eval_regression_active` gauge to 1 if the current run
 * is > 5pp below the trailing-7d mean — the PD alert rule fires off
 * that gauge.
 *
 * Decision rationale: PromQL CAN compute trailing-7d quantiles, but
 * the per-fixture precision gauges get overwritten each nightly run.
 * Computing the trailing mean from the Postgres source-of-truth (which
 * has every run's precision row) keeps the comparison readable and
 * avoids a flaky PromQL `holt_winters` / `predict_linear` workaround.
 */
import { Context } from "@temporalio/activity";
import { withSpan } from "#observability/tracing.ts";
import { prReviewEvalRegressionActive } from "#observability/pr-review-eval-metrics.ts";

const COMPONENT = "pr-review-eval";
/** Threshold: alert fires when (trailing_7d_mean − current) > this. */
const PRECISION_DROP_THRESHOLD = 0.05;

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
      activity: "computeRegression",
      ...fields,
    }),
  );
}

export type RegressionInput = {
  /** Bot-run id of the JUST-completed nightly run. Used to scope the
   *  "current mean" to this run's eval_runs rows. */
  botRunId: string;
};

export type RegressionResult = {
  currentMeanPrecision: number | null;
  trailingMeanPrecision: number | null;
  delta: number | null;
  alertActive: boolean;
};

function connectionStringOrThrow(): string {
  const url = Bun.env["PR_REVIEW_EVAL_DATABASE_URL"];
  if (url === undefined || url === "") {
    throw new Error(
      "PR_REVIEW_EVAL_DATABASE_URL missing — required for the regression activity",
    );
  }
  return url;
}

async function computeImpl(input: RegressionInput): Promise<RegressionResult> {
  return await withSpan(
    "prReviewEval.computeRegression",
    { botRunId: input.botRunId },
    async () => {
      Context.current().heartbeat({ phase: "query" });
      const sql = new Bun.SQL(connectionStringOrThrow());
      try {
        const [currentRow] = await sql<{ avg_precision: number | null }[]>`
          SELECT AVG(precision_value)::float AS avg_precision
          FROM eval_runs
          WHERE bot_run_id = ${input.botRunId}
        `;
        const [trailingRow] = await sql<{ avg_precision: number | null }[]>`
          SELECT AVG(precision_value)::float AS avg_precision
          FROM eval_runs
          WHERE finished_at >= NOW() - INTERVAL '7 days'
            AND bot_run_id <> ${input.botRunId}
        `;
        const current = currentRow?.avg_precision ?? null;
        const trailing = trailingRow?.avg_precision ?? null;

        let alertActive = false;
        let delta: number | null = null;
        if (current !== null && trailing !== null) {
          delta = trailing - current;
          alertActive = delta > PRECISION_DROP_THRESHOLD;
        }
        prReviewEvalRegressionActive.set(alertActive ? 1 : 0);
        jsonLog("info", "Regression check complete", {
          currentMeanPrecision: current,
          trailingMeanPrecision: trailing,
          delta,
          alertActive,
        });
        return {
          currentMeanPrecision: current,
          trailingMeanPrecision: trailing,
          delta,
          alertActive,
        };
      } finally {
        await sql.close();
      }
    },
  );
}

export type EvalRegressionActivities = typeof evalRegressionActivities;

export const evalRegressionActivities = {
  async prReviewEvalComputeRegression(
    input: RegressionInput,
  ): Promise<RegressionResult> {
    return computeImpl(input);
  },
};
