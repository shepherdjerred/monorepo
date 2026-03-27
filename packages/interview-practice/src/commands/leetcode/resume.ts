import path from "node:path";
import { createInterface } from "node:readline/promises";
import type { Config } from "#config";
import { createLogger } from "#logger";
import { createAIClient } from "#lib/ai/client.ts";
import { loadSession } from "#lib/session/manager.ts";
import type { Session } from "#lib/session/manager.ts";
import { loadQuestionStore } from "#lib/questions/store.ts";
import type { LeetcodeQuestion } from "#lib/questions/schemas.ts";
import { createTimer } from "#lib/timer/countdown.ts";
import type { Timer } from "#lib/timer/countdown.ts";
import { createInterviewSession } from "#lib/ai/session-loop.ts";
import { insertEvent } from "#lib/db/events.ts";
import { getFileExtension, getSolutionFilename } from "#lib/questions/starter-code.ts";
import {
  formatInterviewerMessage,
} from "#lib/output/formatter.ts";
import { runInterviewLoop } from "./interview-loop.ts";

export type LeetcodeResumeOptions = {
  sessionId: string;
  exportReport?: string | undefined;
};

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes)}:${String(seconds).padStart(2, "0")}`;
}

function getApiKey(config: Config): string | undefined {
  if (config.aiProvider === "anthropic") return config.anthropicApiKey;
  if (config.aiProvider === "openai") return config.openaiApiKey;
  return config.googleApiKey;
}

export async function resumeLeetcodeSession(
  config: Config,
  options: LeetcodeResumeOptions,
): Promise<void> {
  const session = await loadSession(config.dataDir, options.sessionId);
  if (session === null) {
    console.error(`Session not found: ${options.sessionId}`);
    console.error(`Sessions are stored in: ${path.join(config.dataDir, "sessions")}`);
    process.exit(1);
  }

  if (session.metadata.status !== "in-progress") {
    console.error(`This session is ${session.metadata.status}.`);
    process.exit(1);
  }

  const logger = createLogger({
    level: config.logLevel,
    sessionId: session.metadata.id,
    logFilePath: path.join(session.workspacePath, "session.log"),
    component: "cli",
  });

  const questionsDir = path.join(config.dataDir, "questions", "leetcode");
  const store = await loadQuestionStore(questionsDir, logger);
  const question = store.getById(session.metadata.questionId);

  if (question === undefined) {
    console.error(`Question not found for session: ${session.metadata.questionId}`);
    process.exit(1);
  }

  const { timer, timerRestarted } = await promptTimerResume(session, config);

  logger.info("session_resume", {
    questionId: question.id,
    elapsedMs: session.metadata.timer.elapsedMs,
    timerRestarted,
  });

  insertEvent(session.db, "session_resume", {
    elapsedMs: session.metadata.timer.elapsedMs,
    timerRestarted,
  });

  const ext = getFileExtension(session.metadata.language);
  const solutionPath = path.join(session.workspacePath, getSolutionFilename(ext));

  const model = config.conversationModel ?? "claude-sonnet-4-6-20260217";
  const client = createAIClient(config.aiProvider, model, getApiKey(config));

  displayResumeHeader(session, question, timer);

  const interviewSession = createInterviewSession({
    client,
    session,
    question,
    timer,
    solutionPath,
    logger: logger.child("interviewer"),
  });

  const resumeResult = await interviewSession.handleUserInput(
    "[Session resumed. Welcome the candidate back and briefly recap where they were. Do not re-present the problem unless asked.]",
  );

  console.log(formatInterviewerMessage(resumeResult.aiText));

  await runInterviewLoop({
    interviewSession,
    session,
    question,
    timer,
    exportReport: options.exportReport,
  });

  session.db.close();
  logger.info("session_complete", {
    duration_s: Math.floor(timer.getElapsedMs() / 1000),
  });
}

async function promptTimerResume(
  session: Session,
  _config: Config,
): Promise<{ timer: Timer; timerRestarted: boolean }> {
  const elapsed = session.metadata.timer.elapsedMs;
  const rlPrompt = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await rlPrompt.question(
    `\nResume from [${formatElapsed(elapsed)} elapsed] or restart timer? (resume/restart) `,
  );
  rlPrompt.close();

  const durationMinutes = Math.ceil(session.metadata.timer.durationMs / 60_000);
  const timer = createTimer(durationMinutes);
  const timerRestarted = answer.trim().toLowerCase() === "restart";

  if (timerRestarted) {
    console.log("Timer restarted.");
  } else {
    timer.resume(session.metadata.timer);
    console.log(`Resuming from ${formatElapsed(elapsed)} elapsed.`);
  }

  return { timer, timerRestarted };
}

function displayResumeHeader(
  session: Session,
  question: LeetcodeQuestion,
  timer: Timer,
): void {
  console.log(`
\u001B[1m═══════════════════════════════════════════════════\u001B[0m
\u001B[1m  Resuming Interview Session\u001B[0m
\u001B[1m═══════════════════════════════════════════════════\u001B[0m

  Question:   ${question.title}
  Difficulty: ${question.difficulty}
  Language:   ${session.metadata.language}
  Part:       ${String(session.metadata.currentPart)}/${String(question.parts.length)}
  Timer:      ${timer.getDisplayTime()}

  \u001B[90mWorkspace: ${session.workspacePath}\u001B[0m
  \u001B[90mType /help for commands\u001B[0m
\u001B[1m═══════════════════════════════════════════════════\u001B[0m
`);
}

