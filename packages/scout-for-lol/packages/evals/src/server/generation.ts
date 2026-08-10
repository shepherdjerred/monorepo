import type { Database } from "bun:sqlite";
import { z } from "zod";

import {
  type CaseIdSchema,
  FrozenRenderedPromptsSchema,
  GenerationSchema,
} from "#shared/schema.ts";

const GenerationWithoutPromptsSchema = GenerationSchema.omit({
  renderedPrompts: true,
  openRouterMetadata: true,
});

const GenerationRowSchema = GenerationWithoutPromptsSchema.extend({
  renderedPromptsJson: z.string().min(1),
  transport: z.literal("openrouter").nullable(),
  openRouterMetadataJson: z.string().min(1).nullable(),
});

export const SELECT_GENERATION_SQL = `
  SELECT
    id,
    output_text AS outputText,
    model,
    prompt_revision AS promptRevision,
    rendered_prompts_json AS renderedPromptsJson,
    duration_ms AS durationMs,
    input_tokens AS inputTokens,
    output_tokens AS outputTokens,
    transport,
    openrouter_metadata_json AS openRouterMetadataJson
  FROM generations
  WHERE id = ?
`;

const INSERT_GENERATION_SQL = `
  INSERT INTO generations (
    id, case_id, output_text, model, prompt_revision, rendered_prompts_json,
    duration_ms, input_tokens, output_tokens, transport,
    openrouter_metadata_json, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

export function insertGeneration(
  database: Database,
  caseId: z.infer<typeof CaseIdSchema>,
  generation: z.infer<typeof GenerationSchema>,
  createdAt: string,
): void {
  database
    .query(INSERT_GENERATION_SQL)
    .run(
      generation.id,
      caseId,
      generation.outputText,
      generation.model,
      generation.promptRevision,
      JSON.stringify(generation.renderedPrompts),
      generation.durationMs,
      generation.inputTokens,
      generation.outputTokens,
      generation.transport ?? null,
      generation.openRouterMetadata === undefined
        ? null
        : JSON.stringify(generation.openRouterMetadata),
      createdAt,
    );
}

export function parseGenerationRow(
  row: unknown,
): z.infer<typeof GenerationSchema> {
  const {
    renderedPromptsJson,
    openRouterMetadataJson,
    transport,
    ...generation
  } = GenerationRowSchema.parse(row);
  const renderedPromptsValue: unknown = JSON.parse(renderedPromptsJson);
  const openRouterMetadataValue: unknown =
    openRouterMetadataJson === null
      ? undefined
      : JSON.parse(openRouterMetadataJson);
  return GenerationSchema.parse({
    ...generation,
    renderedPrompts: FrozenRenderedPromptsSchema.parse(renderedPromptsValue),
    ...(transport === null ? {} : { transport }),
    ...(openRouterMetadataValue === undefined
      ? {}
      : { openRouterMetadata: openRouterMetadataValue }),
  });
}
