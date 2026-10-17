import { z } from "zod";

export const CleanupReasonSchema = z.enum([
  "source_cleanup_disabled",
  "torrent_missing",
  "torrent_policy_drift",
  "submission_ownership_unknown",
  "removal_outcome_unknown",
  "source_dependencies_changed",
  "source_ownership_unproven",
  "source_directory_shared",
  "unowned_torrent",
  "download_incomplete",
  "source_in_use",
  "invalid_observation",
  "policy_required",
  "policy_unverified",
  "obligations_satisfied",
  "seeding_required",
]);

/** Informational only. No effect guard may consume this record as authority. */
export const CleanupEvaluationSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    evaluatedAt: z.iso.datetime(),
    observedAt: z.iso.datetime().nullable(),
    observationDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    policyDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    databaseDigest: z.string().regex(/^[a-f0-9]{32}$/u),
    ownershipEpoch: z.int(),
    recoveryEpoch: z.int().nonnegative(),
    phase: z.enum(["evaluation", "removal"]),
    status: z.enum(["removed", "protected", "seeding", "removable"]),
    reason: CleanupReasonSchema.nullable(),
  })
  .refine((value) => (value.status === "removed") === (value.reason === null), {
    message: "Only removed outcomes have no reason",
  });
export type CleanupEvaluation = z.infer<typeof CleanupEvaluationSchema>;

export const RecordedSeedingPolicySchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("public") }),
  z.strictObject({ kind: z.literal("unknown") }),
  z.strictObject({
    kind: z.literal("privatehd"),
    verified: z.boolean(),
    ratio: z.number().nonnegative().nullable(),
  }),
  z.strictObject({
    kind: z.literal("private"),
    verified: z.boolean(),
    ratio: z.number().nonnegative().nullable(),
    minimumSeconds: z.number().nonnegative().nullable(),
    combination: z.enum(["all", "any"]),
    sizeRule: z
      .strictObject({
        secondsPerGiB: z.number().nonnegative(),
        minimumSeconds: z.number().nonnegative(),
        maximumSeconds: z.number().nonnegative().nullable(),
      })
      .nullable(),
  }),
]);
