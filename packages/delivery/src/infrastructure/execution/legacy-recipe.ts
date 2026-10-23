import {
  type PipelineDefinition,
  PipelineDefinitionSchema,
  type StoredRecipeDefinition,
} from "#shared/contract.ts";

/** The pre-cutover pipeline a stored recipe still is, or null for a model recipe. */
export function legacyPipelineOf(
  definition: StoredRecipeDefinition,
): PipelineDefinition | null {
  if (
    definition.kind === "static-site" ||
    (definition.kind === "tofu" && !("runnerImage" in definition))
  )
    return definition.kind === "static-site"
      ? PipelineDefinitionSchema.parse(definition)
      : null;
  const parsed = PipelineDefinitionSchema.safeParse(definition);
  return parsed.success ? parsed.data : null;
}
