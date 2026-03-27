import type { AIClient, Message } from "./client.ts";
import type { LeetcodeQuestion, QuestionPart } from "#lib/questions/schemas.ts";
import type { Timer } from "#lib/timer/countdown.ts";
import type { Session } from "#lib/session/manager.ts";
import type { Logger } from "#logger";
import { insertTranscript, getTranscriptWindow } from "#lib/db/transcript.ts";
import { insertEvent } from "#lib/db/events.ts";
import { saveSession } from "#lib/session/manager.ts";
import { updateProblemForNewPart } from "#lib/session/workspace.ts";
import { runTests } from "#lib/testing/runner.ts";
import { getLeetcodeTools } from "./tools.ts";
import {
  buildLeetcodeSystemPrompt,
  buildTranscriptMessages,
} from "./prompts/leetcode-system.ts";

export type InterviewerOptions = {
  client: AIClient;
  session: Session;
  question: LeetcodeQuestion;
  timer: Timer;
  solutionPath: string;
  logger: Logger;
  onOutput: (text: string) => void;
  onTimerWarning: (warning: string) => void;
}

export type TurnResult = {
  aiText: string;
  toolsCalled: string[];
  partAdvanced: boolean;
  sessionEnded: boolean;
}

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

  // Read code snapshot
  let codeSnapshot: string | null = null;
  try {
    codeSnapshot = await Bun.file(solutionPath).text();
  } catch {
    // File may not exist yet
  }

  // Build context
  const recentTranscript = getTranscriptWindow(
    session.db,
    session.metadata.hintsGiven > 0 ? 25 : 20, // slightly more context when hints are active
  );

  const systemPrompt = buildLeetcodeSystemPrompt({
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

  const messages: Message[] = buildTranscriptMessages(recentTranscript);

  // Call the model
  const tools = getLeetcodeTools();
  let response = await client.chat({
    systemPrompt,
    messages,
    tools,
  });

  const toolsCalled: string[] = [];
  let partAdvanced = false;
  const sessionEnded = false;

  // Handle tool calls (may need multiple rounds)
  while (response.toolCalls.length > 0) {
    const toolResults: Message[] = [];

    for (const toolCall of response.toolCalls) {
      toolsCalled.push(toolCall.name);
      logger.info("tool_call", { tool: toolCall.name, input: toolCall.input });

      const result = await dispatchTool(
        toolCall.name,
        toolCall.input,
        currentPart,
        question,
        session,
        solutionPath,
        logger,
      );

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

      // Add tool result as a user message for the next model call
      toolResults.push({
        role: "user",
        content: `[Tool result for ${toolCall.name}]: ${result}`,
      });
    }

    // Continue the conversation with tool results
    response = await client.chat({
      systemPrompt,
      messages: [...messages, { role: "assistant", content: response.text }, ...toolResults],
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
  });

  // Checkpoint timer and save session
  session.metadata.timer = timer.getState();
  saveSession(session);

  logger.info("turn_complete", {
    latencyMs,
    tokensIn: response.tokensIn,
    tokensOut: response.tokensOut,
    toolsCalled,
  });

  return {
    aiText: response.text,
    toolsCalled,
    partAdvanced,
    sessionEnded,
  };
}

async function dispatchTool(
  toolName: string,
  input: Record<string, unknown>,
  currentPart: QuestionPart,
  question: LeetcodeQuestion,
  session: Session,
  solutionPath: string,
  logger: Logger,
): Promise<string> {
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

      if (result.compileError) {
        return `Compilation failed:\n${result.compileError}`;
      }

      const details = result.results
        .map((r, i) => {
          if (r.timedOut) return `Test ${i + 1}: TIMEOUT`;
          if (r.passed) return `Test ${i + 1}: PASSED`;
          return `Test ${i + 1}: FAILED (expected "${r.expected}", got "${r.actual}")${r.stderr ? `\nStderr: ${r.stderr}` : ""}`;
        })
        .join("\n");

      return `Test results: ${result.passed}/${result.total} passed\n\n${details}`;
    }

    case "reveal_next_part": {
      const nextPartNum = session.metadata.currentPart + 1;
      const nextPart = question.parts.find((p) => p.partNumber === nextPartNum);

      if (!nextPart) {
        return "No more parts — this is the final part of the problem.";
      }

      session.metadata.currentPart = nextPartNum;
      updateProblemForNewPart(
        session.workspacePath,
        question,
        nextPartNum,
      );

      insertEvent(session.db, "part_revealed", {
        partNumber: nextPartNum,
        totalParts: question.parts.length,
        reason: input["reason"],
      });

      logger.info("part_revealed", { partNumber: nextPartNum });

      return `Advanced to part ${nextPartNum}/${question.parts.length}. The candidate's problem.md has been updated. Present the new part: "${nextPart.prompt}"`;
    }

    case "give_hint": {
      const level = input["level"] as string;
      const availableHints = currentPart.hints.filter((h) => h.level === level);
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

    default:
      return `Unknown tool: ${toolName}`;
  }
}
