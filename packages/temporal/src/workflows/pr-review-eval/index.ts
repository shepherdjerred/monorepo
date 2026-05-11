import { proxyActivities, workflowInfo } from "@temporalio/workflow";
import type { EvalLoadActivities } from "#activities/pr-review-eval/load.ts";
import type {
  EvalReplayActivities,
  ReplayResult,
} from "#activities/pr-review-eval/replay.ts";
import type { EvalGradeActivities } from "#activities/pr-review-eval/grade.ts";
import type { EvalPersistActivities } from "#activities/pr-review-eval/persist.ts";
import type { EvalRegressionActivities } from "#activities/pr-review-eval/regression.ts";
import type { Fixture, GradeResult } from "#shared/pr-review/eval-fixture.ts";

/**
 * Activity timeouts for the nightly eval pipeline.
 *
 * - `load`: shallow-clone the fixtures repo. Small (~few MB).
 * - `replay`: LLM-bound — calls the correctness specialist once per
 *   fixture. ~30s per fixture under normal load.
 * - `grade`: pure compute. Tight timeout.
 * - `persist`: Postgres insert. Network-bound.
 * - `regression`: single SELECT. Tight timeout.
 */
const load = proxyActivities<EvalLoadActivities>({
  startToCloseTimeout: "5 minutes",
  heartbeatTimeout: "1 minute",
  retry: { maximumAttempts: 3 },
});

const replay = proxyActivities<EvalReplayActivities>({
  startToCloseTimeout: "15 minutes",
  heartbeatTimeout: "2 minutes",
  retry: { maximumAttempts: 1 },
});

const grade = proxyActivities<EvalGradeActivities>({
  startToCloseTimeout: "1 minute",
  retry: { maximumAttempts: 2 },
});

const persist = proxyActivities<EvalPersistActivities>({
  startToCloseTimeout: "5 minutes",
  heartbeatTimeout: "30 seconds",
  retry: { maximumAttempts: 3 },
});

const regression = proxyActivities<EvalRegressionActivities>({
  startToCloseTimeout: "1 minute",
  retry: { maximumAttempts: 2 },
});

export type PrReviewEvalWorkflowInput = {
  /** Fixtures repo merge SHA the workflow clones. */
  pin: string;
};

export type PrReviewEvalWorkflowResult = {
  fixturesEvaluated: number;
  fixtureCommitSha: string;
  alertActive: boolean;
};

/**
 * Nightly continuous-eval cron. Loads the held-out fixture corpus at
 * `pin`, replays the bot read-only against each fixture, grades, and
 * persists the per-fixture scores to `pr_review_eval`. Then computes
 * the trailing-7-day mean precision and flips the
 * `pr_review_eval_regression_active` gauge — the
 * `PrReviewBotEvalPrecisionRegression` PD alert fires off that gauge.
 *
 * Concurrency: replays sequentially (one fixture at a time) to bound
 * Anthropic spend. Once Phase 11 A/B is live and we want a parallel
 * variant-comparison run, this becomes a `Promise.all(...)` with a
 * semaphore-style cap.
 */
export async function prReviewEvalWorkflow(
  input: PrReviewEvalWorkflowInput,
): Promise<PrReviewEvalWorkflowResult> {
  const wfInfo = workflowInfo();
  const botRunId = wfInfo.workflowId;
  const startedAtMs = wfInfo.startTime.getTime();

  const { fixtureCommitSha, fixtures, scratchDir } =
    await load.prReviewEvalLoadCorpus({ pin: input.pin });

  const rows: {
    fixture: Fixture;
    grade: GradeResult;
    costUsd: number;
    latencySec: number;
    postedFindingsCount: number;
    startedAt: Date;
    finishedAt: Date;
  }[] = [];

  try {
    for (const fixture of fixtures) {
      const replayStart = new Date();
      let replayResult: ReplayResult;
      try {
        replayResult = await replay.prReviewEvalReplay({
          fixture,
          scratchDir,
        });
      } catch (error: unknown) {
        // A single fixture's replay failure shouldn't abort the whole
        // nightly run. Log and continue; the per-category gauges will
        // reflect a smaller-than-expected denominator.
        console.warn(
          JSON.stringify({
            level: "error",
            msg: "Replay failed for fixture; continuing",
            component: "pr-review-eval-workflow",
            fixtureId: fixture.id,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        continue;
      }
      const replayEnd = new Date();
      const gradeResult = await grade.prReviewEvalGrade({
        fixture,
        postedFindings: replayResult.postedFindings,
      });
      rows.push({
        fixture,
        grade: gradeResult,
        costUsd: replayResult.costUsd,
        latencySec: replayResult.latencySec,
        postedFindingsCount: replayResult.postedFindings.length,
        startedAt: replayStart,
        finishedAt: replayEnd,
      });
    }

    if (rows.length === 0) {
      return {
        fixturesEvaluated: 0,
        fixtureCommitSha,
        alertActive: false,
      };
    }

    await persist.prReviewEvalPersist({
      fixtureCommitSha,
      botRunId,
      // Phase 2's correctness specialist runs on the worker pod's
      // current image — we record the same SHA the worker reports.
      // workflow.workflowInfo() doesn't expose worker-version directly;
      // a future Phase can plumb worker version via input. For now,
      // record an empty string — the regression query doesn't use it.
      botCommitSha: "",
      rows,
    });

    const regressionResult = await regression.prReviewEvalComputeRegression({
      botRunId,
    });

    return {
      fixturesEvaluated: rows.length,
      fixtureCommitSha,
      alertActive: regressionResult.alertActive,
    };
  } finally {
    try {
      await load.prReviewEvalCleanupCorpus({ scratchDir });
    } catch (error: unknown) {
      console.warn(
        JSON.stringify({
          level: "warning",
          msg: "Cleanup failed; will leak the scratch dir until pod restart",
          component: "pr-review-eval-workflow",
          error: error instanceof Error ? error.message : String(error),
          startedAtMs,
        }),
      );
    }
  }
}
