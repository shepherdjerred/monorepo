import { z } from "zod";

export type DecisionTextBlock = {
  readonly type: "input_text";
  readonly text: string;
  readonly prompt_cache_breakpoint?: boolean | undefined;
};
const DecisionTextBlockObjectSchema = z.strictObject({
  type: z.literal("input_text"),
  text: z.string(),
  prompt_cache_breakpoint: z.boolean().optional(),
});
export const DecisionTextBlockSchema: z.ZodType<DecisionTextBlock> =
  DecisionTextBlockObjectSchema;

export type DecisionSystemBlock = DecisionTextBlock;
export const DecisionSystemBlockSchema: z.ZodType<DecisionSystemBlock> =
  DecisionTextBlockSchema;

export type DecisionJsonBlock = {
  readonly type: "input_json";
  readonly data:
    | Readonly<Record<string, unknown>>
    | readonly Readonly<Record<string, unknown>>[];
  readonly prompt_cache_breakpoint?: boolean | undefined;
};
const DecisionJsonBlockObjectSchema = z.strictObject({
  type: z.literal("input_json"),
  data: z.union([
    z.record(z.string(), z.unknown()),
    z.array(z.record(z.string(), z.unknown())).readonly(),
  ]),
  prompt_cache_breakpoint: z.boolean().optional(),
});
export const DecisionJsonBlockSchema: z.ZodType<DecisionJsonBlock> =
  DecisionJsonBlockObjectSchema;

export type DecisionImageBlock = {
  readonly type: "input_image";
  readonly image_url: string;
  readonly detail?: "low" | "high" | "auto" | undefined;
  readonly prompt_cache_breakpoint?: boolean | undefined;
};
const DecisionImageBlockObjectSchema = z.strictObject({
  type: z.literal("input_image"),
  image_url: z.string().min(1),
  detail: z.enum(["low", "high", "auto"]).optional(),
  prompt_cache_breakpoint: z.boolean().optional(),
});
export const DecisionImageBlockSchema: z.ZodType<DecisionImageBlock> =
  DecisionImageBlockObjectSchema;

export type DecisionInputBlock =
  DecisionTextBlock | DecisionJsonBlock | DecisionImageBlock;
export const DecisionInputBlockSchema: z.ZodType<DecisionInputBlock> =
  z.discriminatedUnion("type", [
    DecisionTextBlockObjectSchema,
    DecisionJsonBlockObjectSchema,
    DecisionImageBlockObjectSchema,
  ]);

export type DecisionQuestionInputPart = DecisionInputBlock;
export const DecisionQuestionInputPartSchema: z.ZodType<DecisionQuestionInputPart> =
  DecisionInputBlockSchema;

export type DecisionConversationItem = {
  readonly role: "user" | "assistant" | "developer";
  readonly content: string | readonly DecisionInputBlock[];
  readonly prompt_cache_breakpoint?: boolean | undefined;
};
export const DecisionConversationItemSchema: z.ZodType<DecisionConversationItem> =
  z.strictObject({
    role: z.enum(["user", "assistant", "developer"]),
    content: z.union([
      z.string(),
      z.array(DecisionInputBlockSchema).min(1).readonly(),
    ]),
    prompt_cache_breakpoint: z.boolean().optional(),
  });

export type DecisionInput =
  string | readonly DecisionInputBlock[] | readonly DecisionConversationItem[];
export const DecisionInputSchema: z.ZodType<DecisionInput> = z.union([
  z.string(),
  z.array(DecisionInputBlockSchema).min(1).readonly(),
  z.array(DecisionConversationItemSchema).min(1).readonly(),
]);

const DecisionInstructionsSchema = z.union([
  z.string().min(1),
  z.array(DecisionQuestionInputPartSchema).min(1).readonly(),
]);

export type PredicateQuestion = {
  readonly type: "predicate";
  readonly name?: string | undefined;
  readonly instructions: string | readonly DecisionQuestionInputPart[];
};
const PredicateQuestionObjectSchema = z.strictObject({
  type: z.literal("predicate"),
  name: z.string().min(1).optional(),
  instructions: DecisionInstructionsSchema,
});
export const PredicateQuestionSchema: z.ZodType<PredicateQuestion> =
  PredicateQuestionObjectSchema;

