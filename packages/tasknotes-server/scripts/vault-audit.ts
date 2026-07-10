import path from "node:path";
import {
  parseTaskDocument,
  serializeMarkdownDocument,
} from "tasknotes-types/v2";

import { loadModelConfig } from "../src/engine/model-config.ts";
import { TaskRepository } from "../src/engine/task-repository.ts";
import {
  listMarkdownFiles,
  readFileSnapshot,
} from "../src/engine/vault-files.ts";

/**
 * P4 pre-deploy gate: audit a vault (run against a COPY of the real one).
 *
 *   bun run scripts/vault-audit.ts <vault-path>
 *
 * Reports:
 * 1. every task-like file the engine would SKIP (parse failures) — these
 *    would be invisible to the API;
 * 2. every task file whose no-op round-trip (parse → serialize with zero
 *    changes) is not byte-identical — these would churn under Obsidian
 *    Sync on the first write.
 * Exit code 1 if either list is non-empty; the gate is 100% clean.
 */

const [vaultArg] = process.argv.slice(2);
if (vaultArg === undefined) {
  console.error("usage: bun run scripts/vault-audit.ts <vault-path>");
  process.exit(2);
}
const vaultPath: string = vaultArg;

const { config, source } = await loadModelConfig(vaultPath);
console.log(`[audit] config source: ${source}`);

const repo = new TaskRepository(vaultPath, "", config);
await repo.scan();

const skipped = repo.skippedFiles();
for (const skip of skipped) {
  console.error(`[audit] SKIPPED ${skip.path}: ${skip.reason}`);
}

const files = await listMarkdownFiles(vaultPath);
const churny: string[] = [];
for (const relPath of files) {
  if (repo.get(relPath) === undefined) continue; // not a task file
  const snapshot = await readFileSnapshot(path.join(vaultPath, relPath));
  if (snapshot === null) continue;
  const doc = parseTaskDocument(snapshot.text, {
    path: relPath,
    fieldMapping: config.fieldMapping,
    storeTitleInFilename: config.storeTitleInFilename,
    userFields: config.userFields,
    statuses: config.statuses,
    priorities: config.priorities,
  });
  const roundTripped = serializeMarkdownDocument(doc.frontmatter, doc.body);
  if (roundTripped !== snapshot.text) {
    churny.push(relPath);
    console.error(`[audit] ROUND-TRIP DIFF ${relPath}`);
  }
}

console.log(
  `[audit] ${String(repo.list().length)} task(s), ` +
    `${String(skipped.length)} skipped, ` +
    `${String(churny.length)} round-trip diff(s) across ${String(files.length)} md file(s)`,
);

if (skipped.length > 0 || churny.length > 0) {
  process.exit(1);
}
console.log("[audit] clean");
