import path from "node:path";
import type { Config } from "#config";
import { createLogger } from "#logger";
import { createAIClient } from "#lib/ai/client.ts";
import { createSession } from "#lib/session/manager.ts";
import type { Session } from "#lib/session/manager.ts";
import { scaffoldLeetcodeWorkspace } from "#lib/session/workspace.ts";
import { loadQuestionStore } from "#lib/questions/store.ts";
import type { LeetcodeQuestion } from "#lib/questions/schemas.ts";
import { createTimer } from "#lib/timer/countdown.ts";
import type { Timer } from "#lib/timer/countdown.ts";
import { createInterviewSession } from "#lib/ai/session-loop.ts";
import type { InterviewSession } from "#lib/ai/session-loop.ts";
import { insertEvent } from "#lib/db/events.ts";
import { formatReport } from "#lib/report/generate.ts";
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

  const tempLogger = createLogger({
    level: config.logLevel,
    sessionId: "startup",
    logFilePath: path.join(config.dataDir, "startup.log"),
    component: "cli",
  });

  const store = await loadQuestionStore(questionsDir, tempLogger);

  const question = options.question !== undefined && options.question !== ""
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
    config.aiProvider === "anthropic" ? config.anthropicApiKey :
    config.aiProvider === "openai" ? config.openaiApiKey :
    config.googleApiKey;
  const client = createAIClient(
    config.aiProvider,
    model,
    apiKeyForProvider,
  );

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

type InterviewLoopOptions = {
  interviewSession: InterviewSession;
  session: Session;
  question: LeetcodeQuestion;
  timer: Timer;
};

async function runInterviewLoop(opts: InterviewLoopOptions): Promise<void> {
  const { interviewSession, session, question, timer } = opts;
  const rl = createReadline();
  let running = true;

  while (running) {
    const rawInput = await promptUser(rl);
    const command = parseCommand(rawInput);

    const warnings = timer.checkWarnings();
    for (const w of warnings) {
      console.log(formatTimerWarning(w));
    }

    switch (command.type) {
      case "quit": {
        running = false;

        const closingResult = await interviewSession.handleUserInput(
          "[Candidate is ending the session. Give a brief final assessment with scores.]",
        );
        console.log(formatInterviewerMessage(closingResult.aiText));

        const report = await interviewSession.close();
        console.log(formatReport(report));
        console.log(formatSessionEnd());
        break;
      }

      case "time":
        console.log(formatTimerDisplay(timer.getDisplayTime()));
        break;

      case "hint": {
        const result = await interviewSession.handleUserInput(
          "[Candidate is requesting a hint. Use the give_hint tool.]",
        );
        console.log(formatInterviewerMessage(result.aiText));
        break;
      }

      case "run": {
        const result = await interviewSession.handleUserInput(
          "[Candidate wants to run their solution. Use the run_tests tool, then comment on the results.]",
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

        const result = await interviewSession.handleUserInput(command.content);
        console.log(formatInterviewerMessage(result.aiText));

        if (result.partAdvanced) {
          console.log(
            `\u001B[32mAdvanced to Part ${String(session.metadata.currentPart)}/${String(question.parts.length)}\u001B[0m`,
          );
        }

        if (result.sessionEnded) {
          running = false;
          const report = await interviewSession.close();
          console.log(formatReport(report));
          console.log(formatSessionEnd());
        }
        break;
      }
    }
  }

  rl.close();
}
