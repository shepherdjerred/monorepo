import path from "node:path";
import { rename } from "node:fs/promises";
import { z } from "zod";

import { loadModelConfig } from "../src/engine/model-config.ts";
import {
  listMarkdownFiles,
  readFileSnapshot,
  writeFileAtomic,
} from "../src/engine/vault-files.ts";
import {
  LegacyTimeEntrySchema,
  migrateVaultFile,
  type LegacyTimeEntry,
} from "../src/migration/migrate.ts";

/**
 * P4 vault migration: make old-server files plugin-compatible.
 *
 *   bun run scripts/migrate-vault.ts <vault-path>            # dry-run (default)
 *   bun run scripts/migrate-vault.ts <vault-path> --apply    # write changes
 *
 * Idempotent: a second run reports zero changes. With --apply, the old
 * `_tasknotes/time-tracking.json` side-store is renamed to `.migrated`
 * after its entries are folded into frontmatter.
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

const TimeStoreSchema = z.object({
  entries: z.array(LegacyTimeEntrySchema).optional(),
});

async function loadSideStore(): Promise<Map<string, LegacyTimeEntry[]>> {
  const storePath = path.join(vaultPath, "_tasknotes", "time-tracking.json");
  const file = Bun.file(storePath);
  const byId = new Map<string, LegacyTimeEntry[]>();
  if (!(await file.exists())) return byId;
  const parsed = TimeStoreSchema.parse(await file.json());
  for (const entry of parsed.entries ?? []) {
    const bucket = byId.get(entry.taskId) ?? [];
    bucket.push(entry);
    byId.set(entry.taskId, bucket);
  }
  return byId;
}

const { config, source } = await loadModelConfig(vaultPath);
console.log(`[migrate] config source: ${source}`);
const sideStore = await loadSideStore();
console.log(
  `[migrate] side-store tasks with time entries: ${String(sideStore.size)}`,
);

const files = await listMarkdownFiles(vaultPath);
let changed = 0;
for (const relPath of files) {
  const absPath = path.join(vaultPath, relPath);
  const snapshot = await readFileSnapshot(absPath);
  if (snapshot === null) continue;
  const result = migrateVaultFile(
    snapshot.text,
    config,
    (id) => sideStore.get(id) ?? [],
  );
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

if (apply && sideStore.size > 0) {
  const storePath = path.join(vaultPath, "_tasknotes", "time-tracking.json");
  await rename(storePath, `${storePath}.migrated`);
  console.log("[migrate] side-store renamed to time-tracking.json.migrated");
}
if (!apply && changed > 0) {
  console.log("[migrate] dry-run only — re-run with --apply to write");
}
