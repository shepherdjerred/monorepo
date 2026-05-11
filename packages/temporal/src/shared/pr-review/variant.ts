/**
 * A/B prompt-variant selector for the pr-review bot's Phase 11
 * experimentation framework.
 *
 * Selection is sticky on the tuple `(experimentId, repo, author)`:
 * every PR by the same author on the same repo lands on the same
 * variant for the lifetime of an experiment. This avoids the "author
 * sees bot quality flap between PRs" failure mode that random-per-PR
 * assignment causes.
 *
 * Hash is SHA-256 of the canonical string `${experimentId}|${repo}|${author}`;
 * the high byte selects the bucket, so changing the assignment
 * weighting later is a one-line change. Bucket boundaries are stored
 * with each experiment (currently 50/50; the schema supports
 * arbitrary-arity multivariate tests).
 *
 * Critical invariant: the same `(experimentId, repo, author)` tuple
 * MUST produce the same variant on every run. The pipeline activity
 * recording an experiment outcome looks up the variant via this
 * function — never read-modify-write off the DB row, since a PR may
 * arrive before its `real_pr_experiments` row exists (synchronization
 * happens via the bot's workflow, not the DB).
 *
 * # Why Bayesian and not SPRT for the weekly significance test
 *
 * The Phase 11 plan offered either. Bayesian beta-binomial is what
 * landed because: (1) the team can interpret "70% posterior probability
 * variant B is better" without statistics training, (2) Bayesian handles
 * peeking gracefully — no alpha inflation if we check Wednesday and
 * Friday, (3) SPRT requires committing to alpha + beta upfront, which is
 * brittle for a 2-person-week experiment cadence. The decision is
 * captured here (rather than in the workflow file) because the same
 * choice constrains how `Experiment.method` is shaped in this schema.
 */
import { createHash } from "node:crypto";
import { z } from "zod/v4";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

/**
 * `VariantId` is the human-readable identifier for a single arm of an
 * experiment. Constrained to a stable kebab-case so the Postgres
 * `variant` column doesn't accumulate ad-hoc strings.
 */
export const VariantIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, {
    message: "variant id must be kebab-case",
  });
export type VariantId = z.infer<typeof VariantIdSchema>;

/**
 * One arm of an experiment. `weight` is a relative weight, NOT a
 * fraction — the selector divides each weight by the sum.
 * Weights MUST be positive integers so the bucket math is exact.
 */
export const VariantArmSchema = z.object({
  id: VariantIdSchema,
  weight: z.number().int().positive(),
});
export type VariantArm = z.infer<typeof VariantArmSchema>;

export const ExperimentSchema = z.object({
  /** Stable identifier — same value across all of an experiment's
   *  lifetime. Bumping this resets sticky assignment. */
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, {
    message: "experiment id must be kebab-case",
  }),

  /** Two-or-more arms. The selector rejects single-arm experiments. */
  arms: z.array(VariantArmSchema).min(2),

  /** Minimum total PRs required before the weekly significance
   *  workflow reports a winner. Plan says ≥30/arm; this is the
   *  per-arm floor, NOT the total. */
  minLabeledPrsPerArm: z.number().int().positive().default(30),

  /** Posterior probability threshold the winning arm must exceed for
   *  the weekly report to call it "winner-ready". Default 0.95 — the
   *  plan's `p < 0.05` translation, with Bayesian semantics. */
  winnerThresholdProbability: z.number().min(0.5).max(0.999_999).default(0.95),
});
export type Experiment = z.infer<typeof ExperimentSchema>;

// ---------------------------------------------------------------------------
// Active experiment registry
// ---------------------------------------------------------------------------

/**
 * Active experiments live as data, not config. Add or remove entries
 * here in a PR; the assignment activity reads the registry at
 * workflow start. Removing an experiment doesn't delete history —
 * `real_pr_experiments` rows keyed on the old experiment id are
 * preserved for audit.
 *
 * Phase 11 ships ONE example experiment so the scaffolding stays
 * exercised end-to-end. Real prompt variants land in Phase 12+ once
 * Phase 3's specialists runner exposes a hook for variant-keyed
 * system prompts.
 */
export const ACTIVE_EXPERIMENTS: readonly Experiment[] = [
  ExperimentSchema.parse({
    id: "correctness-system-prompt-v1",
    arms: [
      { id: "control", weight: 1 },
      { id: "treatment", weight: 1 },
    ],
    minLabeledPrsPerArm: 30,
    winnerThresholdProbability: 0.95,
  }),
];

// ---------------------------------------------------------------------------
// Selector
// ---------------------------------------------------------------------------

export type AssignVariantInput = {
  experiment: Experiment;
  repo: string;
  author: string;
};

export type VariantAssignment = {
  experimentId: string;
  variant: VariantId;
};

/**
 * Sticky-hash variant selection. Hashes the tuple, takes the bucket
 * by modulo over the total weight, and walks the weighted arm list.
 * Pure — every call with the same inputs produces the same output.
 */
export function assignVariant(input: AssignVariantInput): VariantAssignment {
  const { experiment, repo, author } = input;
  const totalWeight = experiment.arms.reduce((sum, arm) => sum + arm.weight, 0);
  if (totalWeight <= 0) {
    throw new Error(
      `Experiment ${experiment.id} has non-positive total weight; arms must sum to > 0`,
    );
  }

  // Canonical hash input. The pipe is the chosen separator — none of
  // the components contain pipes (kebab-case ids, GitHub repo
  // "owner/name", GitHub usernames are alphanumeric + dash).
  const canonical = `${experiment.id}|${repo}|${author}`;
  const digest = createHash("sha256").update(canonical).digest();

  // Use the first 4 bytes as an unsigned 32-bit int, then modulo by
  // totalWeight. 4 bytes gives 2^32 possible values which is well
  // beyond any practical totalWeight, so distribution stays close to
  // uniform.
  const u32 =
    ((digest[0] ?? 0) << 24) |
    ((digest[1] ?? 0) << 16) |
    ((digest[2] ?? 0) << 8) |
    (digest[3] ?? 0);
  // `>>> 0` coerces to unsigned. The bitwise OR above produces a
  // signed result in JS.
  const bucket = (u32 >>> 0) % totalWeight;

  let cumulative = 0;
  for (const arm of experiment.arms) {
    cumulative += arm.weight;
    if (bucket < cumulative) {
      return { experimentId: experiment.id, variant: arm.id };
    }
  }
  // Unreachable: cumulative ends at totalWeight, and bucket < totalWeight
  // by construction. The compiler can't see that, so we throw rather
  // than returning a misleading default.
  throw new Error(
    `Bucket walk fell off the end for experiment ${experiment.id} (bucket=${String(bucket)}, totalWeight=${String(totalWeight)})`,
  );
}

/**
 * Lookup the active experiment by id. Returns `undefined` when no
 * experiment with that id is registered — caller's job to decide
 * whether that's an error or a no-op.
 */
export function findActiveExperiment(id: string): Experiment | undefined {
  return ACTIVE_EXPERIMENTS.find((e) => e.id === id);
}
