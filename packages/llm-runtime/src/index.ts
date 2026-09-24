import type { z } from "zod";
import {
  addTokenBreakdown as innerAddTokenBreakdown,
  emptyTokenBreakdown as innerEmptyTokenBreakdown,
  parseNativeUsage as innerParseNativeUsage,
  tokenBreakdown as innerTokenBreakdown,
} from "./usage.ts";
import { createLlmRuntime as innerCreateLlmRuntime } from "./runtime.ts";
import {
  MAX_CORRECTIVE_PROMPT_CHARS as INNER_MAX_CORRECTIVE_PROMPT_CHARS,
  MAX_SEMANTIC_ATTEMPTS as INNER_MAX_SEMANTIC_ATTEMPTS,
  REQUIRED_MODEL_CAPABILITIES as INNER_REQUIRED_MODEL_CAPABILITIES,
  StructuredOutputExhaustionError as InnerStructuredOutputExhaustionError,
  StructuredOutputTransportError as InnerStructuredOutputTransportError,
  StructuredOutputUsageError as InnerStructuredOutputUsageError,
  type AggregateLlmUsage as InnerAggregateLlmUsage,
  type AnthropicCredentials as InnerAnthropicCredentials,
  type CallOptionsInput as InnerCallOptionsInput,
  type GenerateValidatedObjectInput as InnerGenerateValidatedObjectInput,
  type GenerateValidatedObjectResult as InnerGenerateValidatedObjectResult,
  type GoogleCredentials as InnerGoogleCredentials,
  type LlmCallMetadata as InnerLlmCallMetadata,
  type LlmRuntimeOptions as InnerLlmRuntimeOptions,
  type LlmRuntimeLogger as InnerLlmRuntimeLogger,
  type LlmRuntimeLogRecord as InnerLlmRuntimeLogRecord,
  type ModelRequirements as InnerModelRequirements,
  type ProviderCredentials as InnerProviderCredentials,
  type RuntimeTraceContext as InnerRuntimeTraceContext,
  type StructuredOutputAttempt as InnerStructuredOutputAttempt,
  type TokenBreakdown as InnerTokenBreakdown,
} from "./types.ts";
import { generateValidatedObject as innerGenerateValidatedObject } from "./validated-object.ts";
import { webSearchTool as innerWebSearchTool } from "./web-search.ts";
import {
  createCodexConfig as innerCreateCodexConfig,
  type CodexConfig as InnerCodexConfig,
} from "./codex.ts";

type Identity<T> = { [KEY in keyof T]: T[KEY] };
/** Identity that distributes, so a union keeps its members. */
type IdentityUnion<T> = T extends unknown
  ? { [KEY in keyof T]: T[KEY] }
  : never;
const passthrough = <T>(value: T): T => value;

export const REQUIRED_MODEL_CAPABILITIES = passthrough(
  INNER_REQUIRED_MODEL_CAPABILITIES,
);
export const MAX_SEMANTIC_ATTEMPTS: number = passthrough(
  INNER_MAX_SEMANTIC_ATTEMPTS,
);
export const MAX_CORRECTIVE_PROMPT_CHARS: number = passthrough(
  INNER_MAX_CORRECTIVE_PROMPT_CHARS,
);
export type RequiredModelCapability =
  (typeof REQUIRED_MODEL_CAPABILITIES)[number];
/**
 * Public base for structured-output failures that already consumed billable
 * tokens (exhaustion or mid-retry transport failure). Budget-metering callers
 * charge `error.usage` on `error instanceof StructuredOutputUsageError`.
 */
export class StructuredOutputUsageError extends InnerStructuredOutputUsageError {}
export class StructuredOutputExhaustionError extends StructuredOutputUsageError {
  constructor(
    message: string,
    attempts: InnerStructuredOutputUsageError["attempts"],
    usage: InnerStructuredOutputUsageError["usage"],
  ) {
    super(message, attempts, usage);
    this.name = "StructuredOutputExhaustionError";
  }
}
export class StructuredOutputTransportError extends StructuredOutputUsageError {
  constructor(
    message: string,
    attempts: InnerStructuredOutputUsageError["attempts"],
    usage: InnerStructuredOutputUsageError["usage"],
    options?: ErrorOptions,
  ) {
    super(message, attempts, usage, options);
    this.name = "StructuredOutputTransportError";
  }
}
export type AggregateLlmUsage = Identity<InnerAggregateLlmUsage>;
export type AnthropicCredentials = IdentityUnion<InnerAnthropicCredentials>;
export type CallOptionsInput = Identity<InnerCallOptionsInput>;
export type GenerateValidatedObjectInput<SCHEMA extends z.ZodType> = Identity<
  InnerGenerateValidatedObjectInput<SCHEMA>
>;
export type GenerateValidatedObjectResult<SCHEMA extends z.ZodType> = Identity<
  InnerGenerateValidatedObjectResult<SCHEMA>
>;
export type GoogleCredentials = Identity<InnerGoogleCredentials>;
export type ModelRequirements = Identity<InnerModelRequirements>;
export type LlmCallMetadata = Identity<InnerLlmCallMetadata>;
export type LlmRuntimeOptions = Identity<InnerLlmRuntimeOptions>;
export type LlmRuntimeLogRecord = Identity<InnerLlmRuntimeLogRecord>;
export type LlmRuntimeLogger = (
  record: LlmRuntimeLogRecord,
) => ReturnType<InnerLlmRuntimeLogger>;
export type ProviderCredentials = Identity<InnerProviderCredentials>;
export type RuntimeTraceContext = Identity<InnerRuntimeTraceContext>;
export type StructuredOutputAttempt = Identity<InnerStructuredOutputAttempt>;
export type TokenBreakdown = Identity<InnerTokenBreakdown>;
export type CodexConfig = Identity<InnerCodexConfig>;

export function createCodexConfig(
  ...args: Parameters<typeof innerCreateCodexConfig>
): CodexConfig {
  return innerCreateCodexConfig(...args);
}

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

export function parseNativeUsage(
  ...args: Parameters<typeof innerParseNativeUsage>
): ReturnType<typeof innerParseNativeUsage> {
  return innerParseNativeUsage(...args);
}

export function tokenBreakdown(
  ...args: Parameters<typeof innerTokenBreakdown>
): ReturnType<typeof innerTokenBreakdown> {
  return innerTokenBreakdown(...args);
}

export function webSearchTool(
  ...args: Parameters<typeof innerWebSearchTool>
): ReturnType<typeof innerWebSearchTool> {
  return innerWebSearchTool(...args);
}

export function createLlmRuntime(
  ...args: Parameters<typeof innerCreateLlmRuntime>
): ReturnType<typeof innerCreateLlmRuntime> {
  return innerCreateLlmRuntime(...args);
}

export type LlmRuntime = ReturnType<typeof innerCreateLlmRuntime>;

export async function generateValidatedObject<SCHEMA extends z.ZodType>(
  runtime: LlmRuntime,
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
    if (error instanceof InnerStructuredOutputTransportError) {
      throw new StructuredOutputTransportError(
        error.message,
        error.attempts,
        error.usage,
        { cause: error.cause },
      );
    }
    throw error;
  }
}