export type DecisionChoiceOption = {
  readonly value: string | boolean;
  readonly description?: string | undefined;
};
export const DecisionChoiceOptionSchema: z.ZodType<DecisionChoiceOption> =
  z.strictObject({
    value: z.union([z.string().min(1), z.boolean()]),
    description: z.string().optional(),
  });

export type ChoiceQuestion = {
  readonly type: "choice";
  readonly name?: string | undefined;
  readonly instructions: string | readonly DecisionQuestionInputPart[];
  readonly choices: readonly DecisionChoiceOption[];
};
const ChoiceQuestionObjectSchema = z.strictObject({
  type: z.literal("choice"),
  name: z.string().min(1).optional(),
  instructions: DecisionInstructionsSchema,
  choices: z.array(DecisionChoiceOptionSchema).min(2).max(255).readonly(),
});
export const ChoiceQuestionSchema: z.ZodType<ChoiceQuestion> =
  ChoiceQuestionObjectSchema;

export type DecisionScoreLevel = {
  readonly label: string;
  readonly description?: string | undefined;
};
export const DecisionScoreLevelSchema: z.ZodType<DecisionScoreLevel> =
  z.strictObject({
    label: z.string().min(1),
    description: z.string().optional(),
  });

export type ScoreQuestion = {
  readonly type: "score";
  readonly name?: string | undefined;
  readonly instructions: string | readonly DecisionQuestionInputPart[];
  readonly levels: readonly DecisionScoreLevel[];
};
const ScoreQuestionObjectSchema = z.strictObject({
  type: z.literal("score"),
  name: z.string().min(1).optional(),
  instructions: DecisionInstructionsSchema,
  levels: z.array(DecisionScoreLevelSchema).min(2).max(10).readonly(),
});
export const ScoreQuestionSchema: z.ZodType<ScoreQuestion> =
  ScoreQuestionObjectSchema;

export type DecisionQuestion =
  PredicateQuestion | ChoiceQuestion | ScoreQuestion;
export const DecisionQuestionSchema: z.ZodType<DecisionQuestion> =
  z.discriminatedUnion("type", [
    PredicateQuestionObjectSchema,
    ChoiceQuestionObjectSchema,
    ScoreQuestionObjectSchema,
  ]);

export type DecisionPromptCacheOptions = {
  readonly mode?: "implicit" | "explicit" | undefined;
  readonly ttl?: "30m" | undefined;
};
export const DecisionPromptCacheOptionsSchema: z.ZodType<DecisionPromptCacheOptions> =
  z.strictObject({
    mode: z.enum(["implicit", "explicit"]).optional(),
    ttl: z.literal("30m").optional(),
  });

function hasUniqueQuestionNames(
  questions: readonly DecisionQuestion[],
): boolean {
  const seen = new Set<string>();
  for (const question of questions) {
    if (question.name === undefined) continue;
    if (seen.has(question.name)) return false;
    seen.add(question.name);
  }
  return true;
}

export type DecisionRequest = {
  readonly model: string;
  readonly workload: string;
  readonly system?: string | readonly DecisionSystemBlock[] | undefined;
  readonly input: DecisionInput;
  readonly questions: readonly DecisionQuestion[];
  readonly promptCacheKey?: string | undefined;
  readonly promptCacheOptions?: DecisionPromptCacheOptions | undefined;
  readonly safetyIdentifier?: string | undefined;
  readonly abortSignal?: AbortSignal | undefined;
};
export const DecisionRequestSchema: z.ZodType<DecisionRequest> = z.strictObject(
  {
    model: z.string().min(1),
    workload: z.string().min(1),
    system: z
      .union([z.string(), z.array(DecisionSystemBlockSchema).min(1).readonly()])
      .optional(),
    input: DecisionInputSchema,
    questions: z
      .array(DecisionQuestionSchema)
      .min(1)
      .max(400)
      .readonly()
      .refine(hasUniqueQuestionNames, {
        message: "Decision question names must be unique within a request",
      }),
    promptCacheKey: z.string().min(1).optional(),
    promptCacheOptions: DecisionPromptCacheOptionsSchema.optional(),
    safetyIdentifier: z.string().min(1).optional(),
    abortSignal: z.instanceof(AbortSignal).optional(),
  },
);

