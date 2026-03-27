import path from "node:path";
import { parseArgs } from "node:util";
import type { Config } from "#config";
import { loadQuestionStore } from "#lib/questions/store.ts";
import { createLogger } from "#logger";
import { generateQuestion } from "#commands/questions/generate.ts";

export async function handleQuestionsCommand(
  subcommand: string | undefined,
  args: string[],
  config: Config,
): Promise<void> {
  switch (subcommand) {
    case "list": {
      await handleList(config);
      return;
    }
    case "generate": {
      await handleGenerate(args, config);
      return;
    }
    case undefined:
      console.error("Usage: interview-practice questions [list|generate]");
      return process.exit(1);
    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      console.error("Usage: interview-practice questions [list|generate]");
      process.exit(1);
  }
}

async function handleList(config: Config): Promise<void> {
  const logger = createLogger({
    level: config.logLevel,
    sessionId: "cli",
    logFilePath: path.join(config.dataDir, "cli.log"),
    component: "cli",
  });

  const store = await loadQuestionStore(
    path.join(config.dataDir, "questions", "leetcode"),
    logger,
  );

  const questions = store.getAll();

  if (questions.length === 0) {
    console.log("No questions found. Add JSON files to:");
    console.log(`  ${path.join(config.dataDir, "questions", "leetcode")}`);
    return;
  }

  console.log(
    `\n${"Slug".padEnd(30)} ${"Difficulty".padEnd(12)} ${"Parts".padEnd(8)} Tags`,
  );
  console.log("-".repeat(80));

  for (const q of questions) {
    console.log(
      `${q.slug.padEnd(30)} ${q.difficulty.padEnd(12)} ${String(q.parts.length).padEnd(8)} ${q.tags.join(", ")}`,
    );
  }
  console.log(`\nTotal: ${String(questions.length)} questions`);
}

async function handleGenerate(args: string[], config: Config): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      title: { type: "string", short: "t" },
      description: { type: "string", short: "d" },
      difficulty: { type: "string" },
      tags: { type: "string" },
      "out-dir": { type: "string", short: "o" },
    },
    allowPositionals: true,
  });

  if (values.title === undefined || values.title === "") {
    console.error(
      "Usage: interview-practice questions generate --title <title> --description <desc> [--difficulty easy|medium|hard] [--tags tag1,tag2] [--out-dir <path>]",
    );
    process.exit(1);
  }

  if (values.description === undefined || values.description === "") {
    console.error("--description is required");
    process.exit(1);
  }

  const difficulty = values.difficulty;
  const parsedDifficulty =
    difficulty === "easy" || difficulty === "medium" || difficulty === "hard"
      ? difficulty
      : undefined;

  const tags =
    values.tags !== undefined && values.tags !== ""
      ? values.tags.split(",").map((t) => t.trim())
      : undefined;

  await generateQuestion(config, {
    title: values.title,
    description: values.description,
    difficulty: parsedDifficulty,
    tags,
    outDir: values["out-dir"],
  });
}
