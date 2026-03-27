import path from "node:path";
import type { Config } from "#config";
import { createLogger } from "#logger";
import { createAIClient } from "#lib/ai/client.ts";
import { createSession, saveSession } from "#lib/session/manager.ts";
import { scaffoldLeetcodeWorkspace } from "#lib/session/workspace.ts";
import { loadQuestionStore } from "#lib/questions/store.ts";
import { createTimer } from "#lib/timer/countdown.ts";
import { runInterviewerTurn } from "#lib/ai/interviewer.ts";
import { insertEvent } from "#lib/db/events.ts";
import { generateReport, formatReport } from "#lib/report/generate.ts";
import {
  createReadline,
  promptUser,
  parseCommand,
  printHelp,
} from "#lib/input/prompt.ts";
import {
  formatInterviewerMessage,
  formatTimerWarning,
  formatTimerDisplay,
  formatSessionStart,
  formatSessionEnd,
} from "#lib/output/formatter.ts";
import { runVoiceSession } from "./voice.ts";

export type LeetcodeStartOptions = {
  difficulty?: "easy" | "medium" | "hard" | undefined;
  language: string;
  time?: number | undefined;
  voice: boolean;
  question?: string | undefined;
}

export async function startLeetcodeSession(
  config: Config,
  options: LeetcodeStartOptions,
): Promise<void> {
  const questionsDir = path.join(config.dataDir, "questions", "leetcode");

  // Temporary logger for startup
  const tempLogger = createLogger({
    level: config.logLevel,
    sessionId: "startup",
    logFilePath: path.join(config.dataDir, "startup.log"),
    component: "cli",
  });

  // Load question store
  const store = await loadQuestionStore(questionsDir, tempLogger);

  // Select question
  const question = options.question !== undefined && options.question !== ""
    ? store.getBySlug(options.question)
    : store.getRandom({ difficulty: options.difficulty });

  if (!question) {
    console.error(
      `No questions found${options.difficulty ? ` for difficulty "${options.difficulty}"` : ""}. Add questions to ${questionsDir}`,
    );
    process.exit(1);
  }

  // Create session
  const timeMinutes = options.time ?? config.leetcodeTimeMinutes;
  const session = await createSession({
    dataDir: config.dataDir,
    question,
    language: options.language,
    durationMinutes: timeMinutes,
    voiceEnabled: options.voice,
  });

  // Create session-scoped logger
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

  // Scaffold workspace
  const { solutionPath } = await scaffoldLeetcodeWorkspace(
    session.workspacePath,
    question,
    options.language,
    1,
  );

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

  // Create timer
  const timer = createTimer(timeMinutes);

  // Display session start
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

  // Get initial interviewer message
  const introResult = await runInterviewerTurn(
    "[Session started. Introduce yourself and present the problem.]",
    {
      client,
      session,
      question,
      timer,
      solutionPath,
      logger: logger.child("interviewer"),
      onOutput: (text) => process.stdout.write(text),
      onTimerWarning: (w) => { console.log(formatTimerWarning(w)); },
    },
  );

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
          hintsGiven: session.metadata.hintsGiven,
          testsRun: session.metadata.testsRun,
        });

        // Get closing remarks
        const closingResult = await runInterviewerTurn(
          "[Candidate is ending the session. Give a brief final assessment with scores.]",
          {
            client,
            session,
            question,
            timer,
            solutionPath,
            logger: logger.child("interviewer"),
            onOutput: (text) => process.stdout.write(text),
            onTimerWarning: (_w: string) => { /* closing remarks -- no timer warnings */ },
          },
        );
        console.log(formatInterviewerMessage(closingResult.aiText));

        // Show post-session report
        const report = generateReport(session.db, session.metadata);
        console.log(formatReport(report));

        console.log(formatSessionEnd());
        break;
      }

      case "time":
        console.log(formatTimerDisplay(timer.getDisplayTime()));
        break;

      case "hint": {
        const result = await runInterviewerTurn(
          "[Candidate is requesting a hint. Use the give_hint tool.]",
          {
            client,
            session,
            question,
            timer,
            solutionPath,
            logger: logger.child("interviewer"),
            onOutput: (text) => process.stdout.write(text),
            onTimerWarning: (w) => { console.log(formatTimerWarning(w)); },
          },
        );
        console.log(formatInterviewerMessage(result.aiText));
        break;
      }

      case "run": {
        const result = await runInterviewerTurn(
          "[Candidate wants to run their solution. Use the run_tests tool, then comment on the results.]",
          {
            client,
            session,
            question,
            timer,
            solutionPath,
            logger: logger.child("interviewer"),
            onOutput: (text) => process.stdout.write(text),
            onTimerWarning: (w) => { console.log(formatTimerWarning(w)); },
          },
        );
        console.log(formatInterviewerMessage(result.aiText));
        break;
      }

      case "score":
        console.log(
          "\u001B[90mScore is provided at the end of the session. Use /quit to end.\u001B[0m",
        );
        break;

      case "text": {
        if (command.content === "/help" || command.content === "help") {
          printHelp();
          break;
        }

        const result = await runInterviewerTurn(command.content, {
          client,
          session,
          question,
          timer,
          solutionPath,
          logger: logger.child("interviewer"),
          onOutput: (text) => process.stdout.write(text),
          onTimerWarning: (w) => { console.log(formatTimerWarning(w)); },
        });

        console.log(formatInterviewerMessage(result.aiText));

        if (result.partAdvanced) {
          console.log(
            `\u001B[32mAdvanced to Part ${String(session.metadata.currentPart)}/${String(question.parts.length)}\u001B[0m`,
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
  logger.info("session_complete", {
    duration_s: Math.floor(timer.getElapsedMs() / 1000),
  });
}
