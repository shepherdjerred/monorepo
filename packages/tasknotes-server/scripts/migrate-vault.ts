import path from "node:path";

import { loadModelConfig } from "../src/engine/model-config.ts";
import {
  listMarkdownFiles,
  readFileSnapshot,
  writeFileAtomic,
} from "../src/engine/vault-files.ts";
import { migrateVaultFile } from "../src/migration/migrate.ts";

/**
 * P4 vault migration: make old-server files plugin-compatible.
 *
 *   bun run scripts/migrate-vault.ts <vault-path>            # dry-run (default)
 *   bun run scripts/migrate-vault.ts <vault-path> --apply    # write changes
 *
 * Idempotent: a second run reports zero changes.
 */

const [vaultArg, ...flags] = process.argv.slice(2);
if (vaultArg === undefined) {
  console.error(
    "usage: bun run scripts/migrate-vault.ts <vault-path> [--apply]",
  );
  process.exit(2);
}
// Narrowed const: closures below don't inherit the guard's narrowing.
const vaultPath: string = vaultArg;
const apply = flags.includes("--apply");

const { config, source } = await loadModelConfig(vaultPath);
console.log(`[migrate] config source: ${source}`);

const files = await listMarkdownFiles(vaultPath);
let changed = 0;
for (const relPath of files) {
  const absPath = path.join(vaultPath, relPath);
  const snapshot = await readFileSnapshot(absPath);
  if (snapshot === null) continue;
  const result = migrateVaultFile(snapshot.text, config);
  if (!result.changed) continue;
  changed += 1;
  console.log(`[migrate] ${relPath}: ${result.actions.join("; ")}`);
  if (apply) {
    await writeFileAtomic(absPath, result.content);
  }
}

console.log(
  `[migrate] ${apply ? "applied" : "would change"} ${String(changed)} of ${String(files.length)} file(s)`,
);

if (!apply && changed > 0) {
  console.log("[migrate] dry-run only — re-run with --apply to write");
}
