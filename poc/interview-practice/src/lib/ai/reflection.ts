import { z } from "zod/v4";
import type { AIClient } from "./client.ts";
import type { LeetcodeQuestion, QuestionPart } from "#lib/questions/schemas.ts";
import type { Timer } from "#lib/timer/countdown.ts";
import type { Logger } from "#logger";
import type { TranscriptEntry } from "#lib/db/transcript.ts";
import {
  type Reflection,
  type ReflectionQueue,
  ReflectionSchema,
} from "./reflection-queue.ts";
import {
  buildReflectionSystemPrompt,
  buildReflectionUserPrompt,
} from "./prompts/leetcode-reflection.ts";

export type ReflectionLoopOptions = {
  reflectionClient: AIClient;
  queue: ReflectionQueue;
  question: LeetcodeQuestion;
  logger: Logger;
};

export type ReflectionTriggerContext = {
  currentPart: QuestionPart;
  totalParts: number;
  timer: Timer;
  hintsGiven: number;
  testsRun: number;
  recentTranscript: TranscriptEntry[];
  codeSnapshot: string | null;
};

// Reuse the schemas from reflection-queue.ts, omitting createdAt (added after parsing)
const ReflectionArraySchema = z.array(
  ReflectionSchema.omit({ createdAt: true }),
);

export async function triggerReflection(
  options: ReflectionLoopOptions,
  context: ReflectionTriggerContext,
): Promise<void> {
  const { reflectionClient, queue, question, logger } = options;

  const systemPrompt = buildReflectionSystemPrompt({
    question,
    currentPart: context.currentPart,
    totalParts: context.totalParts,
    timerDisplay: context.timer.getDisplayTime(),
    timerPhase: context.timer.getPhase(),
    hintsGiven: context.hintsGiven,
    testsRun: context.testsRun,
    recentTranscript: context.recentTranscript,
    codeSnapshot: context.codeSnapshot,
  });

  const userPrompt = buildReflectionUserPrompt(context.recentTranscript);

  try {
    const response = await reflectionClient.chat({
      systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
      maxTokens: 1024,
    });

    const reflections = parseReflectionResponse(response.text);

    for (const reflection of reflections) {
      queue.push(reflection);
    }

    logger.info("reflection_complete", {
      reflectionCount: reflections.length,
      queueSize: queue.size(),
      tokensIn: response.tokensIn,
      tokensOut: response.tokensOut,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    logger.error("reflection_failed", { error: message });
  }
}

export function parseReflectionResponse(text: string): Reflection[] {
  // Extract JSON array from the response (may have markdown fences)
  const jsonMatch = /\[[\s\S]*\]/.exec(text);
  if (jsonMatch === null) return [];

  try {
    const parsed: unknown = JSON.parse(jsonMatch[0]);
    const result = ReflectionArraySchema.safeParse(parsed);
    if (!result.success) return [];

    const now = Date.now();
    return result.data.map((r) => {
      const reflection: Reflection = {
        type: r.type,
        content: r.content,
        priority: r.priority,
        createdAt: now,
      };
      if (r.nextMove !== undefined) {
        reflection.nextMove = r.nextMove;
      }
      return ReflectionSchema.parse(reflection);
    });
  } catch {
    return [];
  }
}

export async function pauseAndThink(
  options: ReflectionLoopOptions,
  context: ReflectionTriggerContext,
): Promise<Reflection[]> {
  const { reflectionClient, queue, question, logger } = options;

  const systemPrompt = buildReflectionSystemPrompt({
    question,
    currentPart: context.currentPart,
    totalParts: context.totalParts,
    timerDisplay: context.timer.getDisplayTime(),
    timerPhase: context.timer.getPhase(),
    hintsGiven: context.hintsGiven,
    testsRun: context.testsRun,
    recentTranscript: context.recentTranscript,
    codeSnapshot: context.codeSnapshot,
  });

  const userPrompt =
    "The conversation model has paused to think deeply. Analyze the current state thoroughly.\n\n" +
    buildReflectionUserPrompt(context.recentTranscript);

  try {
    const response = await reflectionClient.chat({
      systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
      maxTokens: 1024,
    });

    const reflections = parseReflectionResponse(response.text);

    for (const reflection of reflections) {
      queue.push(reflection);
    }

    logger.info("pause_and_think_complete", {
      reflectionCount: reflections.length,
      tokensIn: response.tokensIn,
      tokensOut: response.tokensOut,
    });

    return reflections;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    logger.error("pause_and_think_failed", { error: message });
    return [];
  }
}
