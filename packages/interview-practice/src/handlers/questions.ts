import { join } from "node:path";
import type { Config } from "#config";
import { loadQuestionStore } from "#lib/questions/store.ts";
import { createLogger } from "#logger";

export async function handleQuestionsCommand(
  subcommand: string | undefined,
  _args: string[],
  config: Config,
): Promise<void> {
  switch (subcommand) {
    case "list":
      { handleList(config); return; }
    default:
      console.error(`Unknown subcommand: ${subcommand ?? "(none)"}`);
      console.error("Usage: interview-practice questions [list]");
      process.exit(1);
  }
}

function handleList(config: Config): void {
  const logger = createLogger({
    level: config.logLevel,
    sessionId: "cli",
    logFilePath: join(config.dataDir, "cli.log"),
    component: "cli",
  });

  const store = loadQuestionStore(
    join(config.dataDir, "questions", "leetcode"),
    logger,
  );

  const questions = store.getAll();

  if (questions.length === 0) {
    console.log("No questions found. Add JSON files to:");
    console.log(`  ${join(config.dataDir, "questions", "leetcode")}`);
    return;
  }

  console.log(`\n${"Slug".padEnd(30)} ${"Difficulty".padEnd(12)} ${"Parts".padEnd(8)} Tags`);
  console.log("-".repeat(80));

  for (const q of questions) {
    console.log(
      `${q.slug.padEnd(30)} ${q.difficulty.padEnd(12)} ${String(q.parts.length).padEnd(8)} ${q.tags.join(", ")}`,
    );
  }
  console.log(`\nTotal: ${questions.length} questions`);
}
