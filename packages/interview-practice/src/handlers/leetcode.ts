import { parseArgs } from "node:util";
import type { Config } from "#config";
import { startLeetcodeSession } from "#commands/leetcode/start.ts";
import { resumeLeetcodeSession } from "#commands/leetcode/resume.ts";
import { showLeetcodeHistory } from "#commands/leetcode/history.ts";

export async function handleLeetcodeCommand(
  subcommand: string | undefined,
  args: string[],
  config: Config,
): Promise<void> {
  switch (subcommand) {
    case "start":
      return handleStart(args, config);
    case "resume":
      return handleResume(args, config);
    case "history":
      return showLeetcodeHistory(config);
    case undefined:
      console.error("Usage: interview-practice leetcode [start|resume|history]");
      return process.exit(1);
    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      console.error("Usage: interview-practice leetcode [start|resume|history]");
      process.exit(1);
  }
}

function parseDifficulty(val: string | undefined): "easy" | "medium" | "hard" | undefined {
  if (val === "easy" || val === "medium" || val === "hard") return val;
  return undefined;
}

async function handleStart(args: string[], config: Config): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      difficulty: { type: "string", short: "d" },
      language: { type: "string", short: "l", default: "ts" },
      time: { type: "string", short: "t" },
      voice: { type: "boolean", default: false },
      question: { type: "string", short: "q" },
    },
    allowPositionals: true,
  });

  const difficulty = parseDifficulty(values.difficulty);

  await startLeetcodeSession(config, {
    difficulty,
    language: values.language,
    time: values.time === undefined ? undefined : Number.parseInt(values.time, 10),
    voice: values.voice,
    question: values.question,
  });
}

async function handleResume(args: string[], config: Config): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      "export-report": { type: "string" },
    },
    allowPositionals: true,
  });

  const sessionId = positionals[0];
  if (sessionId === undefined || sessionId === "") {
    console.error("Usage: interview-practice leetcode resume <session-id> [--export-report <path>]");
    process.exit(1);
  }

  await resumeLeetcodeSession(config, {
    sessionId,
    exportReport: values["export-report"],
  });
}
