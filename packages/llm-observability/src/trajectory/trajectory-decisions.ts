import { costForDecisionUsage } from "@shepherdjerred/llm-models";
import type {
  TrajectoryDecisionAnswer,
  TrajectoryItem,
} from "#src/llm-traces/index.ts";
import { z } from "zod";
import {
  parseTrajectoryMessages,
  safeJsonParse,
  stringifyJson,
} from "./trajectory-messages.ts";

const LooseRecordSchema = z.record(z.string(), z.unknown());
const UnknownArraySchema = z.array(z.unknown());

const DecisionEnvelopeCheckSchema = z
  .object({
    input: z.unknown(),
    questions: z.array(z.unknown()),
  })
  .refine((val) => val.input !== undefined);

export type ParsedDecisionInputPayload = {
  decisionInputJson: string;
  questionsJson: string;
  questionNames: (string | undefined)[];
};

export function tryParseDecisionInputPayload(
  raw: unknown,
): ParsedDecisionInputPayload | null {
  const parsed = safeJsonParse(raw);
  if (Array.isArray(parsed)) {
    return null;
  }
  const check = DecisionEnvelopeCheckSchema.safeParse(parsed);
  if (!check.success) {
    return null;
  }
  const questionNames = check.data.questions.map((q) => {
    const obj = LooseRecordSchema.safeParse(q);
    return obj.success && typeof obj.data["name"] === "string"
      ? obj.data["name"]
      : undefined;
  });
  return {
    decisionInputJson: JSON.stringify(check.data.input),
    questionsJson: JSON.stringify(check.data.questions),
    questionNames,
  };
}

const RawProbabilityOptionSchema = z.object({
  label: z.string().optional(),
  value: z.union([z.string(), z.number(), z.boolean()]).nullable().optional(),
  probability: z.number().min(0).max(1),
});

function parseProbabilityOptions(
  rawList: unknown,
): { label: string; value: string | number | null; probability: number }[] {
  const arr = UnknownArraySchema.safeParse(rawList);
  if (!arr.success) {
    return [];
  }
  const out: {
    label: string;
    value: string | number | null;
    probability: number;
  }[] = [];
  for (const item of arr.data) {
    const parsed = RawProbabilityOptionSchema.safeParse(item);
    if (!parsed.success) {
      continue;
    }
    const rawVal = parsed.data.value;
    let normalizedValue: string | number | null = null;
    if (typeof rawVal === "boolean") {
      normalizedValue = String(rawVal);
    } else if (typeof rawVal === "string" || typeof rawVal === "number") {
      normalizedValue = rawVal;
    }
    out.push({
      label:
        parsed.data.label ??
        (normalizedValue === null ? "" : String(normalizedValue)),
      value: normalizedValue,
      probability: parsed.data.probability,
    });
  }
  return out;
}

const RawDecisionAnswerUnionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("predicate"),
    name: z.string().nullable().optional(),
    probability: z.number().min(0).max(1),
  }),
  z.object({
    type: z.literal("choice"),
    name: z.string().nullable().optional(),
    choice: z.union([z.string(), z.boolean(), z.number()]).optional(),
    confidence: z.number().min(0).max(1),
    probabilities: z.unknown().optional(),
  }),
  z.object({
    type: z.literal("score"),
    name: z.string().nullable().optional(),
    score: z.number(),
    confidence: z.number().min(0).max(1),
    probabilities: z.unknown().optional(),
  }),
  z.object({
    type: z.literal("refusal"),
    name: z.string().nullable().optional(),
  }),
]);

