import { z } from "zod";
import { IdentifierSchema } from "./artifact-contract.ts";
import { EvidenceInputSchema } from "./evidence-contract.ts";

/** Common immutable intent identity; specialized proof and ownership stay separate. */
export const RecoveryIntentSchema = z.object({
  id: IdentifierSchema,
  deploymentId: IdentifierSchema,
  requestedBy: z.string().min(1),
  reason: z.string().min(20).max(4000),
  expectedEnvironmentGeneration: z.number().int().nonnegative(),
  snapshotFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(["pending", "succeeded", "failed"]),
  workflowId: z.string().min(1),
  submittedAt: z.iso.datetime().nullable(),
  message: z.string().nullable(),
  createdAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
});

export const RecoveryIntentKindSchema = z.enum([
  "argo",
  "worker",
  "platform",
  "content",
  "minecraft",
  "forum-baseline",
]);
export type RecoveryIntentKind = z.infer<typeof RecoveryIntentKindSchema>;

/**
 * The unified recovery intent (model 4.15): one operator-authorised
 * inspection of a `recovery-required` deployment, identified by deployment
 * plus sequence and settled by an independent reader. The kinds map onto
 * the five specialised v1 tables and the `release-lock` route.
 */
export const RecoveryIntentV2Schema = z
  .strictObject({
    id: IdentifierSchema,
    kind: RecoveryIntentKindSchema,
    deploymentId: IdentifierSchema,
    sequence: z.number().int().positive(),
    /** The sub-step a compound target's intent names (T3). */
    step: IdentifierSchema.nullable().default(null),
    requestedBy: z.string().min(1),
    reason: z.string().min(20).max(4000),
    expectedGeneration: z.number().int().nonnegative(),
    /** Snapshot of the deployment and environment at creation (I2). */
    fingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    evidence: z.array(EvidenceInputSchema).default([]),
    outcome: z.enum(["pending", "succeeded", "failed"]),
    createdAt: z.iso.datetime(),
    settledAt: z.iso.datetime().nullable().default(null),
  })
  .refine(
    (intent) => (intent.outcome === "pending") === (intent.settledAt === null),
    "A settled intent records when it was settled; a pending one has not been",
  );
export type RecoveryIntentV2 = z.infer<typeof RecoveryIntentV2Schema>;
