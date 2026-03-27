import { parseArgs } from "node:util";
import type { Config } from "#config";
import { startLeetcodeSession } from "#commands/leetcode/start.ts";

export async function handleLeetcodeCommand(
  subcommand: string | undefined,
  args: string[],
  config: Config,
): Promise<void> {
  switch (subcommand) {
    case "start":
      return handleStart(args, config);
    case "resume":
      console.error("Resume not yet implemented (Phase 4)");
      return process.exit(1);
    case "history":
      console.error("History not yet implemented (Phase 4)");
      return process.exit(1);
    default:
      console.error(`Unknown subcommand: ${subcommand ?? "(none)"}`);
      console.error("Usage: interview-practice leetcode [start|resume|history]");
      process.exit(1);
  }
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

  const difficulty = values.difficulty as
    | "easy"
    | "medium"
    | "hard"
    | undefined;

  await startLeetcodeSession(config, {
    difficulty,
    language: values.language ?? "ts",
    time: values.time ? Number.parseInt(values.time, 10) : undefined,
    voice: values.voice ?? false,
    question: values.question,
  });
}
