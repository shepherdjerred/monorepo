import { z } from "zod";
import { PipelineDefinitionSchema } from "./pipeline-contract.ts";
import { RecipeDefinitionSchema } from "./model/recipe-contract.ts";

const Fingerprint = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
export const OwnershipHandoverTargetSchema = z.strictObject({
  environmentId: z.string().min(1),
  serviceId: z.string().min(1),
  application: z.string().min(1),
  generation: z.number().int().nonnegative(),
  pipelineRevisionId: z.string().min(1),
  /** The immutable recipe revision the reconciled catalog binds. */
  pipeline: z.union([PipelineDefinitionSchema, RecipeDefinitionSchema]),
  configurationRevision: z.string().min(1),
  configuration: z.record(z.string(), z.string()),
  acceptedVersionSetRevisionId: z.string().nullable(),
  baseline: z
    .strictObject({
      kind: z.enum(["worker", "forum"]),
      id: z.string().min(1),
      fingerprint: Fingerprint,
    })
    .nullable(),
});
export const OwnershipHandoverContextSchema = z.strictObject({
  schema: z.literal("delivery-ownership-context/v1"),
  sourceRevision: z.string().regex(/^[a-f0-9]{40}$/u),
  catalogFingerprint: Fingerprint,
  observedAt: z.iso.datetime(),
  writesEnabled: z.boolean(),
  /** Environments the catalog keeps `active`, the only ones that admit deployments (4.10). */
  admittingEnvironments: z.array(z.string()),
  counts: z.strictObject({
    applicationLocks: z.number().int().nonnegative(),
    platformLocks: z.number().int().nonnegative(),
    activeEnvironments: z.number().int().nonnegative(),
    pendingDeployments: z.number().int().nonnegative(),
    recoveryRequired: z.number().int().nonnegative(),
    pendingObservations: z.number().int().nonnegative(),
  }),
  targets: z.array(OwnershipHandoverTargetSchema).max(200),
});
export type OwnershipHandoverContext = z.infer<
  typeof OwnershipHandoverContextSchema
>;
export type OwnershipHandoverTarget = z.infer<
  typeof OwnershipHandoverTargetSchema
>;
