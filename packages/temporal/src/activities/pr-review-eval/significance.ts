/**
 * Weekly significance computation for the A/B framework.
 *
 * Queries `real_pr_experiments` for labeled rows (`accepted IS NOT NULL`)
 * and computes a Bayesian beta-binomial posterior on the per-arm
 * acceptance rate. Reports back per-arm counts, posterior means + 95%
 * credible intervals, and a "probability A beats B" estimate via Monte
 * Carlo sampling.
 *
 * # Statistical model
 *
 * For each arm we model `acceptance_rate ~ Beta(alpha + accepts,
 * beta + dismisses)`. Prior is `Beta(1, 1)` (uniform — uninformative).
 * Posterior is conjugate: `Beta(1 + accepts, 1 + dismisses)`.
 *
 * # Probability of beating
 *
 * For arms A and B, `P(B > A) = ∫∫ I[r_b > r_a] · f_a(r_a) · f_b(r_b) dr_a dr_b`.
 * We approximate via Monte Carlo: draw 100k samples from each posterior,
 * count how often `r_b > r_a`. With 100k samples the std error of the
 * estimate is ~0.001 at probability=0.5 — plenty for a weekly report.
 *
 * # Decision rule
 *
 * - If `min(labeled_count_per_arm) < experiment.minLabeledPrsPerArm`,
 *   verdict = `"insufficient-data"`.
 * - Else if `max(P(arm_i > rest)) >= experiment.winnerThresholdProbability`,
 *   verdict = `"winner-ready"` with the winning arm id.
 * - Else verdict = `"inconclusive"`.
 *
 * Promotion is manual — this activity never flips production traffic.
 */
import { Context } from "@temporalio/activity";
import { withSpan } from "#observability/tracing.ts";
import {
  findActiveExperiment,
  type Experiment,
  type VariantId,
} from "#shared/pr-review/variant.ts";

const COMPONENT = "pr-review-eval";
const MONTE_CARLO_SAMPLES = 100_000;

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
      activity: "computeSignificance",
      ...fields,
    }),
  );
}

function connectionStringOrThrow(): string {
  const url = Bun.env["PR_REVIEW_EVAL_DATABASE_URL"];
  if (url === undefined || url === "") {
    throw new Error(
      "PR_REVIEW_EVAL_DATABASE_URL missing — required for significance activity",
    );
  }
  return url;
}

// ---------------------------------------------------------------------------
// Beta posterior sampling
// ---------------------------------------------------------------------------

/**
 * Draw a sample from `Gamma(shape, 1)` via Marsaglia & Tsang's method.
 * Shape must be > 0. For shape >= 1 the algorithm uses a single
 * rejection loop; for 0 < shape < 1 we fall back to the shape-shift
 * trick (sample at shape+1 then multiply by `U^(1/shape)`).
 *
 * Inlined because pulling `simple-statistics` in for one helper is
 * overkill and `Math.random` is fine for offline weekly reports
 * (we're not gambling on the seed).
 */
function sampleGamma(shape: number): number {
  if (shape < 1) {
    const u = Math.random();
    return sampleGamma(shape + 1) * Math.pow(u, 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  // Rejection-sampling loop — terminates in expected ~1.04 iterations
  // per Marsaglia & Tsang. The `for(;;)` form is the lint-compatible
  // way to express an intentionally infinite loop here.
  for (;;) {
    let x: number;
    let v: number;
    do {
      // Box-Muller for a standard normal sample.
      const u1 = Math.random();
      const u2 = Math.random();
      x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * x ** 4) {
      return d * v;
    }
    if (Math.log(u) < 0.5 * x ** 2 + d * (1 - v + Math.log(v))) {
      return d * v;
    }
  }
}

/**
 * Sample once from `Beta(alpha, beta)` via the ratio-of-gammas form:
 * `X / (X + Y)` where `X ~ Gamma(alpha, 1)` and `Y ~ Gamma(beta, 1)`.
 */
function sampleBeta(alpha: number, beta: number): number {
  const x = sampleGamma(alpha);
  const y = sampleGamma(beta);
  return x / (x + y);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor(p * sorted.length)),
  );
  return sorted[idx] ?? 0;
}