function parseSingleDecisionAnswer(
  rawItem: unknown,
  fallbackName: string,
): TrajectoryDecisionAnswer | null {
  const parsed = RawDecisionAnswerUnionSchema.safeParse(rawItem);
  if (!parsed.success) {
    return null;
  }
  const data = parsed.data;
  const name =
    data.name === undefined || data.name === null || data.name === ""
      ? fallbackName
      : data.name;
  switch (data.type) {
    case "predicate":
      return { type: "predicate", name, probability: data.probability };
    case "choice":
      return {
        type: "choice",
        name,
        choice: data.choice === undefined ? "" : String(data.choice),
        confidence: data.confidence,
        probabilities: parseProbabilityOptions(data.probabilities),
      };
    case "score":
      return {
        type: "score",
        name,
        score: data.score,
        confidence: data.confidence,
        probabilities: parseProbabilityOptions(data.probabilities),
      };
    case "refusal":
      return { type: "refusal", name };
  }
}

export function parseDecisionAnswers(
  rawOutput: unknown,
  questionNames: readonly (string | undefined)[],
): TrajectoryDecisionAnswer[] {
  const arr = UnknownArraySchema.safeParse(safeJsonParse(rawOutput));
  if (!arr.success) {
    return [];
  }
  const answers: TrajectoryDecisionAnswer[] = [];
  for (let index = 0; index < arr.data.length; index += 1) {
    const fallbackName =
      questionNames[index] ?? `question_${String(index + 1)}`;
    const normalized = parseSingleDecisionAnswer(arr.data[index], fallbackName);
    if (normalized !== null) {
      answers.push(normalized);
    }
  }
  return answers;
}

export function buildOpenAiDecisionTrajectoryItem(input: {
  common: Omit<
    Extract<TrajectoryItem, { shape: "openai-decision" }>,
    | "shape"
    | "catalogCostUsd"
    | "costKind"
    | "systemInstructions"
    | "decisionInputJson"
    | "questionsJson"
    | "answers"
  >;
  catalogId: string | undefined;
  systemInstructions: string | null;
  payload: ParsedDecisionInputPayload;
  rawOutput: unknown;
}): TrajectoryItem {
  const cost =
    input.catalogId === undefined
      ? undefined
      : costForDecisionUsage(input.catalogId, {
          inputTokens: input.common.inputTokens,
          cachedInputTokens: input.common.cachedInputTokens,
          cacheWriteTokens: input.common.cacheCreationTokens,
        });
  return {
    ...input.common,
    shape: "openai-decision",
    catalogCostUsd: cost ?? null,
    costKind: "metered",
    systemInstructions: input.systemInstructions,
    decisionInputJson: input.payload.decisionInputJson,
    questionsJson: input.payload.questionsJson,
    answers: parseDecisionAnswers(input.rawOutput, input.payload.questionNames),
  };
}

export function buildClaudeAgentTrajectoryItem(input: {
  common: Omit<
    Extract<TrajectoryItem, { shape: "claude-agent" }>,
    | "shape"
    | "catalogCostUsd"
    | "costKind"
    | "sessionId"
    | "numTurns"
    | "notionalCostUsd"
    | "optionsJson"
    | "prompt"
    | "assistantTurns"
  >;
  sessionId: string | null;
  numTurns: number | undefined;
  notionalCost: number | undefined;
  rawOptions: unknown;
  rawInput: unknown;
  rawOutput: unknown;
}): TrajectoryItem {
  const inputMsgs = parseTrajectoryMessages(input.rawInput, "user");
  const prompt = inputMsgs
    .flatMap((msg) => msg.parts)
    .flatMap((part) => (part.kind === "text" ? [part.text] : []))
    .join("\n\n");
  return {
    ...input.common,
    shape: "claude-agent",
    catalogCostUsd: null,
    costKind: "subscription",
    sessionId: input.sessionId,
    numTurns:
      input.numTurns === undefined
        ? null
        : Math.max(0, Math.trunc(input.numTurns)),
    notionalCostUsd:
      input.notionalCost !== undefined && input.notionalCost >= 0
        ? input.notionalCost
        : null,
    optionsJson:
      input.rawOptions === undefined ? null : stringifyJson(input.rawOptions),
    prompt,
    assistantTurns: parseTrajectoryMessages(input.rawOutput, "assistant"),
  };
}
