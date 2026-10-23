import { z } from "zod";
import { IdentifierSchema } from "#shared/artifact-contract.ts";
import { PipelineDefinitionSchema } from "#shared/pipeline-contract.ts";
import { RecipeDefinitionSchema } from "./recipe-contract.ts";

/** An immutable configuration revision as the record stores it (model 4.8). */
export const ConfigurationRevisionSchema = z.object({
  id: IdentifierSchema,
  content: z.record(z.string(), z.string()),
  forwardOnly: z.array(z.string()).default([]),
});
export type ConfigurationRevision = z.infer<typeof ConfigurationRevisionSchema>;

/** The executor workflow that owns a deployment for its lease (model D7). */
export const ExecutorIdentitySchema = z
  .object({
    workflowId: z.string().min(1).max(200),
    workflowRunId: z.string().min(1).max(200),
  })
  .strict();
export type ExecutorIdentity = z.infer<typeof ExecutorIdentitySchema>;

/**
 * A stored recipe revision (model 4.7; the code name is retained). Rows
 * registered before the cutover hold v1 pipeline definitions; catalog
 * reconcile registers model recipes. Both stay readable forever (P1).
 */
export const PipelineRevisionSchema = z.object({
  id: IdentifierSchema,
  definition: z.union([PipelineDefinitionSchema, RecipeDefinitionSchema]),
  createdAt: z.iso.datetime(),
});
/**
 * A pre-cutover pipeline revision. Paths that only understand the v1 shapes
 * read through this schema and refuse a model recipe loudly.
 */
export const LegacyPipelineRevisionSchema = PipelineRevisionSchema.extend({
  definition: PipelineDefinitionSchema,
});

/** A stored recipe definition of either generation (see PipelineRevisionSchema). */
export type StoredRecipeDefinition = z.infer<
  typeof PipelineRevisionSchema
>["definition"];
