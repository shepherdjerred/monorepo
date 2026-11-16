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
  type LlmImageInput as InnerLlmImageInput,
  type LlmRuntimeOptions as InnerLlmRuntimeOptions,
  type LlmRuntimeLogger as InnerLlmRuntimeLogger,
  type LlmRuntimeLogRecord as InnerLlmRuntimeLogRecord,
  type ModelRequirements as InnerModelRequirements,
  type ProviderCredentials as InnerProviderCredentials,
  type RuntimeTraceContext as InnerRuntimeTraceContext,
  type StructuredOutputAttempt as InnerStructuredOutputAttempt,
  type TokenBreakdown as InnerTokenBreakdown,
} from "./types.ts";
import {
  providerCredentialsFromEnv as innerProviderCredentialsFromEnv,
  requireCredentialsFor as innerRequireCredentialsFor,
} from "./credentials.ts";
import { generateValidatedObject as innerGenerateValidatedObject } from "./validated-object.ts";
import { webSearchTool as innerWebSearchTool } from "./web-search.ts";
import {
  createTextModeration as innerCreateTextModeration,
  TextModerationError as InnerTextModerationError,
} from "./text-moderation.ts";
import {
  mergeProviderOptions as innerMergeProviderOptions,
  reasoningProviderOptions as innerReasoningProviderOptions,
  toolLoopProviderOptions as innerToolLoopProviderOptions,
  type ProviderOptions as InnerProviderOptions,
} from "./provider-options.ts";
import {
  checkCodexModelAccess as innerCheckCodexModelAccess,
  createCodexConfig as innerCreateCodexConfig,
  type CodexConfig as InnerCodexConfig,
} from "./codex.ts";
import {
  ChoiceAnswerSchema as InnerChoiceAnswerSchema,
  ChoiceProbabilitySchema as InnerChoiceProbabilitySchema,
  ChoiceQuestionSchema as InnerChoiceQuestionSchema,
  DecisionAnswerSchema as InnerDecisionAnswerSchema,
  DecisionChoiceOptionSchema as InnerDecisionChoiceOptionSchema,
  DecisionConversationItemSchema as InnerDecisionConversationItemSchema,
  DecisionImageBlockSchema as InnerDecisionImageBlockSchema,
  DecisionInputBlockSchema as InnerDecisionInputBlockSchema,
  DecisionInputSchema as InnerDecisionInputSchema,
  DecisionJsonBlockSchema as InnerDecisionJsonBlockSchema,
  DecisionPromptCacheOptionsSchema as InnerDecisionPromptCacheOptionsSchema,
  DecisionQuestionInputPartSchema as InnerDecisionQuestionInputPartSchema,
  DecisionQuestionSchema as InnerDecisionQuestionSchema,
  DecisionRequestSchema as InnerDecisionRequestSchema,
  DecisionScoreLevelSchema as InnerDecisionScoreLevelSchema,
  DecisionSystemBlockSchema as InnerDecisionSystemBlockSchema,
  DecisionTextBlockSchema as InnerDecisionTextBlockSchema,
  DecisionWireResponseSchema as InnerDecisionWireResponseSchema,
  DecisionWireUsageSchema as InnerDecisionWireUsageSchema,
  PredicateAnswerSchema as InnerPredicateAnswerSchema,
  PredicateQuestionSchema as InnerPredicateQuestionSchema,
  RefusalAnswerSchema as InnerRefusalAnswerSchema,
  ScoreAnswerSchema as InnerScoreAnswerSchema,
  ScoreProbabilitySchema as InnerScoreProbabilitySchema,
  ScoreQuestionSchema as InnerScoreQuestionSchema,
  type ChoiceAnswer as InnerChoiceAnswer,
  type ChoiceProbability as InnerChoiceProbability,
  type ChoiceQuestion as InnerChoiceQuestion,
  type DecisionAnswer as InnerDecisionAnswer,
  type DecisionChoiceOption as InnerDecisionChoiceOption,
  type DecisionConversationItem as InnerDecisionConversationItem,
  type DecisionImageBlock as InnerDecisionImageBlock,
  type DecisionInput as InnerDecisionInput,
  type DecisionInputBlock as InnerDecisionInputBlock,
  type DecisionJsonBlock as InnerDecisionJsonBlock,
  type DecisionPromptCacheOptions as InnerDecisionPromptCacheOptions,
  type DecisionQuestion as InnerDecisionQuestion,
  type DecisionQuestionInputPart as InnerDecisionQuestionInputPart,
  type DecisionRequest as InnerDecisionRequest,
  type DecisionResult as InnerDecisionResult,
  type DecisionResultUsage as InnerDecisionResultUsage,
  type DecisionScoreLevel as InnerDecisionScoreLevel,
  type DecisionSystemBlock as InnerDecisionSystemBlock,
  type DecisionTextBlock as InnerDecisionTextBlock,
  type DecisionWireResponse as InnerDecisionWireResponse,
  type DecisionWireUsage as InnerDecisionWireUsage,
  type PredicateAnswer as InnerPredicateAnswer,
  type PredicateQuestion as InnerPredicateQuestion,
  type RefusalAnswer as InnerRefusalAnswer,
  type ScoreAnswer as InnerScoreAnswer,
  type ScoreProbability as InnerScoreProbability,
  type ScoreQuestion as InnerScoreQuestion,
} from "./decision-schemas.ts";
import {
  DecisionApiError as InnerDecisionApiError,
  type DecisionErrorKind as InnerDecisionErrorKind,
} from "./decisions.ts";

