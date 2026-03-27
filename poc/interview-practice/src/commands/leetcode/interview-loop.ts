import type { InterviewSession } from "#lib/ai/session-loop.ts";
import type { Session } from "#lib/session/manager.ts";
import type { LeetcodeQuestion } from "#lib/questions/schemas.ts";
import type { Timer } from "#lib/timer/countdown.ts";
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
  formatSessionEnd,
} from "#lib/output/formatter.ts";

export type InterviewLoopOptions = {
  interviewSession: InterviewSession;
  session: Session;
  question: LeetcodeQuestion;
  timer: Timer;
  exportReport?: string | undefined;
};

export async function runInterviewLoop(opts: InterviewLoopOptions): Promise<void> {
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

        if (opts.exportReport !== undefined) {
          const json = JSON.stringify(report, null, 2);
          await Bun.write(opts.exportReport, json);
          console.log(`Report exported to: ${opts.exportReport}`);
        }

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
