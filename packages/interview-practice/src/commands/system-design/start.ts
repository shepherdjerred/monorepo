import path from "node:path";
import type { Config } from "#config";
import { createLogger } from "#logger";
import { createAIClient } from "#lib/ai/client.ts";
import { createSession, saveSession } from "#lib/session/manager.ts";
import { loadSystemDesignQuestionStore } from "#lib/questions/store.ts";
import { createTimer } from "#lib/timer/countdown.ts";
import { insertEvent } from "#lib/db/events.ts";
import { insertTranscript, getTranscriptWindow } from "#lib/db/transcript.ts";
import { getSystemDesignTools } from "#lib/ai/tools.ts";
import {
  buildSystemDesignSystemPrompt,
  buildSystemDesignTranscriptMessages,
} from "#lib/ai/prompts/system-design-system.ts";
import type { SystemDesignPhase, SystemDesignQuestion } from "#lib/questions/schemas.ts";
import type { Session } from "#lib/session/manager.ts";
import type { AIClient, Message } from "#lib/ai/client.ts";
import type { Timer } from "#lib/timer/countdown.ts";
import type { Logger } from "#logger";
import {
  createReadline,
  promptUser,
  parseCommand,
} from "#lib/input/prompt.ts";
import {
  parsePhase,
  dispatchSystemDesignTool,
  printSystemDesignHelp,
} from "./tools.ts";
import {
  formatInterviewerMessage,
  formatTimerWarning,
  formatTimerDisplay,
  formatSessionStart,
  formatSessionEnd,
} from "#lib/output/formatter.ts";

export type SystemDesignStartOptions = {
  difficulty?: "junior" | "mid" | "senior" | "staff" | undefined;
  time?: number | undefined;
  voice: boolean;
  question?: string | undefined;
}

export async function startSystemDesignSession(
  config: Config,
  options: SystemDesignStartOptions,
): Promise<void> {
  const questionsDir = path.join(
    config.dataDir,
    "questions",
    "system-design",
  );

  const tempLogger = createLogger({
    level: config.logLevel,
    sessionId: "startup",
    logFilePath: path.join(config.dataDir, "startup.log"),
    component: "cli",
  });

  const store = await loadSystemDesignQuestionStore(questionsDir, tempLogger);

  const question =
    options.question !== undefined && options.question !== ""
      ? store.getBySlug(options.question)
      : store.getRandom({ difficulty: options.difficulty });

  if (!question) {
    console.error(
      `No system design questions found${options.difficulty === undefined ? "" : ` for difficulty "${options.difficulty}"`}. Add questions to ${questionsDir}`,
    );
    process.exit(1);
  }

  const timeMinutes = options.time ?? config.systemDesignTimeMinutes;
  const session = await createSession({
    dataDir: config.dataDir,
    question,
    difficulty: question.difficulty,
    language: "n/a",
    durationMinutes: timeMinutes,
    voiceEnabled: options.voice,
    type: "system-design",
  });

  const logger = createLogger({
    level: config.logLevel,
    sessionId: session.metadata.id,
    logFilePath: path.join(session.workspacePath, "session.log"),
    component: "cli",
  });

  logger.info("sd_session_start", {
    questionId: question.id,
    questionTitle: question.title,
    difficulty: question.difficulty,
    category: question.category,
  });

  insertEvent(session.db, "session_start", {
    questionId: question.id,
    questionTitle: question.title,
    difficulty: question.difficulty,
    category: question.category,
    timeMinutes,
    type: "system-design",
  });

  // Create AI client
  const model = config.conversationModel ?? "claude-sonnet-4-6-20260217";
  const apiKeyForProvider =
    config.aiProvider === "anthropic" ? config.anthropicApiKey :
    config.aiProvider === "openai" ? config.openaiApiKey :
    config.googleApiKey;
  const client = createAIClient(
    config.aiProvider,
    model,
    apiKeyForProvider,
  );

  const timer = createTimer(timeMinutes);

  // Track current phase
  let currentPhase: SystemDesignPhase = "requirements";

  console.log(
    formatSessionStart({
      questionTitle: question.title,
      difficulty: question.difficulty,
      language: "system-design",
      workspacePath: session.workspacePath,
      timeMinutes,
    }),
  );

  // Get initial interviewer message
  const introResult = await runSystemDesignTurn(
    "[Session started. Introduce yourself and present the system design problem. Ask the candidate to begin with requirements gathering.]",
    {
      client,
      session,
      question,
      timer,
      currentPhase,
      logger: logger.child("interviewer"),
    },
  );

  currentPhase = introResult.newPhase;
  console.log(formatInterviewerMessage(introResult.aiText));

  // Main interview loop
  const rl = createReadline();
  let running = true;

  while (running) {
    const rawInput = await promptUser(rl);
    const command = parseCommand(rawInput);

    switch (command.type) {
      case "quit": {
        running = false;
        session.metadata.status = "completed";
        session.metadata.endedAt = new Date().toISOString();
        session.metadata.timer = timer.getState();
        await saveSession(session);
        insertEvent(session.db, "session_end", {
          duration_s: Math.floor(timer.getElapsedMs() / 1000),
          finalPhase: currentPhase,
        });

        const closingResult = await runSystemDesignTurn(
          "[Candidate is ending the session. Give a brief final assessment with scores for each rubric dimension.]",
          {
            client,
            session,
            question,
            timer,
            currentPhase,
            logger: logger.child("interviewer"),
          },
        );
        console.log(formatInterviewerMessage(closingResult.aiText));
        console.log(formatSessionEnd());
        break;
      }

      case "time":
        console.log(formatTimerDisplay(timer.getDisplayTime()));
        break;

      case "hint": {
        const result = await runSystemDesignTurn(
          "[Candidate is requesting a hint. Use the give_hint tool.]",
          {
            client,
            session,
            question,
            timer,
            currentPhase,
            logger: logger.child("interviewer"),
          },
        );
        currentPhase = result.newPhase;
        console.log(formatInterviewerMessage(result.aiText));
        break;
      }

      case "run":
        console.log(
          "\u001B[90mSystem design interviews don't have runnable tests. Keep discussing your design.\u001B[0m",
        );
        break;

      case "score":
        console.log(
          "\u001B[90mScore is provided at the end of the session. Use /quit to end.\u001B[0m",
        );
        break;

      case "text": {
        if (command.content === "/help" || command.content === "help") {
          printSystemDesignHelp();
          break;
        }

        const result = await runSystemDesignTurn(command.content, {
          client,
          session,
          question,
          timer,
          currentPhase,
          logger: logger.child("interviewer"),
        });

        currentPhase = result.newPhase;
        console.log(formatInterviewerMessage(result.aiText));

        if (result.phaseTransitioned) {
          console.log(
            `\u001B[32mTransitioned to phase: ${currentPhase}\u001B[0m`,
          );
        }

        if (result.sessionEnded) {
          running = false;
          session.metadata.status = "completed";
          session.metadata.endedAt = new Date().toISOString();
          await saveSession(session);
          console.log(formatSessionEnd());
        }
        break;
      }
    }
  }

  rl.close();
  session.db.close();
  logger.info("sd_session_complete", {
    duration_s: Math.floor(timer.getElapsedMs() / 1000),
    finalPhase: currentPhase,
  });
}

