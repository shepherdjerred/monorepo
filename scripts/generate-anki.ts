import { run } from "./lib/run.ts";
import { deckCommand } from "./migration-core.ts";

const DECKS = [
  "book_high_performance_web_applications",
  "book_ostep",
  "bytes",
  "interview",
];

export async function generateAnkiDecks(): Promise<void> {
  const cwd = `${import.meta.dir}/../packages/anki`;
  await Bun.write(
    `${cwd}/node_modules/sql.js/js/sql.js`,
    Bun.file(`${cwd}/node_modules/sql.js/js/sql-memory-growth.js`),
  );
  for (const deck of DECKS) {
    await run(deckCommand(deck), { cwd });
  }
}

if (import.meta.main) {
  await generateAnkiDecks();
}
