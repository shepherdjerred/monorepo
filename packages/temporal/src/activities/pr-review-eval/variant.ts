/**
 * Variant-assignment + outcome-recording activities for the Phase 11
 * A/B experimentation framework.
 *
 * Two activities:
 *   - `prReviewAssignVariant` — pure-ish: takes an active experiment id
 *     + PR coordinates, returns the sticky-hashed `{experimentId,
 *     variant}` assignment. No side effects on Postgres (the
 *     `real_pr_experiments` row is INSERTed by `recordExperimentOutcome`
 *     once the PR review finishes — assignment alone shouldn't tank a
 *     run if the row insert fails later).
 *   - `prReviewRecordExperimentOutcome` — INSERT ... ON CONFLICT DO
 *     UPDATE into `real_pr_experiments`, preserving the row for
 *     follow-up `accepted` backfill by the Phase 9 reaction listener.
 */
import { Context } from "@temporalio/activity";
import { withSpan } from "#observability/tracing.ts";
import {
  assignVariant,
  findActiveExperiment,
  type VariantAssignment,
} from "#shared/pr-review/variant.ts";

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
      activity: "variant",
      ...fields,
    }),
  );
}

function connectionStringOrThrow(): string {
  const url = Bun.env["PR_REVIEW_EVAL_DATABASE_URL"];
  if (url === undefined || url === "") {
    throw new Error(
      "PR_REVIEW_EVAL_DATABASE_URL missing — required for variant activities",
    );
  }
  return url;
}

// ---------------------------------------------------------------------------
// Assignment
// ---------------------------------------------------------------------------

export type AssignVariantInput = {
  experimentId: string;
  repo: string;
  author: string;
};

export type AssignVariantResult =
  | { kind: "assigned"; assignment: VariantAssignment }
  | { kind: "no-active-experiment"; experimentId: string };

async function assignVariantImpl(
  input: AssignVariantInput,
): Promise<AssignVariantResult> {
  return await withSpan<AssignVariantResult>(
    "prReviewEval.assignVariant",
    {
      "experiment.id": input.experimentId,
      "repo.full": input.repo,
      "pr.author": input.author,
    },
    () => {
      const experiment = findActiveExperiment(input.experimentId);
      if (experiment === undefined) {
        jsonLog(
          "warning",
          "No active experiment with id; skipping assignment",
          {
            experimentId: input.experimentId,
          },
        );
        const result: AssignVariantResult = {
          kind: "no-active-experiment",
          experimentId: input.experimentId,
        };
        return Promise.resolve(result);
      }
      const assignment = assignVariant({
        experiment,
        repo: input.repo,
        author: input.author,
      });
      jsonLog("info", "Assigned variant", {
        experimentId: assignment.experimentId,
        variant: assignment.variant,
        repo: input.repo,
        author: input.author,
      });
      const result: AssignVariantResult = { kind: "assigned", assignment };
      return Promise.resolve(result);
    },
  );
}

// ---------------------------------------------------------------------------
// Outcome
// ---------------------------------------------------------------------------

export type RecordExperimentOutcomeInput = {
  experimentId: string;
  variant: string;
  repoFull: string;
  prNumber: number;
  author: string;
  botRunId: string;
  botCommitSha: string;
  assignedAt: Date;

  /** Outcome counters from the bot run. */
  postedFindings: number;
  costUsd: number;
  latencySec: number;
  finishedAt: Date;
};

export type RecordExperimentOutcomeResult = {
  rowId: number;
  /** True when the conflict path was taken — i.e. this PR was already
   *  recorded for this experiment, and we updated the existing row. */
  conflict: boolean;
};

