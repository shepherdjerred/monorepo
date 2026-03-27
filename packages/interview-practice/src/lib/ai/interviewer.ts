import type { AIClient, Message } from "./client.ts";
import type { LeetcodeQuestion, QuestionPart } from "#lib/questions/schemas.ts";
import type { Timer } from "#lib/timer/countdown.ts";
import type { Session } from "#lib/session/manager.ts";
import type { Logger } from "#logger";
import {
  insertTranscript,
  getTranscriptWindow,
  type TranscriptEntry,
} from "#lib/db/transcript.ts";
import { insertEvent } from "#lib/db/events.ts";
import { saveSession } from "#lib/session/manager.ts";
import { updateProblemForNewPart } from "#lib/session/workspace.ts";
import { runTests } from "#lib/testing/runner.ts";
import { getLeetcodeTools } from "./tools.ts";
import {
  buildLeetcodeSystemPrompt,
  buildTranscriptMessages,
} from "./prompts/leetcode-system.ts";
import type { ReflectionQueue, Reflection, NextMovePayload } from "./reflection-queue.ts";
import type { ReflectionLoopOptions } from "./reflection.ts";
import { pauseAndThink, triggerReflection } from "./reflection.ts";
import { buildContext } from "./context-builder.ts";

export type InterviewerOptions = {
  client: AIClient;
  session: Session;
  question: LeetcodeQuestion;
  timer: Timer;
  solutionPath: string;
  logger: Logger;
  onOutput: (text: string) => void;
  onTimerWarning: (warning: string) => void;
  reflectionQueue?: ReflectionQueue | undefined;
  reflectionOptions?: ReflectionLoopOptions | undefined;
};

export type TurnResult = {
  aiText: string;
  toolsCalled: string[];
  partAdvanced: boolean;
  sessionEnded: boolean;
};

export async function runInterviewerTurn(
  userInput: string,
  options: InterviewerOptions,
): Promise<TurnResult> {
  const { client, session, question, timer, solutionPath, logger } = options;
  const startTime = Date.now();

  // Write user input to transcript
  insertTranscript(session.db, "user", userInput);

  // Check timer warnings
  const warnings = timer.checkWarnings();
  for (const w of warnings) {
    options.onTimerWarning(w);
  }

  // Get current part
  const currentPart = question.parts.find(
    (p) => p.partNumber === session.metadata.currentPart,
  );
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
  let codeSnapshot: string | null = null;
  try {
    codeSnapshot = await Bun.file(solutionPath).text();
  } catch {
    // File may not exist yet
  }

  // Get recent transcript
  const recentTranscript = getTranscriptWindow(
    session.db,
    session.metadata.hintsGiven > 0 ? 25 : 20,
  );

  // Trigger background reflection for NEXT turn (change-driven)
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

  // Build context using context-builder with token budgets
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
  if (
    immediateNextMove?.action === "reveal_next_part"
  ) {
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
        currentPart,
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

  // Write AI response to transcript
  insertTranscript(session.db, "interviewer", response.text, {
    tokensIn: response.tokensIn,
    tokensOut: response.tokensOut,
    latencyMs,
  });

  // Record event
  insertEvent(session.db, "turn", {
    latencyMs,
    tokensIn: response.tokensIn,
    tokensOut: response.tokensOut,
    toolsCalled,
    timerPhase: timer.getPhase(),
    reflectionsUsed: reflections.length,
  });

  // Checkpoint timer and save session
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

async function handleRevealNextPart(
  input: Record<string, unknown>,
  question: LeetcodeQuestion,
  session: Session,
  logger: Logger,
): Promise<string | null> {
  const nextPartNum = session.metadata.currentPart + 1;
  const nextPart = question.parts.find((p) => p.partNumber === nextPartNum);
  if (!nextPart) return null;

  session.metadata.currentPart = nextPartNum;
  await updateProblemForNewPart(session.workspacePath, question, nextPartNum);

  insertEvent(session.db, "part_revealed", {
    partNumber: nextPartNum,
    totalParts: question.parts.length,
    reason: input["reason"],
  });

  logger.info("part_revealed", { partNumber: nextPartNum });

  return `Advanced to part ${String(nextPartNum)}/${String(question.parts.length)}. The candidate's problem.md has been updated. Present the new part: "${nextPart.prompt}"`;
}

type DispatchToolOptions = {
  toolName: string;
  input: Record<string, unknown>;
  currentPart: QuestionPart;
  question: LeetcodeQuestion;
  session: Session;
  solutionPath: string;
  logger: Logger;
  reflectionOptions?: ReflectionLoopOptions | undefined;
  timer: Timer;
  recentTranscript: TranscriptEntry[];
  codeSnapshot: string | null;
};

async function dispatchTool(opts: DispatchToolOptions): Promise<string> {
  const {
    toolName,
    input,
    currentPart,
    question,
    session,
    solutionPath,
    logger,
  } = opts;

  switch (toolName) {
    case "run_tests": {
      session.metadata.testsRun++;
      const result = await runTests(solutionPath, currentPart.testCases);

      insertEvent(session.db, "test_run", {
        passed: result.passed,
        failed: result.failed,
        total: result.total,
        compileError: result.compileError,
      });

      if (result.compileError !== null) {
        return `Compilation failed:\n${result.compileError}`;
      }

      const details = result.results
        .map((r, i) => {
          if (r.timedOut) return `Test ${String(i + 1)}: TIMEOUT`;
          if (r.passed) return `Test ${String(i + 1)}: PASSED`;
          return `Test ${String(i + 1)}: FAILED (expected "${r.expected}", got "${r.actual}")${r.stderr ? `\nStderr: ${r.stderr}` : ""}`;
        })
        .join("\n");

      return `Test results: ${String(result.passed)}/${String(result.total)} passed\n\n${details}`;
    }

    case "reveal_next_part": {
      const result = await handleRevealNextPart(
        input,
        question,
        session,
        logger,
      );
      return result ?? "No more parts — this is the final part of the problem.";
    }

    case "give_hint": {
      const level =
        typeof input["level"] === "string" ? input["level"] : "subtle";
      const availableHints = currentPart.hints.filter(
        (h) => h.level === level,
      );
      const hintIndex = Math.min(
        session.metadata.hintsGiven,
        availableHints.length - 1,
      );
      const hint = availableHints[Math.max(hintIndex, 0)];

      session.metadata.hintsGiven++;

      insertEvent(session.db, "hint_given", {
        level,
        hintIndex: session.metadata.hintsGiven,
        partNumber: session.metadata.currentPart,
      });

      if (!hint) {
        return `No ${level} hint available. Use your judgment to guide the candidate.`;
      }

      return `Hint (${level}): ${hint.content}\n\nFrame this naturally in conversation — do not read it verbatim.`;
    }

    case "pause_and_think": {
      if (opts.reflectionOptions === undefined) {
        return "Reflection model not configured. Proceeding without deep analysis.";
      }

      const reflections = await pauseAndThink(opts.reflectionOptions, {
        currentPart,
        totalParts: question.parts.length,
        timer: opts.timer,
        hintsGiven: session.metadata.hintsGiven,
        testsRun: session.metadata.testsRun,
        recentTranscript: opts.recentTranscript,
        codeSnapshot: opts.codeSnapshot,
      });

      if (reflections.length === 0) {
        return "Deep analysis complete. No new insights at this time. Continue with your current approach.";
      }

      const insights = reflections
        .map((r) => `[${r.type}] ${r.content}`)
        .join("\n");

      return `Deep analysis results:\n${insights}`;
    }

    default:
      return `Unknown tool: ${toolName}`;
  }
}
