import { RecoveryIntentSchema } from "./recovery-intent.ts";
import { z } from "zod";
import { IdentifierSchema } from "./artifact-contract.ts";
import { EvidenceInputSchema } from "./evidence-contract.ts";

const Generation = z.number().int().nonnegative();
const Fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
export const RequestWorkerRecoverySchema = z
  .object({
    requestId: IdentifierSchema,
    expectedEnvironmentGeneration: Generation,
    reason: z.string().min(20).max(4000),
  })
  .strict();
export type RequestWorkerRecovery = z.infer<typeof RequestWorkerRecoverySchema>;
export const WorkerRecoveryIntentSchema = RecoveryIntentSchema.extend({
  poolFingerprint: Fingerprint,
});
export type WorkerRecoveryIntent = z.infer<typeof WorkerRecoveryIntentSchema>;
export const CompleteWorkerRecoverySchema = z
  .object({
    expectedEnvironmentGeneration: Generation,
    snapshotFingerprint: Fingerprint,
    poolFingerprint: Fingerprint,
    observedAt: z.iso.datetime(),
    routes: z
      .array(
        z
          .object({
            namespace: z.enum(["prod", "beta"]),
            deploymentName: IdentifierSchema,
            taskQueue: IdentifierSchema,
            currentBuildId: z.string().regex(/^[a-f0-9]{40}$/),
            rampingBuildId: z.null(),
            routingConflictToken: z.string().min(1).max(2048),
          })
          .strict(),
      )
      .min(1)
      .max(2),
    evidence: z.array(EvidenceInputSchema).min(2).max(100),
  })
  .strict()
  .refine(
    (value) =>
      value.evidence.some((entry) => entry.kind === "runtime") &&
      value.evidence.some(
        (entry) =>
          entry.kind === "reconciliation" && entry.operationId !== undefined,
      ),
    "Recovery requires independently inspected routing, host and settled external-operation evidence",
  );
export type CompleteWorkerRecovery = z.infer<
  typeof CompleteWorkerRecoverySchema
>;
export const FailWorkerRecoverySchema = z
  .object({ message: z.string().min(1).max(4000) })
  .strict();