// ---------------------------------------------------------------------------
// Posterior summary per arm
// ---------------------------------------------------------------------------

export type ArmPosterior = {
  variant: VariantId;
  labeledCount: number;
  accepts: number;
  dismisses: number;
  /** Posterior mean = `(1 + accepts) / (2 + labeledCount)`. */
  posteriorMean: number;
  /** 2.5th percentile of the posterior — lower bound of 95% credible
   *  interval. */
  ci95Low: number;
  /** 97.5th percentile of the posterior. */
  ci95High: number;
};

export type SignificanceVerdict =
  | { kind: "insufficient-data"; minLabeledRequired: number }
  | { kind: "inconclusive" }
  | {
      kind: "winner-ready";
      winner: VariantId;
      probabilityWinning: number;
    };

export type SignificanceReport = {
  experimentId: string;
  windowStartedAt: Date;
  windowEndedAt: Date;
  totalLabeled: number;
  arms: ArmPosterior[];
  /** Matrix of `P(row beats column)` — symmetric in the sense that
   *  `M[a][b] + M[b][a] = 1` modulo Monte Carlo noise. Self entries
   *  are `0.5` (placeholder, never compared). */
  pairwiseProbabilities: { row: VariantId; col: VariantId; p: number }[];
  verdict: SignificanceVerdict;
};

// ---------------------------------------------------------------------------
// Computation
// ---------------------------------------------------------------------------

export type ComputeSignificanceInput = {
  experimentId: string;
  /** ISO-8601 timestamp; only labeled rows finished after this point
   *  feed the posterior. Default = 28 days ago at activity run time. */
  windowStart?: string;
};

async function computeImpl(
  input: ComputeSignificanceInput,
): Promise<SignificanceReport> {
  return await withSpan(
    "prReviewEval.computeSignificance",
    { "experiment.id": input.experimentId },
    async () => {
      const experiment = findActiveExperiment(input.experimentId);
      if (experiment === undefined) {
        throw new Error(
          `No active experiment with id ${input.experimentId}; refusing to compute significance against a removed experiment`,
        );
      }

      const windowEnded = new Date();
      const windowStarted =
        input.windowStart === undefined
          ? new Date(windowEnded.getTime() - 28 * 24 * 60 * 60 * 1000)
          : new Date(input.windowStart);

      Context.current().heartbeat({ phase: "query" });
      const sql = new Bun.SQL(connectionStringOrThrow());
      let rows: {
        variant: string;
        labeled: number;
        accepts: number;
        dismisses: number;
      }[];
      try {
        rows = await sql<
          {
            variant: string;
            labeled: number;
            accepts: number;
            dismisses: number;
          }[]
        >`
          SELECT
            variant,
            COUNT(*)::int AS labeled,
            SUM(CASE WHEN accepted THEN 1 ELSE 0 END)::int AS accepts,
            SUM(CASE WHEN accepted THEN 0 ELSE 1 END)::int AS dismisses
          FROM real_pr_experiments
          WHERE experiment_id = ${input.experimentId}
            AND accepted IS NOT NULL
            AND finished_at >= ${windowStarted.toISOString()}
            AND finished_at <= ${windowEnded.toISOString()}
          GROUP BY variant
        `;
      } finally {
        await sql.close();
      }

      const summary = summarize(experiment, rows, {
        windowStarted,
        windowEnded,
      });
      jsonLog("info", "Computed significance", {
        experimentId: input.experimentId,
        totalLabeled: summary.totalLabeled,
        verdictKind: summary.verdict.kind,
      });
      return summary;
    },
  );
}

/**
 * Pure: combine DB rows + experiment definition into the report.
 * Exported for unit testing — the SQL path is integration-tested
 * separately, but the math/decision-rule logic deserves its own
 * unit-test coverage.
 */