const AnswerNameSchema = z
  .string()
  .nullable()
  .optional()
  .transform((value = null) => value);

export const PredicateAnswerSchema = z
  .object({
    type: z.literal("predicate"),
    name: AnswerNameSchema,
    probability: z.number().min(0).max(1),
  })
  .loose();
export type PredicateAnswer = {
  readonly type: "predicate";
  readonly name: string | null;
  readonly probability: number;
};

export const ChoiceProbabilitySchema = z
  .object({
    value: z.union([z.string(), z.boolean()]),
    probability: z.number().min(0).max(1),
  })
  .loose();
export type ChoiceProbability = {
  readonly value: string | boolean;
  readonly probability: number;
};

export const ChoiceAnswerSchema = z
  .object({
    type: z.literal("choice"),
    name: AnswerNameSchema,
    choice: z.union([z.string(), z.boolean()]),
    confidence: z.number().min(0).max(1),
    probabilities: z.array(ChoiceProbabilitySchema),
  })
  .loose();
export type ChoiceAnswer = {
  readonly type: "choice";
  readonly name: string | null;
  readonly choice: string | boolean;
  readonly confidence: number;
  readonly probabilities: readonly ChoiceProbability[];
};

export const ScoreProbabilitySchema = z
  .object({
    label: z.string(),
    value: z.number(),
    probability: z.number().min(0).max(1),
  })
  .loose();
export type ScoreProbability = {
  readonly label: string;
  readonly value: number;
  readonly probability: number;
};

export const ScoreAnswerSchema = z
  .object({
    type: z.literal("score"),
    name: AnswerNameSchema,
    score: z.number(),
    confidence: z.number().min(0).max(1),
    probabilities: z.array(ScoreProbabilitySchema),
  })
  .loose();
export type ScoreAnswer = {
  readonly type: "score";
  readonly name: string | null;
  readonly score: number;
  readonly confidence: number;
  readonly probabilities: readonly ScoreProbability[];
};

export const RefusalAnswerSchema = z
  .object({
    type: z.literal("refusal"),
    name: AnswerNameSchema,
  })
  .loose();
export type RefusalAnswer = {
  readonly type: "refusal";
  readonly name: string | null;
};

export const DecisionAnswerSchema = z.discriminatedUnion("type", [
  PredicateAnswerSchema,
  ChoiceAnswerSchema,
  ScoreAnswerSchema,
  RefusalAnswerSchema,
]);
export type DecisionAnswer =
  PredicateAnswer | ChoiceAnswer | ScoreAnswer | RefusalAnswer;

export const DecisionWireUsageSchema = z
  .object({
    input_tokens: z.number().int().nonnegative(),
    input_tokens_details: z
      .object({
        cached_tokens: z.number().int().nonnegative().optional(),
        cache_write_tokens: z.number().int().nonnegative().optional(),
      })
      .loose()
      .optional(),
    output_tokens: z.number().int().nonnegative(),
    output_tokens_details: z
      .object({
        reasoning_tokens: z.number().int().nonnegative().optional(),
      })
      .loose()
      .optional(),
    total_tokens: z.number().int().nonnegative(),
  })
  .loose();
export type DecisionWireUsage = z.infer<typeof DecisionWireUsageSchema>;

export const DecisionWireResponseSchema = z
  .object({
    id: z.string().min(1).optional(),
    model: z.string().min(1),
    answers: z.array(DecisionAnswerSchema),
    usage: DecisionWireUsageSchema,
  })
  .loose();
export type DecisionWireResponse = z.infer<typeof DecisionWireResponseSchema>;

export type DecisionResultUsage = {
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly cacheWriteTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
  readonly totalTokens: number;
};

export type DecisionResult = {
  readonly model: string;
  readonly answers: readonly DecisionAnswer[];
  readonly answerByName: (name: string) => DecisionAnswer | undefined;
  readonly usage: DecisionResultUsage;
  readonly catalogCostUsd: number | undefined;
};
