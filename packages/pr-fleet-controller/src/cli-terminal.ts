import { HELP } from "./cli-help.ts";
import type { FleetController } from "./controller.ts";
import type { FleetObserver, FleetTelemetry } from "./ports.ts";
import type { TerminalLineResult } from "./terminal-loop.ts";

type TerminalController = Pick<
  FleetController,
  "answerOperatorQuestionWithText" | "questions" | "snapshot" | "tick"
>;

async function handleAnswer(
  line: string,
  controller: TerminalController,
): Promise<void> {
  const remainder = line.slice("/answer".length).trim();
  const separator = remainder.indexOf(" ");
  if (separator === -1) {
    process.stderr.write("Usage: /answer <request-id> <free-text answer>\n");
    return;
  }
  const requestId = remainder.slice(0, separator);
  const answer = remainder.slice(separator + 1).trim();
  if (answer.length === 0) {
    process.stderr.write("Operator answer cannot be empty\n");
    return;
  }
  try {
    await controller.answerOperatorQuestionWithText(requestId, answer);
  } catch (error) {
    process.stderr.write(
      `Answer rejected: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
}

export function createTerminalLineHandler(options: {
  controller: TerminalController;
  observer: FleetObserver;
  recorder: Pick<FleetTelemetry, "record">;
  sendSteering: (text: string) => void;
  isStopping: () => boolean;
}): (rawLine: string) => Promise<TerminalLineResult> {
  return async (rawLine) => {
    if (options.isStopping()) {
      return "stop";
    }
    const line = rawLine.trim();
    options.recorder.record("operator.input", { line });
    if (line === "/stop") {
      return "stop";
    }
    switch (line) {
      case "/status":
        options.observer.onSnapshot(options.controller.snapshot());
        break;
      case "/tick":
        await options.controller.tick("user");
        break;
      case "/questions":
        process.stdout.write(
          `${JSON.stringify(options.controller.questions(), null, 2)}\n`,
        );
        break;
      case "/help":
        process.stdout.write(`${HELP}\n`);
        break;
      default:
        if (line === "/answer" || line.startsWith("/answer ")) {
          await handleAnswer(line, options.controller);
        } else if (line.length > 0) {
          options.sendSteering(line);
        }
    }
    return "continue";
  };
}
