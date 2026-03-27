import path from "node:path";
import type { Config } from "#config";
import { createLogger } from "#logger";
import { createAIClient } from "#lib/ai/client.ts";
import { createSession } from "#lib/session/manager.ts";
import { scaffoldLeetcodeWorkspace } from "#lib/session/workspace.ts";
import { loadQuestionStore } from "#lib/questions/store.ts";
import { createTimer } from "#lib/timer/countdown.ts";
import { createInterviewSession } from "#lib/ai/session-loop.ts";
import { insertEvent } from "#lib/db/events.ts";
import {
  formatInterviewerMessage,
  formatSessionStart,
} from "#lib/output/formatter.ts";
import { runVoiceSession } from "./voice.ts";
import { runInterviewLoop } from "./interview-loop.ts";

export type LeetcodeStartOptions = {
  difficulty?: "easy" | "medium" | "hard" | undefined;
  language: string;
  time?: number | undefined;
  voice: boolean;
  question?: string | undefined;
};

export async function startLeetcodeSession(
  config: Config,
  options: LeetcodeStartOptions,
): Promise<void> {
  const questionsDir = path.join(config.dataDir, "questions", "leetcode");

  const tempLogger = createLogger({
    level: config.logLevel,
    sessionId: "startup",
    logFilePath: path.join(config.dataDir, "startup.log"),
    component: "cli",
  });

  const store = await loadQuestionStore(questionsDir, tempLogger);

  const question =
    options.question !== undefined && options.question !== ""
      ? store.getBySlug(options.question)
      : store.getRandom({ difficulty: options.difficulty });

  if (!question) {
    console.error(
      `No questions found${options.difficulty ? ` for difficulty "${options.difficulty}"` : ""}. Add questions to ${questionsDir}`,
    );
    process.exit(1);
  }

  const timeMinutes = options.time ?? config.leetcodeTimeMinutes;
  const session = await createSession({
    dataDir: config.dataDir,
    question,
    difficulty: question.difficulty,
    language: options.language,
    durationMinutes: timeMinutes,
    voiceEnabled: options.voice,
  });

  const logger = createLogger({
    level: config.logLevel,
    sessionId: session.metadata.id,
    logFilePath: path.join(session.workspacePath, "session.log"),
    component: "cli",
  });

  logger.info("session_start", {
    questionId: question.id,
    questionTitle: question.title,
    difficulty: question.difficulty,
    language: options.language,
  });

  insertEvent(session.db, "session_start", {
    questionId: question.id,
    questionTitle: question.title,
    difficulty: question.difficulty,
    language: options.language,
    timeMinutes,
  });

  const { solutionPath } = await scaffoldLeetcodeWorkspace(
    session.workspacePath,
    question,
    options.language,
    1,
  );

  const model = config.conversationModel ?? "claude-sonnet-4-6-20260217";
  const apiKeyForProvider =
    config.aiProvider === "anthropic"
      ? config.anthropicApiKey
      : config.aiProvider === "openai"
        ? config.openaiApiKey
        : config.googleApiKey;
  const client = createAIClient(config.aiProvider, model, apiKeyForProvider);

  const timer = createTimer(timeMinutes);

  console.log(
    formatSessionStart({
      questionTitle: question.title,
      difficulty: question.difficulty,
      language: options.language,
      workspacePath: session.workspacePath,
      timeMinutes,
    }),
  );

  if (options.voice) {
    await runVoiceSession({
      config,
      session,
      question,
      timer,
      solutionPath,
      logger,
    });
    return;
  }

  const interviewSession = createInterviewSession({
    client,
    session,
    question,
    timer,
    solutionPath,
    logger: logger.child("interviewer"),
  });

  const introResult = await interviewSession.handleUserInput(
    "[Session started. Introduce yourself and present the problem.]",
  );
  console.log(formatInterviewerMessage(introResult.aiText));

  await runInterviewLoop({ interviewSession, session, question, timer });

  session.db.close();
  logger.info("session_complete", {
    duration_s: Math.floor(timer.getElapsedMs() / 1000),
  });
}
