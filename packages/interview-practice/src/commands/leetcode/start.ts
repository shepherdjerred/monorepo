import { join } from "node:path";
import type { Config } from "#config";
import { createLogger } from "#logger";
import { createAIClient } from "#lib/ai/client.ts";
import { createSession, saveSession } from "#lib/session/manager.ts";
import { scaffoldLeetcodeWorkspace } from "#lib/session/workspace.ts";
import { loadQuestionStore } from "#lib/questions/store.ts";
import { createTimer } from "#lib/timer/countdown.ts";
import { runInterviewerTurn } from "#lib/ai/interviewer.ts";
import { insertEvent } from "#lib/db/events.ts";
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
  const questionsDir = join(config.dataDir, "questions", "leetcode");

  // Temporary logger for startup
  const tempLogger = createLogger({
    level: config.logLevel,
    sessionId: "startup",
    logFilePath: join(config.dataDir, "startup.log"),
    component: "cli",
  });

  // Load question store
  const store = loadQuestionStore(questionsDir, tempLogger);

  // Select question
  const question = options.question
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
  const session = createSession({
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
    logFilePath: join(session.workspacePath, "session.log"),
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
  const { solutionPath } = scaffoldLeetcodeWorkspace(
    session.workspacePath,
    question,
    options.language,
    1,
  );

  // Create AI client
  const model = config.conversationModel ?? "claude-sonnet-4-6-20260217";
  const client = createAIClient(
    config.aiProvider,
    model,
    config.anthropicApiKey,
  );

  // Create timer
  const timer = createTimer(timeMinutes);

  // Display session start
  console.log(
    formatSessionStart(
      question.title,
      question.difficulty,
      options.language,
      session.workspacePath,
      timeMinutes,
    ),
  );

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
        saveSession(session);
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
            onTimerWarning: () => {},
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
            `\u001B[32mAdvanced to Part ${session.metadata.currentPart}/${question.parts.length}\u001B[0m`,
          );
        }

        if (result.sessionEnded) {
          running = false;
          session.metadata.status = "completed";
          session.metadata.endedAt = new Date().toISOString();
          saveSession(session);
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
