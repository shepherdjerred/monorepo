import { z } from "zod/v4";
import type { AIClient, Message } from "./client.ts";
import type { LeetcodeQuestion, QuestionPart } from "#lib/questions/schemas.ts";
import type { Timer } from "#lib/timer/countdown.ts";
import type { Session } from "#lib/session/manager.ts";
import type { Logger } from "#logger";
import type { ReflectionQueue, Reflection, NextMovePayload } from "./reflection-queue.ts";
import type { ReflectionLoopOptions } from "./reflection.ts";
import { insertTranscript, getTranscriptWindow } from "#lib/db/transcript.ts";
import { insertEvent } from "#lib/db/events.ts";
import { saveSession } from "#lib/session/manager.ts";
import { getLeetcodeTools } from "./tools.ts";
import {
  buildLeetcodeSystemPrompt,
  buildTranscriptMessages,
} from "./prompts/leetcode-system.ts";
import { buildContext } from "./context-builder.ts";
import { triggerReflection } from "./reflection.ts";
import { dispatchTool, handleRevealNextPart } from "./tool-dispatch.ts";
import { generateReport } from "#lib/report/generate.ts";
import type { SessionReport } from "#lib/report/generate.ts";

export type TurnResult = {
  aiText: string;
  toolsCalled: string[];
  partAdvanced: boolean;
  sessionEnded: boolean;
};

export type InterviewSessionOptions = {
  client?: AIClient | undefined;
  session: Session;
  question: LeetcodeQuestion;
  timer: Timer;
  solutionPath: string;
  logger: Logger;
  reflectionQueue?: ReflectionQueue | undefined;
  reflectionOptions?: ReflectionLoopOptions | undefined;
};

export type InterviewSession = {
  handleUserInput: (text: string) => Promise<TurnResult>;
  handleToolCall: (name: string, argsJson: string) => Promise<string>;
  getSystemPrompt: () => Promise<string>;
  close: () => Promise<SessionReport>;
};