async function recordOutcomeImpl(
  input: RecordExperimentOutcomeInput,
): Promise<RecordExperimentOutcomeResult> {
  return await withSpan(
    "prReviewEval.recordExperimentOutcome",
    {
      "experiment.id": input.experimentId,
      "experiment.variant": input.variant,
      "pr.repo": input.repoFull,
      "pr.number": input.prNumber,
    },
    async () => {
      Context.current().heartbeat({ phase: "insert" });
      const sql = new Bun.SQL(connectionStringOrThrow());
      try {
        // Single-statement insert with ON CONFLICT — atomic, no race
        // window. xmax = 0 distinguishes an INSERT vs an UPDATE per
        // the Postgres docs convention for upsert detection.
        const [row] = await sql<{ id: number; was_conflict: boolean }[]>`
          INSERT INTO real_pr_experiments (
            experiment_id, variant, repo_full, pr_number, author,
            bot_run_id, bot_commit_sha, assigned_at,
            posted_findings, cost_usd, latency_seconds, finished_at
          )
          VALUES (
            ${input.experimentId}, ${input.variant}, ${input.repoFull},
            ${input.prNumber}, ${input.author},
            ${input.botRunId}, ${input.botCommitSha}, ${input.assignedAt.toISOString()},
            ${input.postedFindings}, ${input.costUsd}, ${input.latencySec},
            ${input.finishedAt.toISOString()}
          )
          ON CONFLICT (experiment_id, repo_full, pr_number) DO UPDATE
            SET bot_run_id      = EXCLUDED.bot_run_id,
                bot_commit_sha  = EXCLUDED.bot_commit_sha,
                posted_findings = EXCLUDED.posted_findings,
                cost_usd        = EXCLUDED.cost_usd,
                latency_seconds = EXCLUDED.latency_seconds,
                finished_at     = EXCLUDED.finished_at
          RETURNING id, (xmax <> 0) AS was_conflict
        `;
        if (row === undefined) {
          throw new Error(
            `Upsert into real_pr_experiments returned no row for ${input.repoFull}#${String(input.prNumber)}`,
          );
        }
        jsonLog("info", "Recorded experiment outcome", {
          rowId: row.id,
          experimentId: input.experimentId,
          variant: input.variant,
          prNumber: input.prNumber,
          conflict: row.was_conflict,
        });
        return { rowId: row.id, conflict: row.was_conflict };
      } finally {
        await sql.close();
      }
    },
  );
}

// ---------------------------------------------------------------------------
// Acceptance backfill (called by Phase 9's reaction listener)
// ---------------------------------------------------------------------------

export type RecordAcceptanceInput = {
  experimentId: string;
  repoFull: string;
  prNumber: number;
  accepted: boolean;
  recordedAt: Date;
};

export type RecordAcceptanceResult = {
  matched: boolean;
};

async function recordAcceptanceImpl(
  input: RecordAcceptanceInput,
): Promise<RecordAcceptanceResult> {
  return await withSpan(
    "prReviewEval.recordAcceptance",
    {
      "experiment.id": input.experimentId,
      "pr.repo": input.repoFull,
      "pr.number": input.prNumber,
      "pr.accepted": input.accepted,
    },
    async () => {
      const sql = new Bun.SQL(connectionStringOrThrow());
      try {
        const updated = await sql<{ id: number }[]>`
          UPDATE real_pr_experiments
          SET accepted               = ${input.accepted},
              acceptance_recorded_at = ${input.recordedAt.toISOString()}
          WHERE experiment_id = ${input.experimentId}
            AND repo_full     = ${input.repoFull}
            AND pr_number     = ${input.prNumber}
          RETURNING id
        `;
        const matched = updated.length > 0;
        jsonLog("info", "Acceptance backfill", {
          experimentId: input.experimentId,
          prNumber: input.prNumber,
          matched,
          accepted: input.accepted,
        });
        return { matched };
      } finally {
        await sql.close();
      }
    },
  );
}

// ---------------------------------------------------------------------------
// Activity registry
// ---------------------------------------------------------------------------

export type EvalVariantActivities = typeof evalVariantActivities;

export const evalVariantActivities = {
  async prReviewAssignVariant(
    input: AssignVariantInput,
  ): Promise<AssignVariantResult> {
    return assignVariantImpl(input);
  },
  async prReviewRecordExperimentOutcome(
    input: RecordExperimentOutcomeInput,
  ): Promise<RecordExperimentOutcomeResult> {
    return recordOutcomeImpl(input);
  },
  async prReviewRecordAcceptance(
    input: RecordAcceptanceInput,
  ): Promise<RecordAcceptanceResult> {
    return recordAcceptanceImpl(input);
  },
};