type Identity<T> = { [KEY in keyof T]: T[KEY] };
/** Identity that distributes, so a union keeps its members. */
type IdentityUnion<T> = T extends unknown
  ? { [KEY in keyof T]: T[KEY] }
  : never;
type LocalType<T> = Parameters<(value: T) => void>[0];
const passthrough = <T>(value: T): T => value;

export const TextModerationError = passthrough(InnerTextModerationError);
export const DecisionApiError = passthrough(InnerDecisionApiError);
export type DecisionApiError = Identity<InnerDecisionApiError>;

export const DecisionTextBlockSchema = passthrough(
  InnerDecisionTextBlockSchema,
);
export const DecisionSystemBlockSchema = passthrough(
  InnerDecisionSystemBlockSchema,
);
export const DecisionJsonBlockSchema = passthrough(
  InnerDecisionJsonBlockSchema,
);
export const DecisionImageBlockSchema = passthrough(
  InnerDecisionImageBlockSchema,
);
export const DecisionInputBlockSchema = passthrough(
  InnerDecisionInputBlockSchema,
);
export const DecisionQuestionInputPartSchema = passthrough(
  InnerDecisionQuestionInputPartSchema,
);
export const DecisionConversationItemSchema = passthrough(
  InnerDecisionConversationItemSchema,
);
export const DecisionInputSchema = passthrough(InnerDecisionInputSchema);
export const PredicateQuestionSchema = passthrough(
  InnerPredicateQuestionSchema,
);
export const DecisionChoiceOptionSchema = passthrough(
  InnerDecisionChoiceOptionSchema,
);
export const ChoiceQuestionSchema = passthrough(InnerChoiceQuestionSchema);
export const DecisionScoreLevelSchema = passthrough(
  InnerDecisionScoreLevelSchema,
);
export const ScoreQuestionSchema = passthrough(InnerScoreQuestionSchema);
export const DecisionQuestionSchema = passthrough(InnerDecisionQuestionSchema);
export const DecisionPromptCacheOptionsSchema = passthrough(
  InnerDecisionPromptCacheOptionsSchema,
);
export const DecisionRequestSchema = passthrough(InnerDecisionRequestSchema);
export const PredicateAnswerSchema = passthrough(InnerPredicateAnswerSchema);
export const ChoiceProbabilitySchema = passthrough(
  InnerChoiceProbabilitySchema,
);
export const ChoiceAnswerSchema = passthrough(InnerChoiceAnswerSchema);
export const ScoreProbabilitySchema = passthrough(InnerScoreProbabilitySchema);
export const ScoreAnswerSchema = passthrough(InnerScoreAnswerSchema);
export const RefusalAnswerSchema = passthrough(InnerRefusalAnswerSchema);
export const DecisionAnswerSchema = passthrough(InnerDecisionAnswerSchema);
export const DecisionWireUsageSchema = passthrough(
  InnerDecisionWireUsageSchema,
);
export const DecisionWireResponseSchema = passthrough(
  InnerDecisionWireResponseSchema,
);

