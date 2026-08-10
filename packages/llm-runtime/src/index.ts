import type { z } from "zod";
import {
  addTokenBreakdown as innerAddTokenBreakdown,
  emptyTokenBreakdown as innerEmptyTokenBreakdown,
  parseOpenRouterMetadata as innerParseOpenRouterMetadata,
  tokenBreakdown as innerTokenBreakdown,
} from "./metadata.ts";
import { createOpenRouterRuntime as innerCreateOpenRouterRuntime } from "./runtime.ts";
import {
  REQUIRED_MODEL_CAPABILITIES as INNER_REQUIRED_MODEL_CAPABILITIES,
  StructuredOutputExhaustionError as InnerStructuredOutputExhaustionError,
  type AggregateOpenRouterUsage as InnerAggregateOpenRouterUsage,
  type CallOptionsInput as InnerCallOptionsInput,
  type GenerateValidatedObjectInput as InnerGenerateValidatedObjectInput,
  type GenerateValidatedObjectResult as InnerGenerateValidatedObjectResult,
  type ModelRequirements as InnerModelRequirements,
  type OpenRouterCallMetadata as InnerOpenRouterCallMetadata,
  type OpenRouterRouterAttempt as InnerOpenRouterRouterAttempt,
  type OpenRouterRuntimeOptions as InnerOpenRouterRuntimeOptions,
  type OpenRouterRuntimeLogger as InnerOpenRouterRuntimeLogger,
  type OpenRouterRuntimeLogRecord as InnerOpenRouterRuntimeLogRecord,
  type OpenRouterTokenBreakdown as InnerOpenRouterTokenBreakdown,
  type RuntimeTraceContext as InnerRuntimeTraceContext,
  type StructuredOutputAttempt as InnerStructuredOutputAttempt,
} from "./types.ts";
import { generateValidatedObject as innerGenerateValidatedObject } from "./validated-object.ts";
import { openRouterWebSearchTool as innerOpenRouterWebSearchTool } from "./openrouter-tools.ts";

type Identity<T> = { [KEY in keyof T]: T[KEY] };
const passthrough = <T>(value: T): T => value;

export const REQUIRED_MODEL_CAPABILITIES = passthrough(
  INNER_REQUIRED_MODEL_CAPABILITIES,
);
export type RequiredModelCapability =
  (typeof REQUIRED_MODEL_CAPABILITIES)[number];
export class StructuredOutputExhaustionError extends InnerStructuredOutputExhaustionError {}
export type AggregateOpenRouterUsage = Identity<InnerAggregateOpenRouterUsage>;
export type CallOptionsInput = Identity<InnerCallOptionsInput>;
export type GenerateValidatedObjectInput<SCHEMA extends z.ZodType> = Identity<
  InnerGenerateValidatedObjectInput<SCHEMA>
>;
export type GenerateValidatedObjectResult<SCHEMA extends z.ZodType> = Identity<
  InnerGenerateValidatedObjectResult<SCHEMA>
>;
export type ModelRequirements = Identity<InnerModelRequirements>;
export type OpenRouterCallMetadata = Identity<InnerOpenRouterCallMetadata>;
export type OpenRouterRouterAttempt = Identity<InnerOpenRouterRouterAttempt>;
export type OpenRouterRuntimeOptions = Identity<InnerOpenRouterRuntimeOptions>;
export type OpenRouterRuntimeLogRecord =
  Identity<InnerOpenRouterRuntimeLogRecord>;
export type OpenRouterRuntimeLogger = (
  record: OpenRouterRuntimeLogRecord,
) => ReturnType<InnerOpenRouterRuntimeLogger>;
export type OpenRouterTokenBreakdown = Identity<InnerOpenRouterTokenBreakdown>;
export type RuntimeTraceContext = Identity<InnerRuntimeTraceContext>;
export type StructuredOutputAttempt = Identity<InnerStructuredOutputAttempt>;

export function addTokenBreakdown(
  ...args: Parameters<typeof innerAddTokenBreakdown>
): ReturnType<typeof innerAddTokenBreakdown> {
  return innerAddTokenBreakdown(...args);
}

export function emptyTokenBreakdown(): ReturnType<
  typeof innerEmptyTokenBreakdown
> {
  return innerEmptyTokenBreakdown();
}

export function parseOpenRouterMetadata(
  ...args: Parameters<typeof innerParseOpenRouterMetadata>
): ReturnType<typeof innerParseOpenRouterMetadata> {
  return innerParseOpenRouterMetadata(...args);
}

export function tokenBreakdown(
  ...args: Parameters<typeof innerTokenBreakdown>
): ReturnType<typeof innerTokenBreakdown> {
  return innerTokenBreakdown(...args);
}

export function openRouterWebSearchTool(
  ...args: Parameters<typeof innerOpenRouterWebSearchTool>
): ReturnType<typeof innerOpenRouterWebSearchTool> {
  return innerOpenRouterWebSearchTool(...args);
}

export function createOpenRouterRuntime(
  ...args: Parameters<typeof innerCreateOpenRouterRuntime>
): ReturnType<typeof innerCreateOpenRouterRuntime> {
  return innerCreateOpenRouterRuntime(...args);
}

export type OpenRouterRuntime = ReturnType<typeof innerCreateOpenRouterRuntime>;

export async function generateValidatedObject<SCHEMA extends z.ZodType>(
  runtime: OpenRouterRuntime,
  input: GenerateValidatedObjectInput<SCHEMA>,
): Promise<GenerateValidatedObjectResult<SCHEMA>> {
  try {
    return await innerGenerateValidatedObject(runtime, input);
  } catch (error: unknown) {
    if (error instanceof InnerStructuredOutputExhaustionError) {
      throw new StructuredOutputExhaustionError(
        error.message,
        error.attempts,
        error.usage,
      );
    }
    throw error;
  }
}
