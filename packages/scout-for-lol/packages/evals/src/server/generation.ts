import { z } from "zod";

import {
  FrozenRenderedPromptsSchema,
  GenerationSchema,
} from "#shared/schema.ts";

const GenerationWithoutPromptsSchema = GenerationSchema.omit({
  renderedPrompts: true,
});

const GenerationRowSchema = GenerationWithoutPromptsSchema.extend({
  renderedPromptsJson: z.string().min(1),
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
    output_tokens AS outputTokens
  FROM generations
  WHERE id = ?
`;

export const INSERT_GENERATION_SQL = `
  INSERT INTO generations (
    id, case_id, output_text, model, prompt_revision, rendered_prompts_json,
    duration_ms, input_tokens, output_tokens, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

export function parseGenerationRow(
  row: unknown,
): z.infer<typeof GenerationSchema> {
  const { renderedPromptsJson, ...generation } = GenerationRowSchema.parse(row);
  const renderedPromptsValue: unknown = JSON.parse(renderedPromptsJson);
  return GenerationSchema.parse({
    ...generation,
    renderedPrompts: FrozenRenderedPromptsSchema.parse(renderedPromptsValue),
  });
}
