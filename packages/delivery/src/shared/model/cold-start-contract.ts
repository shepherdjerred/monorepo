import { z } from "zod";
import { IdentifierSchema } from "#shared/artifact-contract.ts";

const Fingerprint = z.string().regex(/^sha256:[a-f0-9]{64}$/u);

/** One environment's accepted selection as the record held it when the snapshot was written. */
export const ColdStartEnvironmentSchema = z.strictObject({
  id: IdentifierSchema,
  serviceId: IdentifierSchema,
  lifecycle: z.enum(["active", "deprecated", "retired"]),
  /** Position in the bootstrap chain, prerequisites first; null outside it. */
  bootstrapOrder: z.number().int().nonnegative().nullable(),
  accepted: z
    .strictObject({
      deploymentId: IdentifierSchema,
      versionSetRevisionId: IdentifierSchema,
      recipeRevisionId: IdentifierSchema,
      configurationRevisionId: IdentifierSchema,
      /** The recorded operation that converged the target, when one did. */
      operationId: z.string().min(1).nullable(),
      artifacts: z.record(
        z.string().min(1),
        z.strictObject({
          uri: z.string().min(1),
          digest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
          version: z.string().min(1),
        }),
      ),
    })
    .nullable(),
});
export type ColdStartEnvironment = z.infer<typeof ColdStartEnvironmentSchema>;

/**
 * The cold-start snapshot (model section 6, X7): written off-cluster on every
 * acceptance of a bootstrap-chain environment. The bootstrap tool walks it in
 * order; it sets observed selections only, never an accepted pointer.
 */
export const ColdStartSnapshotSchema = z.strictObject({
  schema: z.literal("delivery-cold-start/v1"),
  writtenAt: z.iso.datetime(),
  /** The acceptance that triggered this write. */
  deploymentId: IdentifierSchema,
  recipes: z.record(IdentifierSchema, z.unknown()),
  configurations: z.record(IdentifierSchema, z.record(z.string(), z.unknown())),
  edges: z.array(
    z.strictObject({
      dependentId: IdentifierSchema,
      prerequisiteId: IdentifierSchema,
      rule: z.string().min(1),
    }),
  ),
  environments: z.array(ColdStartEnvironmentSchema),
});
export type ColdStartSnapshot = z.infer<typeof ColdStartSnapshotSchema>;

export const ColdStartRequirementSchema = z.discriminatedUnion("required", [
  z.strictObject({ required: z.literal(false) }),
  z.strictObject({
    required: z.literal(true),
    fingerprint: Fingerprint,
    snapshot: ColdStartSnapshotSchema,
  }),
]);

/** What the executor reports after writing the snapshot off-cluster. */
export const ColdStartReceiptSchema = z.strictObject({
  fingerprint: Fingerprint,
  uri: z.string().regex(/^s3:\/\/[a-z0-9.-]+\/.+$/u),
  writtenAt: z.iso.datetime(),
});
export type ColdStartReceipt = z.infer<typeof ColdStartReceiptSchema>;

/** Per environment: whether record, snapshot and live target agree after a restore. */
export const RestoreComparisonSchema = z.strictObject({
  environmentId: IdentifierSchema,
  record: IdentifierSchema.nullable(),
  snapshot: IdentifierSchema.nullable(),
  live: z.enum(["matches", "differs", "missing", "not-observed"]),
  held: z.boolean(),
  reason: z.string().nullable(),
});
export const ReconcileAfterRestoreResultSchema = z.strictObject({
  snapshotFingerprint: Fingerprint,
  environments: z.array(RestoreComparisonSchema),
});
export type ReconcileAfterRestoreResult = z.infer<
  typeof ReconcileAfterRestoreResultSchema
>;

/** An operator settles a restore hold by accepting the live state with evidence. */
export const SettleRestoreHoldSchema = z.strictObject({
  reason: z.string().trim().min(20).max(4000),
  evidence: z.string().trim().min(1).max(4000),
});
export type SettleRestoreHold = z.infer<typeof SettleRestoreHoldSchema>;

export const RestoreHoldSchema = z.strictObject({
  snapshotFingerprint: Fingerprint,
  reason: z.string().min(1),
  heldAt: z.iso.datetime(),
});
