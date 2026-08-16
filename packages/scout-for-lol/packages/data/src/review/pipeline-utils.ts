/**
 * Shared utility functions for the AI review pipeline
 *
 * These utilities are used by both pipeline-stages.ts and timeline-stages.ts.
 * Extracted to avoid code duplication.
 */

import type {
  TextGenerationClient,
  ModelConfig,
  StageTrace,
} from "./pipeline-types.ts";
import { modelSupportsParameter } from "./models.ts";

/**
 * Minify JSON string to reduce token usage
 */
export function minifyJson(data: unknown): string {
  return JSON.stringify(data);
}

/**
 * Extract all variable names from a template using <VARIABLE> syntax
 */
export function extractTemplateVariables(template: string): Set<string> {
  const regex = /<([A-Z][A-Z0-9_]*)>/g;
  const variables = new Set<string>();
  let match;
  while ((match = regex.exec(template)) !== null) {
    const varName = match[1];
    if (varName !== undefined) {
      variables.add(varName);
    }
  }
  return variables;
}

/**
 * Replace template variables in a prompt template using <VARIABLE> syntax
 *
 * Validates that:
 * 1. All variables in the template have corresponding replacements
 * 2. All provided replacements are used in the template
 *
 * @throws Error if variables are missing or unused
 */
export function replacePromptVariables(
  template: string,
  variables: Record<string, string>,
): string {
  const templateVars = extractTemplateVariables(template);
  const providedVars = new Set(Object.keys(variables));

  // Check for missing variables (in template but not provided)
  const missingVars = [...templateVars].filter((v) => !providedVars.has(v));
  if (missingVars.length > 0) {
    throw new Error(`Missing prompt variables: ${missingVars.join(", ")}`);
  }

  // Check for unused variables (provided but not in template)
  const unusedVars = [...providedVars].filter((v) => !templateVars.has(v));
  if (unusedVars.length > 0) {
    throw new Error(`Unused prompt variables: ${unusedVars.join(", ")}`);
  }

  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replaceAll(`<${key}>`, value);
  }
  return result;
}

/**
 * Make a provider-neutral text-generation call and return the trace.
 */
export async function callTextModel(params: {
  client: TextGenerationClient;
  model: ModelConfig;
  systemPrompt?: string;
  userPrompt: string;
}): Promise<{ text: string; trace: StageTrace }> {
  const { client, model, systemPrompt, userPrompt } = params;

  const startTime = Date.now();

  // Only include temperature and topP if the model supports them
  // Some models (like GPT-5 series and O-series) don't support these parameters
  const supportsTemperature = modelSupportsParameter(
    model.model,
    "temperature",
  );
  const supportsTopP = modelSupportsParameter(model.model, "topP");

  const response = await client.generate({
    model: model.model,
    ...(systemPrompt === undefined || systemPrompt.length === 0
      ? {}
      : { systemPrompt }),
    userPrompt,
    maxOutputTokens: model.maxTokens,
    workload: "scout.review.text",
    ...(supportsTemperature &&
      model.temperature !== undefined && { temperature: model.temperature }),
    ...(supportsTopP && model.topP !== undefined && { topP: model.topP }),
  });

  const durationMs = Date.now() - startTime;

  if (response.text.trim().length === 0) {
    const finishReason = response.finishReason;
    const detail =
      finishReason === undefined ? "" : ` (finish_reason: ${finishReason})`;
    throw new Error(`No content returned from text model${detail}`);
  }

  const text = response.text.trim();

  const trace: StageTrace = {
    request: {
      userPrompt,
    },
    response: { text },
    model,
    durationMs,
  };

  if (systemPrompt !== undefined && systemPrompt.length > 0) {
    trace.request.systemPrompt = systemPrompt;
  }
  if (response.inputTokens !== undefined) {
    trace.tokensPrompt = response.inputTokens;
  }
  if (response.outputTokens !== undefined) {
    trace.tokensCompletion = response.outputTokens;
  }
  if (response.openRouter !== undefined) {
    trace.transport = "openrouter";
    trace.openRouter = response.openRouter;
  }

  return { text, trace };
}
