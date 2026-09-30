import { NoObjectGeneratedError } from "ai";
import {
  type TurnAnswer,
  TurnAnswerSchema,
} from "@shepherdjerred/birmel/agent-runtime/contracts.ts";

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.endsWith("```")) {
    return text;
  }
  const withoutClose = trimmed.slice(0, -"```".length).trim();
  const fence = withoutClose.startsWith("```json") ? "```json" : "```";
  return withoutClose.startsWith(fence)
    ? withoutClose.slice(fence.length).trim()
    : text;
}

/**
 * Recover a turn answer from text the model emitted outside the structured
 * output contract — typically JSON wrapped in markdown fences. Returns null
 * when the text is not a valid turn answer in any recognized wrapping.
 */
export function repairTurnAnswer(text: string): TurnAnswer | null {
  const answers = [text, stripJsonFences(text)].flatMap((candidate) => {
    const validated = TurnAnswerSchema.safeParse(tryParseJson(candidate));
    return validated.success ? [validated.data] : [];
  });
  return answers[0] ?? null;
}

export type RecoveredTurnAnswer = {
  answer: TurnAnswer;
  inputTokens: number;
  outputTokens: number;
  finishReason: string;
};

/**
 * Salvage a turn whose final output failed structured parsing. Model output
 * is an external boundary, not an internal contract: when the model produced
 * words, delivering them beats an incident reference. Returns null for
 * anything other than an object-generation failure with usable text, which
 * keeps failing loudly.
 */
export function recoverTurnAnswer(error: unknown): RecoveredTurnAnswer | null {
  if (!NoObjectGeneratedError.isInstance(error)) {
    return null;
  }
  const text = error.text ?? "";
  if (text === "") {
    return null;
  }
  const answer: TurnAnswer = repairTurnAnswer(text) ?? {
    answer: text,
    disposition: "conversation",
  };
  return {
    answer,
    inputTokens: error.usage?.inputTokens ?? 0,
    outputTokens: error.usage?.outputTokens ?? 0,
    finishReason: error.finishReason ?? "other",
  };
}