export function createInterviewSession(
  options: InterviewSessionOptions,
): InterviewSession {
  const {
    session,
    question,
    timer,
    solutionPath,
    logger,
  } = options;

  let lastCodeSnapshot: string | null = null;
  let codeWatchInterval: ReturnType<typeof setInterval> | null = null;

  // Start code snapshot watcher
  codeWatchInterval = setInterval(() => {
    void (async () => {
      try {
        const code = await Bun.file(solutionPath).text();
        if (code !== lastCodeSnapshot && code.trim() !== "") {
          lastCodeSnapshot = code;
        }
      } catch {
        // File may not exist yet
      }
    })();
  }, 5000);

  async function readCodeSnapshot(): Promise<string | null> {
    try {
      const code = await Bun.file(solutionPath).text();
      if (code.trim() !== "") {
        lastCodeSnapshot = code;
      }
      return lastCodeSnapshot;
    } catch {
      return lastCodeSnapshot;
    }
  }

  function getCurrentPart(): QuestionPart | undefined {
    return question.parts.find(
      (p) => p.partNumber === session.metadata.currentPart,
    );
  }

  async function handleUserInput(userInput: string): Promise<TurnResult> {
    if (options.client === undefined) {
      throw new Error("handleUserInput requires an AI client. Voice mode should use handleToolCall instead.");
    }
    const client = options.client;
    const startTime = Date.now();

    insertTranscript(session.db, "user", userInput);

    const currentPart = getCurrentPart();
    if (!currentPart) {
      return {
        aiText: "Interview complete. Let me give you my final assessment.",
        toolsCalled: [],
        partAdvanced: false,
        sessionEnded: true,
      };
    }

    // Drain reflections from queue (max 5)
    let reflections: Reflection[] = [];
    if (options.reflectionQueue !== undefined) {
      reflections = options.reflectionQueue.drain(5);
    }

    // Check for immediate next_move actions from reflections
    const immediateNextMove = findImmediateNextMove(reflections);

    // Read code snapshot
    const codeSnapshot = await readCodeSnapshot();

    // Get recent transcript
    const recentTranscript = getTranscriptWindow(
      session.db,
      session.metadata.hintsGiven > 0 ? 25 : 20,
    );

    // Trigger background reflection for NEXT turn
    if (options.reflectionOptions !== undefined) {
      void triggerReflection(options.reflectionOptions, {
        currentPart,
        totalParts: question.parts.length,
        timer,
        hintsGiven: session.metadata.hintsGiven,
        testsRun: session.metadata.testsRun,
        recentTranscript,
        codeSnapshot,
      });
    }

    // Build context
    const personaPrompt = buildLeetcodeSystemPrompt({
      question,
      currentPart,
      totalParts: question.parts.length,
      timerDisplay: timer.getDisplayTime(),
      timerPhase: timer.getPhase(),
      hintsGiven: session.metadata.hintsGiven,
      testsRun: session.metadata.testsRun,
      recentTranscript,
      codeSnapshot,
    });

    const builtContext = buildContext({
      question,
      currentPart,
      totalParts: question.parts.length,
      timerDisplay: timer.getDisplayTime(),
      timerPhase: timer.getPhase(),
      hintsGiven: session.metadata.hintsGiven,
      testsRun: session.metadata.testsRun,
      recentTranscript,
      codeSnapshot,
      reflections,
      personaPrompt,
    });

    const messages: Message[] = buildTranscriptMessages(
      builtContext.transcriptEntries,
    );

    // Call the model
    const tools = getLeetcodeTools();
    let response = await client.chat({
      systemPrompt: builtContext.systemPrompt,
      messages,
      tools,
    });

    const toolsCalled: string[] = [];
    let partAdvanced = false;
    const sessionEnded = false;

    // Handle deterministic next_move from reflections
    if (immediateNextMove?.action === "reveal_next_part") {
      const advanceResult = await handleRevealNextPart(
        { reason: "Reflection model determined transition criteria met" },
        question,
        session,
        logger,
      );
      if (advanceResult !== null) {
        partAdvanced = true;
        toolsCalled.push("reveal_next_part");
        insertTranscript(session.db, "tool_call", "reveal_next_part", {
          tool: "reveal_next_part",
          input: { reason: "reflection_next_move" },
        });
        insertTranscript(session.db, "tool_result", advanceResult, {
          tool: "reveal_next_part",
        });
      }
    }

    // Handle tool calls (may need multiple rounds)
    while (response.toolCalls.length > 0) {
      const toolResults: Message[] = [];

      for (const toolCall of response.toolCalls) {
        toolsCalled.push(toolCall.name);
        logger.info("tool_call", { tool: toolCall.name, input: toolCall.input });

        const result = await dispatchTool({
          toolName: toolCall.name,
          input: toolCall.input,
          question,
          session,
          solutionPath,
          logger,
          reflectionOptions: options.reflectionOptions,
          timer,
          recentTranscript,
          codeSnapshot,
        });

        if (toolCall.name === "reveal_next_part") {
          partAdvanced = true;
        }

        insertTranscript(session.db, "tool_call", toolCall.name, {
          tool: toolCall.name,
          input: toolCall.input,
        });
        insertTranscript(session.db, "tool_result", result, {
          tool: toolCall.name,
        });

        toolResults.push({
          role: "user",
          content: `[Tool result for ${toolCall.name}]: ${result}`,
        });
      }

      response = await client.chat({
        systemPrompt: builtContext.systemPrompt,
        messages: [
          ...messages,
          { role: "assistant", content: response.text },
          ...toolResults,
        ],
        tools,
      });
    }

    const latencyMs = Date.now() - startTime;

    insertTranscript(session.db, "interviewer", response.text, {
      tokensIn: response.tokensIn,
      tokensOut: response.tokensOut,
      latencyMs,
    });

    insertEvent(session.db, "turn", {
      latencyMs,
      tokensIn: response.tokensIn,
      tokensOut: response.tokensOut,
      toolsCalled,
      timerPhase: timer.getPhase(),
      reflectionsUsed: reflections.length,
    });

    session.metadata.timer = timer.getState();
    await saveSession(session);

    logger.info("turn_complete", {
      latencyMs,
      tokensIn: response.tokensIn,
      tokensOut: response.tokensOut,
      toolsCalled,
      reflectionsUsed: reflections.length,
    });

    return {
      aiText: response.text,
      toolsCalled,
      partAdvanced,
      sessionEnded,
    };
  }

  async function handleToolCall(
    name: string,
    argsJson: string,
  ): Promise<string> {
    let input: Record<string, unknown> = {};
    try {
      const result = z.record(z.string(), z.unknown()).safeParse(JSON.parse(argsJson));
      if (result.success) {
        input = result.data;
      }
    } catch {
      // empty args
    }

    const result = await dispatchTool({
      toolName: name,
      input,
      question,
      session,
      solutionPath,
      logger,
      timer,
      reflectionOptions: options.reflectionOptions,
      recentTranscript: getTranscriptWindow(session.db, 20),
      codeSnapshot: lastCodeSnapshot,
    });

    insertTranscript(session.db, "tool_call", name, { tool: name, args: argsJson });
    insertTranscript(session.db, "tool_result", result, { tool: name });

    return result;
  }

  async function getSystemPrompt(): Promise<string> {
    const currentPart = getCurrentPart();
    if (!currentPart) return "Interview complete.";

    const codeSnapshot = await readCodeSnapshot();

    let reflections: Reflection[] = [];
    if (options.reflectionQueue !== undefined) {
      reflections = options.reflectionQueue.peek(5);
    }

    const recentTranscript = getTranscriptWindow(session.db, 20);

    const personaPrompt = buildLeetcodeSystemPrompt({
      question,
      currentPart,
      totalParts: question.parts.length,
      timerDisplay: timer.getDisplayTime(),
      timerPhase: timer.getPhase(),
      hintsGiven: session.metadata.hintsGiven,
      testsRun: session.metadata.testsRun,
      recentTranscript,
      codeSnapshot,
    });

    const builtContext = buildContext({
      question,
      currentPart,
      totalParts: question.parts.length,
      timerDisplay: timer.getDisplayTime(),
      timerPhase: timer.getPhase(),
      hintsGiven: session.metadata.hintsGiven,
      testsRun: session.metadata.testsRun,
      recentTranscript,
      codeSnapshot,
      reflections,
      personaPrompt,
    });

    return builtContext.systemPrompt;
  }

  async function close(): Promise<SessionReport> {
    if (codeWatchInterval !== null) {
      clearInterval(codeWatchInterval);
      codeWatchInterval = null;
    }

    session.metadata.status = "completed";
    session.metadata.endedAt = new Date().toISOString();
    session.metadata.timer = timer.getState();
    await saveSession(session);

    insertEvent(session.db, "session_end", {
      duration_s: Math.floor(timer.getElapsedMs() / 1000),
      hintsGiven: session.metadata.hintsGiven,
      testsRun: session.metadata.testsRun,
    });

    const report = generateReport(session.db, session.metadata);
    return report;
  }

  return {
    handleUserInput,
    handleToolCall,
    getSystemPrompt,
    close,
  };
}

function findImmediateNextMove(
  reflections: Reflection[],
): NextMovePayload | undefined {
  for (const r of reflections) {
    if (
      r.type === "next_move" &&
      r.nextMove?.condition === "immediate"
    ) {
      return r.nextMove;
    }
  }
  return undefined;
}
