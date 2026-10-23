import { z } from "zod";
import {
  ComponentNameSchema,
  EnvironmentIdSchema,
} from "@shepherdjerred/ops-model/catalog-document-shape.ts";
import { IdentifierSchema } from "#shared/artifact-contract.ts";
import { SelectionSchema } from "./selection-contract.ts";

/**
 * The cold-start snapshot (model section 6, X7): every environment's
 * accepted selection with the artifacts of its set revision, written
 * off-cluster on each acceptance of a bootstrap-chain environment. It sets
 * observed selections during a cold start and never an accepted pointer.
 */

/** Where the snapshot writer puts the newest snapshot and operators read it (R2). */
export const COLD_START_SNAPSHOT = {
  /** Cloudflare R2's S3 endpoint for the homelab account, beside Velero and WAL-G. */
  endpoint: "https://48948ed6cd40d73e34d27f0cc10e595f.r2.cloudflarestorage.com",
  bucket: "homelab",
  key: "delivery-cold-start/latest.json",
} as const;

/**
 * The immutable copy each write also leaves beside `latest.json`. Delivery
 * gives every snapshot its own microsecond write time, so no two snapshots
 * share a key, and the writer never overwrites one with other bytes.
 */
export function coldStartArchiveKey(snapshot: {
  writtenAt: string;
  catalogRevision: string;
}): string {
  return `delivery-cold-start/${snapshot.writtenAt}-${snapshot.catalogRevision}.json`;
}

const DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
export const SnapshotArtifactSchema = z.strictObject({
  uri: z.string().min(1).max(2048),
  version: z.string().min(1).max(160),
  digest: DigestSchema,
});
export type SnapshotArtifact = z.infer<typeof SnapshotArtifactSchema>;

export const SnapshotEnvironmentSchema = z.strictObject({
  environmentId: EnvironmentIdSchema,
  /** The accepted deployment, which names the selection within its environment (L1). */
  deploymentId: IdentifierSchema,
  acceptedAt: z.iso.datetime(),
  selection: SelectionSchema,
  /** Every component of the selected set revision, by component name. */
  artifacts: z.record(ComponentNameSchema, SnapshotArtifactSchema),
});
export type SnapshotEnvironment = z.infer<typeof SnapshotEnvironmentSchema>;

export const ColdStartSnapshotSchema = z.strictObject({
  writtenAt: z.iso.datetime(),
  catalogRevision: DigestSchema,
  environments: z
    .array(SnapshotEnvironmentSchema)
    .refine(
      (environments) =>
        new Set(environments.map((entry) => entry.environmentId)).size ===
        environments.length,
      "The snapshot records each environment once",
    ),
});
export type ColdStartSnapshot = z.infer<typeof ColdStartSnapshotSchema>;

/** Executor: whether an acceptance moved the bootstrap chain, with the snapshot to write. */
export const ColdStartRequirementSchema = z.discriminatedUnion("required", [
  z.strictObject({ required: z.literal(false) }),
  z.strictObject({
    required: z.literal(true),
    fingerprint: DigestSchema,
    snapshot: ColdStartSnapshotSchema,
  }),
]);

/** What the executor reports after writing the snapshot off-cluster. */
export const ColdStartReceiptSchema = z.strictObject({
  fingerprint: DigestSchema,
  uri: z.string().regex(/^s3:\/\/[a-z0-9.-]+\/.+$/u),
  writtenAt: z.iso.datetime(),
});
export type ColdStartReceipt = z.infer<typeof ColdStartReceiptSchema>;

/** An operator settles a restore hold by accepting the live state with evidence. */
export const SettleRestoreHoldSchema = z.strictObject({
  reason: z.string().trim().min(20).max(4000),
  evidence: z.string().trim().min(1).max(4000),
});
export type SettleRestoreHold = z.infer<typeof SettleRestoreHoldSchema>;

/** Environment.restoreHold: why reconcile-after-restore held automatic deployments. */
export const RestoreHoldSchema = z.strictObject({
  catalogRevision: DigestSchema,
  reason: z.string().min(1),
  heldAt: z.iso.datetime(),
});
