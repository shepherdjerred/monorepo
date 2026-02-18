/**
 * Shared utility functions for the AI review pipeline
 *
 * These utilities are used by both pipeline-stages.ts and timeline-stages.ts.
 * Extracted to avoid code duplication.
 */

import type {
  OpenAIClient,
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
 * Make an OpenAI chat completion call and return the trace
 */
export async function callOpenAI(params: {
  client: OpenAIClient;
  model: ModelConfig;
  systemPrompt?: string;
  userPrompt: string;
}): Promise<{ text: string; trace: StageTrace }> {
  const { client, model, systemPrompt, userPrompt } = params;

  const messages: { role: "system" | "user" | "assistant"; content: string }[] =
    [];

  if (systemPrompt !== undefined && systemPrompt.length > 0) {
    messages.push({ role: "system", content: systemPrompt });
  }
  messages.push({ role: "user", content: userPrompt });

  const startTime = Date.now();

  // Only include temperature and topP if the model supports them
  // Some models (like GPT-5 series and O-series) don't support these parameters
  const supportsTemperature = modelSupportsParameter(
    model.model,
    "temperature",
  );
  const supportsTopP = modelSupportsParameter(model.model, "topP");

  const response = await client.chat.completions.create({
    model: model.model,
    messages,
    max_completion_tokens: model.maxTokens,
    ...(supportsTemperature &&
      model.temperature !== undefined && { temperature: model.temperature }),
    ...(supportsTopP && model.topP !== undefined && { top_p: model.topP }),
  });

  const durationMs = Date.now() - startTime;

  const content = response.choices[0]?.message.content;
  if (content === undefined || content.trim().length === 0) {
    const refusal = response.choices[0]?.message.refusal;
    const finishReason = response.choices[0]?.finish_reason;
    const details: string[] = [];
    if (refusal !== undefined && refusal.length > 0) {
      details.push(`refusal: ${refusal}`);
    }
    if (finishReason !== undefined && finishReason.length > 0) {
      details.push(`finish_reason: ${finishReason}`);
    }
    const detailStr = details.length > 0 ? ` (${details.join(", ")})` : "";
    throw new Error(`No content returned from OpenAI${detailStr}`);
  }

  const text = content.trim();

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
  if (response.usage?.prompt_tokens !== undefined) {
    trace.tokensPrompt = response.usage.prompt_tokens;
  }
  if (response.usage?.completion_tokens !== undefined) {
    trace.tokensCompletion = response.usage.completion_tokens;
  }

  return { text, trace };
}
