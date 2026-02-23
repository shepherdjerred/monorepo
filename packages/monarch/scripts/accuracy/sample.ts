#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { homedir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { MonarchTransactionSchema } from "../../src/lib/monarch/types.ts";
import type { MonarchTransaction } from "../../src/lib/monarch/types.ts";
import {
  separateDeepPaths,
  fetchCategories,
  initMonarch,
} from "../../src/lib/monarch/client.ts";
import type { Dataset, SampledTransaction, DeepPath } from "./types.ts";

const TxnCacheSchema = z.object({
  cachedAt: z.string(),
  transactions: z.array(MonarchTransactionSchema),
});

const { values } = parseArgs({
  options: {
    count: { type: "string", default: "500" },
    seed: { type: "string", default: "42" },
  },
  strict: true,
});

const count = Number(values.count);
const seed = Number(values.seed);

// Load all cached transactions
const cacheDir = path.join(homedir(), ".monarch-cache");
const cacheFiles: string[] = [];
for (const file of new Bun.Glob("transactions-*.json").scanSync(cacheDir)) {
  cacheFiles.push(file);
}

if (cacheFiles.length === 0) {
  console.error("No transaction cache files found in ~/.monarch-cache/");
  process.exit(1);
}

const allTransactions: MonarchTransaction[] = [];
for (const file of cacheFiles) {
  const raw: unknown = await Bun.file(path.join(cacheDir, file)).json();
  const parsed = TxnCacheSchema.parse(raw);
  allTransactions.push(...parsed.transactions);
}

// Deduplicate by ID (multiple cache files may overlap)
const seen = new Set<string>();
const unique = allTransactions.filter((t) => {
  if (seen.has(t.id)) return false;
  seen.add(t.id);
  return true;
});

// Filter out splits and pending
const eligible = unique.filter((t) => !t.isSplitTransaction && !t.pending);
console.log(
  `Loaded ${String(unique.length)} unique transactions, ${String(eligible.length)} eligible (non-split, non-pending)`,
);

// Tag deep paths
const separated = separateDeepPaths(eligible);
const deepPathMap = new Map<string, DeepPath>();
for (const t of separated.amazonTransactions) deepPathMap.set(t.id, "amazon");
for (const t of separated.venmoTransactions) deepPathMap.set(t.id, "venmo");
for (const t of separated.biltTransactions) deepPathMap.set(t.id, "bilt");
for (const t of separated.usaaTransactions) deepPathMap.set(t.id, "usaa");
for (const t of separated.sclTransactions) deepPathMap.set(t.id, "scl");
for (const t of separated.appleTransactions) deepPathMap.set(t.id, "apple");
for (const t of separated.costcoTransactions) deepPathMap.set(t.id, "costco");
for (const t of separated.regularTransactions)
  deepPathMap.set(t.id, "regular");

// Fisher-Yates shuffle with seeded PRNG
function seededRandom(s: number): () => number {
  let state = s;
  return () => {
    state = (state * 1664525 + 1013904223) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

const rng = seededRandom(seed);
const shuffled = [...eligible];
for (let i = shuffled.length - 1; i > 0; i--) {
  const j = Math.floor(rng() * (i + 1));
  [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
}

const sampled = shuffled.slice(0, count);
console.log(`Sampled ${String(sampled.length)} transactions (seed=${String(seed)})`);

// Fetch categories from Monarch API
const monarchToken = Bun.env["MONARCH_TOKEN"];
if (monarchToken === undefined || monarchToken === "") {
  console.error("MONARCH_TOKEN environment variable is required");
  process.exit(1);
}
initMonarch(monarchToken);

console.log("Fetching categories from Monarch...");
const categories = await fetchCategories();

// Build dataset
const transactions: SampledTransaction[] = sampled.map((t) => ({
  id: t.id,
  date: t.date,
  amount: t.amount,
  merchantName: t.merchant.name,
  plaidName: t.plaidName,
  accountName: t.account.displayName,
  currentCategory: t.category.name,
  currentCategoryId: t.category.id,
  notes: t.notes,
  isRecurring: t.isRecurring,
  deepPath: deepPathMap.get(t.id) ?? "regular",
}));

const dataset: Dataset = {
  sampledAt: new Date().toISOString(),
  seed,
  transactions,
  labels: [],
  categories: categories.map((c) => ({
    id: c.id,
    name: c.name,
    group: c.group.name,
  })),
};

const outputPath = path.join(import.meta.dirname, "dataset.json");
await Bun.write(outputPath, JSON.stringify(dataset, null, 2));
console.log(`Written to ${outputPath}`);

// Print deep path breakdown
const pathCounts = new Map<string, number>();
for (const t of transactions) {
  pathCounts.set(t.deepPath, (pathCounts.get(t.deepPath) ?? 0) + 1);
}
console.log("\nDeep path breakdown:");
for (const [dp, n] of [...pathCounts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${dp.padEnd(10)} ${String(n)}`);
}