export type DecisionTextBlock = Identity<InnerDecisionTextBlock>;
export type DecisionSystemBlock = Identity<InnerDecisionSystemBlock>;
export type DecisionJsonBlock = Identity<InnerDecisionJsonBlock>;
export type DecisionImageBlock = Identity<InnerDecisionImageBlock>;
export type DecisionInputBlock = LocalType<InnerDecisionInputBlock>;
export type DecisionQuestionInputPart =
  LocalType<InnerDecisionQuestionInputPart>;
export type DecisionConversationItem = Identity<InnerDecisionConversationItem>;
export type DecisionInput = LocalType<InnerDecisionInput>;
export type PredicateQuestion = Identity<InnerPredicateQuestion>;
export type DecisionChoiceOption = Identity<InnerDecisionChoiceOption>;
export type ChoiceQuestion = Identity<InnerChoiceQuestion>;
export type DecisionScoreLevel = Identity<InnerDecisionScoreLevel>;
export type ScoreQuestion = Identity<InnerScoreQuestion>;
export type DecisionQuestion = LocalType<InnerDecisionQuestion>;
export type DecisionPromptCacheOptions =
  Identity<InnerDecisionPromptCacheOptions>;
export type DecisionRequest = Identity<InnerDecisionRequest>;
export type PredicateAnswer = Identity<InnerPredicateAnswer>;
export type ChoiceProbability = Identity<InnerChoiceProbability>;
export type ChoiceAnswer = Identity<InnerChoiceAnswer>;
export type ScoreProbability = Identity<InnerScoreProbability>;
export type ScoreAnswer = Identity<InnerScoreAnswer>;
export type RefusalAnswer = Identity<InnerRefusalAnswer>;
export type DecisionAnswer = LocalType<InnerDecisionAnswer>;
export type DecisionWireUsage = Identity<InnerDecisionWireUsage>;
export type DecisionWireResponse = Identity<InnerDecisionWireResponse>;
export type DecisionResultUsage = Identity<InnerDecisionResultUsage>;
export type DecisionResult = Identity<InnerDecisionResult>;
export type DecisionErrorKind = LocalType<InnerDecisionErrorKind>;

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
export type LlmImageInput = Identity<InnerLlmImageInput>;
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
export type ProviderOptions = Identity<InnerProviderOptions>;
export type ReasoningEffort = Parameters<
  typeof innerReasoningProviderOptions
>[2];

export function reasoningProviderOptions(
  ...args: Parameters<typeof innerReasoningProviderOptions>
): ReturnType<typeof innerReasoningProviderOptions> {
  return innerReasoningProviderOptions(...args);
}

export function mergeProviderOptions(
  ...args: Parameters<typeof innerMergeProviderOptions>
): ReturnType<typeof innerMergeProviderOptions> {
  return innerMergeProviderOptions(...args);
}

export function toolLoopProviderOptions(
  ...args: Parameters<typeof innerToolLoopProviderOptions>
): ReturnType<typeof innerToolLoopProviderOptions> {
  return innerToolLoopProviderOptions(...args);
}

export function createCodexConfig(
  ...args: Parameters<typeof innerCreateCodexConfig>
): CodexConfig {
  return innerCreateCodexConfig(...args);
}

export function checkCodexModelAccess(
  ...args: Parameters<typeof innerCheckCodexModelAccess>
): Promise<void> {
  return innerCheckCodexModelAccess(...args);
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

export function createTextModeration(
  ...args: Parameters<typeof innerCreateTextModeration>
): ReturnType<typeof innerCreateTextModeration> {
  return innerCreateTextModeration(...args);
}

export function providerCredentialsFromEnv(
  ...args: Parameters<typeof innerProviderCredentialsFromEnv>
): ReturnType<typeof innerProviderCredentialsFromEnv> {
  return innerProviderCredentialsFromEnv(...args);
}

export function requireCredentialsFor(
  ...args: Parameters<typeof innerRequireCredentialsFor>
): ReturnType<typeof innerRequireCredentialsFor> {
  innerRequireCredentialsFor(...args);
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
