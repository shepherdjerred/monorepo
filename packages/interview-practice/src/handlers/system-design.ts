import { parseArgs } from "node:util";
import type { Config } from "#config";
import { startSystemDesignSession } from "#commands/system-design/start.ts";
import type { SystemDesignDifficulty } from "#lib/questions/schemas.ts";

export async function handleSystemDesignCommand(
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
    case undefined:
      console.error(
        "Usage: interview-practice system-design [start|resume]",
      );
      return process.exit(1);
    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      console.error(
        "Usage: interview-practice system-design [start|resume]",
      );
      process.exit(1);
  }
}

function parseDifficulty(
  val: string | undefined,
): SystemDesignDifficulty | undefined {
  if (
    val === "junior" ||
    val === "mid" ||
    val === "senior" ||
    val === "staff"
  ) {
    return val;
  }
  return undefined;
}

async function handleStart(args: string[], config: Config): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      difficulty: { type: "string", short: "d" },
      time: { type: "string", short: "t" },
      voice: { type: "boolean", default: false },
      question: { type: "string", short: "q" },
    },
    allowPositionals: true,
  });

  const difficulty = parseDifficulty(values.difficulty);

  await startSystemDesignSession(config, {
    difficulty,
    time:
      values.time === undefined
        ? undefined
        : Number.parseInt(values.time, 10),
    voice: values.voice,
    question: values.question,
  });
}
