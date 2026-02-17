#!/usr/bin/env bun

import { Database } from "bun:sqlite";

const db = new Database("transactions.db");

// Basic info
const count = db.query("SELECT COUNT(*) as count FROM transactions").get() as {
  count: number;
};
console.log(`📊 Total transactions: ${count.count}\n`);

// Date range
const dateRange = db
  .query(
    `
  SELECT MIN(date) as earliest, MAX(date) as latest
  FROM transactions
`,
  )
  .get() as { earliest: string; latest: string };
console.log(`📅 Date range: ${dateRange.earliest} to ${dateRange.latest}\n`);

// Summary stats
console.log("💰 Amount statistics:");
const amountStats = db
  .query(
    `
  SELECT
    SUM(amount) as total,
    AVG(amount) as average,
    MIN(amount) as min,
    MAX(amount) as max,
    COUNT(DISTINCT CASE WHEN amount > 0 THEN 1 END) as income_count,
    COUNT(DISTINCT CASE WHEN amount < 0 THEN 1 END) as expense_count
  FROM transactions
`,
  )
  .get() as any;

console.log(`  Total: $${amountStats.total?.toFixed(2) ?? "N/A"}`);
console.log(`  Average: $${amountStats.average?.toFixed(2) ?? "N/A"}`);
console.log(`  Min: $${amountStats.min?.toFixed(2) ?? "N/A"}`);
console.log(`  Max: $${amountStats.max?.toFixed(2) ?? "N/A"}`);
console.log(`  Income transactions: ${amountStats.income_count ?? 0}`);
console.log(`  Expense transactions: ${amountStats.expense_count ?? 0}\n`);

// Top categories
console.log("🏷️  Top 10 categories by transaction count:");
const categories = db
  .query(
    `
  SELECT category, COUNT(*) as count, SUM(amount) as total
  FROM transactions
  WHERE category IS NOT NULL AND category != ''
  GROUP BY category
  ORDER BY count DESC
  LIMIT 10
`,
  )
  .all() as any[];

categories.forEach((cat, i) => {
  console.log(
    `  ${i + 1}. ${cat.category}: ${cat.count} transactions ($${cat.total?.toFixed(2) ?? "0"})`,
  );
});
console.log();

// Top merchants
console.log("🏪 Top 15 merchants:");
const merchants = db
  .query(
    `
  SELECT merchant, COUNT(*) as count, SUM(amount) as total
  FROM transactions
  WHERE merchant IS NOT NULL AND merchant != ''
  GROUP BY merchant
  ORDER BY count DESC
  LIMIT 15
`,
  )
  .all() as any[];

merchants.forEach((m, i) => {
  console.log(
    `  ${i + 1}. ${m.merchant}: ${m.count} transactions ($${m.total?.toFixed(2) ?? "0"})`,
  );
});
console.log();

// Accounts
console.log("🏦 Accounts:");
const accounts = db
  .query(
    `
  SELECT account, COUNT(*) as count, SUM(amount) as total
  FROM transactions
  WHERE account IS NOT NULL AND account != ''
  GROUP BY account
  ORDER BY total DESC
`,
  )
  .all() as any[];

accounts.forEach((acc, i) => {
  console.log(
    `  ${i + 1}. ${acc.account}: ${acc.count} transactions ($${acc.total?.toFixed(2) ?? "0"})`,
  );
});

db.close();
