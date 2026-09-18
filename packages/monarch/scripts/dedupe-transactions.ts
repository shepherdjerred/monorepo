// Remove duplicate transactions created when an account re-link backfills
// history that an earlier connection already synced.
//
//   bun run scripts/dedupe-transactions.ts [--apply] [--batch-prefix 2295]
//
// Duplicate rule: within one account, transactions sharing (date, amount)
// where at least one copy's id starts with the backfill batch prefix and at
// least one copy's does not. Only backfill copies are deleted, at most as
// many as there are non-backfill twins, and only for transactions dated
// before the backfill event (a backfill copy is dated far before its
// creation; a genuinely new transaction created in the same id epoch is not).
//
// --apply first writes a JSON backup of every to-be-deleted transaction to
// the finance vault, then deletes.
import path from "node:path";
import {
  initMonarch,
  fetchAllTransactions,
  deleteTransaction,
} from "../src/lib/monarch/client.ts";
import { FINANCE_VAULT_DIR } from "../src/lib/finance-vault.ts";
import type { MonarchTransaction } from "../src/lib/monarch/types.ts";
import { log } from "../src/lib/logger.ts";

const APPLY = process.argv.includes("--apply");
const prefixArgIndex = process.argv.indexOf("--batch-prefix");
const BATCH_PREFIX =
  prefixArgIndex >= 0 ? (process.argv[prefixArgIndex + 1] ?? "2295") : "2295";
// The Dec 2025 re-link backfilled history dated up to Dec 8; live sync
// resumed Dec 9. Anything dated before this is unambiguous backfill.
const BACKFILL_DATE_CUTOFF = "2025-11-01";

await initMonarch();
const txns = await fetchAllTransactions("2021-01-01", "2026-12-31", true);

const groups = new Map<string, MonarchTransaction[]>();
for (const t of txns) {
  const key = `${t.account.id}|${t.date}|${String(t.amount)}`;
  groups.set(key, [...(groups.get(key) ?? []), t]);
}

const toDelete: MonarchTransaction[] = [];
for (const [, group] of groups) {
  if (group.length < 2 || group[0]?.amount === 0) continue;
  const backfill = group.filter(
    (t) => t.id.startsWith(BATCH_PREFIX) && t.date < BACKFILL_DATE_CUTOFF,
  );
  const synced = group.filter((t) => !t.id.startsWith(BATCH_PREFIX));
  if (backfill.length === 0 || synced.length === 0) continue;
  toDelete.push(...backfill.slice(0, Math.min(backfill.length, synced.length)));
}

toDelete.sort((a, b) => a.date.localeCompare(b.date));
const total = toDelete.reduce((s, t) => s + Math.abs(t.amount), 0);
console.log(
  `${String(toDelete.length)} backfill duplicates to delete ($${total.toFixed(2)} double-counted):`,
);
for (const t of toDelete.slice(0, 15)) {
  console.log(
    `  ${t.date} $${String(t.amount).padStart(9)} ${t.merchant.name.slice(0, 40)} (${t.account.displayName})`,
  );
}
if (toDelete.length > 15) {
  console.log(`  ... and ${String(toDelete.length - 15)} more`);
}

if (!APPLY) {
  console.log("\nDry run. Pass --apply to back up and delete.");
  process.exit(0);
}

const backupPath = path.join(
  FINANCE_VAULT_DIR,
  "backups",
  `monarch-duplicates-${new Date().toISOString().split("T")[0] ?? "unknown"}.json`,
);
await Bun.write(backupPath, `${JSON.stringify(toDelete, null, 2)}\n`);
console.log(
  `Backed up ${String(toDelete.length)} transactions to ${backupPath}`,
);

let deleted = 0;
for (const t of toDelete) {
  await deleteTransaction(t.id);
  deleted++;
  if (deleted % 50 === 0) {
    log.info(`Deleted ${String(deleted)}/${String(toDelete.length)}`);
  }
}
console.log(
  `Deleted ${String(deleted)}/${String(toDelete.length)} duplicates.`,
);