// System design turn handling

type SystemDesignTurnOptions = {
  client: AIClient;
  session: Session;
  question: SystemDesignQuestion;
  timer: Timer;
  currentPhase: SystemDesignPhase;
  logger: Logger;
}

type SystemDesignTurnResult = {
  aiText: string;
  toolsCalled: string[];
  phaseTransitioned: boolean;
  newPhase: SystemDesignPhase;
  sessionEnded: boolean;
}

async function runSystemDesignTurn(
  userInput: string,
  options: SystemDesignTurnOptions,
): Promise<SystemDesignTurnResult> {
  const { client, session, question, timer, logger } = options;
  let currentPhase = options.currentPhase;
  const startTime = Date.now();

  insertTranscript(session.db, "user", userInput);

  const warnings = timer.checkWarnings();
  for (const w of warnings) {
    console.log(formatTimerWarning(w));
  }

  const recentTranscript = getTranscriptWindow(session.db, 25);

  const systemPrompt = buildSystemDesignSystemPrompt({
    question,
    currentPhase,
    timerDisplay: timer.getDisplayTime(),
    timerPhase: timer.getPhase(),
    recentTranscript,
    diagramSnapshot: null, // Excalidraw integration in Phase 2 Excalidraw task
  });

  const messages: Message[] =
    buildSystemDesignTranscriptMessages(recentTranscript);

  const tools = getSystemDesignTools();
  let response = await client.chat({
    systemPrompt,
    messages,
    tools,
  });

  const toolsCalled: string[] = [];
  let phaseTransitioned = false;
  let sessionEnded = false;

  while (response.toolCalls.length > 0) {
    const toolResults: Message[] = [];

    for (const toolCall of response.toolCalls) {
      toolsCalled.push(toolCall.name);
      logger.info("tool_call", {
        tool: toolCall.name,
        input: toolCall.input,
      });

      const result = dispatchSystemDesignTool({
        toolName: toolCall.name,
        input: toolCall.input,
        session,
        currentPhase,
        logger,
      });

      if (
        toolCall.name === "transition_phase" &&
        typeof toolCall.input["nextPhase"] === "string"
      ) {
        const parsed = parsePhase(toolCall.input["nextPhase"]);
        if (parsed !== null) {
          currentPhase = parsed;
          phaseTransitioned = true;
          if (parsed === "trade-offs") {
            sessionEnded = true;
          }
        }
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
      systemPrompt,
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
    currentPhase,
    type: "system-design",
  });

  session.metadata.timer = timer.getState();
  await saveSession(session);

  logger.info("sd_turn_complete", {
    latencyMs,
    tokensIn: response.tokensIn,
    tokensOut: response.tokensOut,
    toolsCalled,
    currentPhase,
  });

  return {
    aiText: response.text,
    toolsCalled,
    phaseTransitioned,
    newPhase: currentPhase,
    sessionEnded,
  };
}

