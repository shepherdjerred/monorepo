import { homedir } from "node:os";
import path from "node:path";

const cacheDir = path.join(homedir(), ".monarch-cache");
const files = new Bun.Glob("transactions-*.json").scanSync(cacheDir);
const first = files.next().value;
if (!first) { console.log("No cache found"); process.exit(1); }

const data = await Bun.file(path.join(cacheDir, first)).json() as {
  transactions: {
    merchant: { name: string };
    amount: number;
    category: { name: string };
    plaidName: string;
    date: string;
  }[];
};
const txns = data.transactions;

type Group = { count: number; total: number; categories: Map<string, number>; plaidNames: Set<string>; dates: string[] };
const groups = new Map<string, Group>();

for (const t of txns) {
  const key = t.merchant.name;
  let g = groups.get(key);
  if (!g) {
    g = { count: 0, total: 0, categories: new Map(), plaidNames: new Set(), dates: [] };
    groups.set(key, g);
  }
  g.count++;
  g.total += Math.abs(t.amount);
  g.categories.set(t.category.name, (g.categories.get(t.category.name) ?? 0) + 1);
  if (t.plaidName) g.plaidNames.add(t.plaidName);
  g.dates.push(t.date);
}

const sorted = [...groups.entries()].sort((a, b) => b[1].total - a[1].total);

// Identify problematic patterns
console.log("=== MULTI-CATEGORY MERCHANTS (same merchant, different categories) ===\n");
for (const [name, g] of sorted) {
  if (g.categories.size > 1) {
    const cats = [...g.categories.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([c, n]) => `${c} (${String(n)})`)
      .join(", ");
    console.log(`  ${name.padEnd(35)} ${String(g.count).padStart(4)} txns  $${g.total.toFixed(2).padStart(10)}  → ${cats}`);
  }
}

console.log("\n=== GENERIC/AMBIGUOUS MERCHANTS (likely need integration or hints) ===\n");
const ambiguousPatterns = [
  "amazon", "amzn", "venmo", "zelle", "paypal", "cash app",
  "bilt", "square", "stripe", "google", "apple",
];
for (const [name, g] of sorted) {
  const lower = name.toLowerCase();
  if (ambiguousPatterns.some(p => lower.includes(p))) {
    const cats = [...g.categories.entries()]
      .map(([c, n]) => `${c} (${String(n)})`)
      .join(", ");
    const plaid = [...g.plaidNames].slice(0, 5).join("; ");
    console.log(`  ${name.padEnd(35)} ${String(g.count).padStart(4)} txns  $${g.total.toFixed(2).padStart(10)}  [${cats}]`);
    if (plaid) console.log(`    plaid: ${plaid}`);
  }
}

console.log("\n=== HIGH-VOLUME GENERIC CATEGORIES (Shopping, Uncategorized, General) ===\n");
const genericCategories = ["Shopping", "Uncategorized", "General Merchandise", "Service"];
const byCategory = new Map<string, { merchants: string[]; count: number; total: number }>();
for (const [name, g] of sorted) {
  for (const [cat, count] of g.categories) {
    if (genericCategories.some(gc => cat.toLowerCase().includes(gc.toLowerCase()))) {
      let entry = byCategory.get(cat);
      if (!entry) {
        entry = { merchants: [], count: 0, total: 0 };
        byCategory.set(cat, entry);
      }
      entry.merchants.push(`${name} (${String(count)})`);
      entry.count += count;
      entry.total += g.total * (count / g.count);
    }
  }
}
for (const [cat, entry] of byCategory) {
  console.log(`  ${cat}: ${String(entry.count)} txns, $${entry.total.toFixed(2)}`);
  for (const m of entry.merchants.slice(0, 15)) {
    console.log(`    - ${m}`);
  }
  if (entry.merchants.length > 15) console.log(`    ... and ${String(entry.merchants.length - 15)} more`);
}

console.log("\n=== P2P / PAYMENT APPS (need sender/receiver context) ===\n");
const p2pPatterns = ["venmo", "zelle", "cash app", "paypal"];
for (const [name, g] of sorted) {
  const lower = name.toLowerCase();
  if (p2pPatterns.some(p => lower.includes(p))) {
    const plaid = [...g.plaidNames].slice(0, 10).join("\n    ");
    console.log(`  ${name}: ${String(g.count)} txns, $${g.total.toFixed(2)}`);
    if (plaid) console.log(`    plaid names:\n    ${plaid}`);
    console.log();
  }
}

console.log("=== SUMMARY ===\n");
console.log(`  Total transactions: ${String(txns.length)}`);
console.log(`  Unique merchants: ${String(groups.size)}`);
const multiCat = sorted.filter(([, g]) => g.categories.size > 1);
console.log(`  Multi-category merchants: ${String(multiCat.length)}`);
const ambiguous = sorted.filter(([name]) => ambiguousPatterns.some(p => name.toLowerCase().includes(p)));
console.log(`  Ambiguous/platform merchants: ${String(ambiguous.length)}`);