export function summarize(
  experiment: Experiment,
  rows: {
    variant: string;
    labeled: number;
    accepts: number;
    dismisses: number;
  }[],
  window: { windowStarted: Date; windowEnded: Date },
): SignificanceReport {
  // Build per-arm posteriors. Include arms with zero labeled rows so
  // the report makes clear which arms haven't received traffic yet.
  const byVariant = new Map(rows.map((r) => [r.variant, r]));
  const arms: ArmPosterior[] = experiment.arms.map((arm) => {
    const row = byVariant.get(arm.id);
    const accepts = row?.accepts ?? 0;
    const dismisses = row?.dismisses ?? 0;
    const labeledCount = row?.labeled ?? 0;

    // Conjugate Beta(1 + accepts, 1 + dismisses)
    const alpha = 1 + accepts;
    const beta = 1 + dismisses;
    const mean = alpha / (alpha + beta);

    // Draw samples for the CI + cache them for pairwise comparisons.
    // Reusing the same samples across pairwise calls below is
    // deliberate — keeps the comparison consistent.
    const samples: number[] = Array.from({ length: MONTE_CARLO_SAMPLES }, () =>
      sampleBeta(alpha, beta),
    );
    samples.sort((a, b) => a - b);

    return {
      variant: arm.id,
      labeledCount,
      accepts,
      dismisses,
      posteriorMean: mean,
      ci95Low: percentile(samples, 0.025),
      ci95High: percentile(samples, 0.975),
    };
  });

  // Pairwise P(row > col) — re-sample inside the loop to keep the
  // memory footprint flat. 2 arms × 2 arms × 100k samples is the
  // common case; even at 5 arms we're at 20 × 100k = 2M doubles, fine.
  const pairwiseProbabilities: SignificanceReport["pairwiseProbabilities"] = [];
  for (const armI of arms) {
    for (const armJ of arms) {
      if (armI.variant === armJ.variant) {
        pairwiseProbabilities.push({
          row: armI.variant,
          col: armJ.variant,
          p: 0.5,
        });
        continue;
      }
      const alphaI = 1 + armI.accepts;
      const betaI = 1 + armI.dismisses;
      const alphaJ = 1 + armJ.accepts;
      const betaJ = 1 + armJ.dismisses;
      let wins = 0;
      for (let k = 0; k < MONTE_CARLO_SAMPLES; k++) {
        const ri = sampleBeta(alphaI, betaI);
        const rj = sampleBeta(alphaJ, betaJ);
        if (ri > rj) {
          wins++;
        }
      }
      pairwiseProbabilities.push({
        row: armI.variant,
        col: armJ.variant,
        p: wins / MONTE_CARLO_SAMPLES,
      });
    }
  }

  // Verdict
  const minLabeled = Math.min(...arms.map((a) => a.labeledCount));
  let verdict: SignificanceVerdict;
  if (minLabeled < experiment.minLabeledPrsPerArm) {
    verdict = {
      kind: "insufficient-data",
      minLabeledRequired: experiment.minLabeledPrsPerArm,
    };
  } else {
    // Find the arm with the highest "beats every other arm" minimum
    // probability. Equivalent to: argmax_v min_{u≠v} P(v > u).
    let winner: VariantId | undefined;
    let winnerProb = 0;
    for (const armI of arms) {
      let minBeats = 1;
      for (const armJ of arms) {
        if (armI.variant === armJ.variant) {
          continue;
        }
        const entry = pairwiseProbabilities.find(
          (p) => p.row === armI.variant && p.col === armJ.variant,
        );
        if (entry === undefined) {
          continue;
        }
        if (entry.p < minBeats) {
          minBeats = entry.p;
        }
      }
      if (minBeats > winnerProb) {
        winnerProb = minBeats;
        winner = armI.variant;
      }
    }
    verdict =
      winner !== undefined &&
      winnerProb >= experiment.winnerThresholdProbability
        ? {
            kind: "winner-ready",
            winner,
            probabilityWinning: winnerProb,
          }
        : { kind: "inconclusive" };
  }

  return {
    experimentId: experiment.id,
    windowStartedAt: window.windowStarted,
    windowEndedAt: window.windowEnded,
    totalLabeled: rows.reduce((sum, r) => sum + r.labeled, 0),
    arms,
    pairwiseProbabilities,
    verdict,
  };
}

// ---------------------------------------------------------------------------
// Activity registry
// ---------------------------------------------------------------------------

export type EvalSignificanceActivities = typeof evalSignificanceActivities;

export const evalSignificanceActivities = {
  async prReviewComputeSignificance(
    input: ComputeSignificanceInput,
  ): Promise<SignificanceReport> {
    return computeImpl(input);
  },
};
