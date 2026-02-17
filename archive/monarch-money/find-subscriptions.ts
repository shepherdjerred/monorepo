#!/usr/bin/env bun

import { Database } from "bun:sqlite";

const db = new Database("transactions.db");

// Find subscriptions using statistical patterns (no hardcoded list)
const subscriptions = db
  .query(
    `
  WITH merchant_data AS (
    SELECT
      merchant,
      category,
      COUNT(*) as transaction_count,
      ABS(AVG(amount)) as avg_amount,
      MIN(ABS(amount)) as min_amount,
      MAX(ABS(amount)) as max_amount,
      MIN(date) as earliest_date,
      MAX(date) as latest_date,
      -- Calculate coefficient of variation (std dev / mean) for consistency
      CASE
        WHEN COUNT(*) <= 1 THEN 0
        ELSE SQRT(
          AVG(amount * amount) - (AVG(amount) * AVG(amount))
        ) / ABS(AVG(amount))
      END as variation_coefficient,
      -- Days span
      CAST((julianday(MAX(date)) - julianday(MIN(date))) as INTEGER) as days_span,
      -- Estimated frequency (days between transactions on average)
      CASE
        WHEN COUNT(*) <= 1 THEN 0
        ELSE CAST((julianday(MAX(date)) - julianday(MIN(date))) as REAL) / (COUNT(*) - 1)
      END as avg_days_between
    FROM transactions
    WHERE amount < 0  -- Only charges (negative amounts)
      AND merchant IS NOT NULL
      AND merchant != ''
      AND merchant NOT IN ('Payment', 'Transfer', 'Deposit', 'Interest Charge', 'Interest Income')
    GROUP BY merchant
    HAVING COUNT(*) >= 2  -- At least 2 transactions
  ),
  scored_merchants AS (
    SELECT
      merchant,
      category,
      transaction_count,
      ROUND(avg_amount, 2) as avg_amount,
      ROUND(min_amount, 2) as min_amount,
      ROUND(max_amount, 2) as max_amount,
      earliest_date,
      latest_date,
      days_span,
      ROUND(variation_coefficient * 100, 1) as consistency_pct,
      ROUND(avg_days_between, 1) as avg_days_between,
      -- Subscription likelihood score
      CASE
        -- High-confidence: Known subscription categories with regular frequency
        WHEN category IN ('Software', 'Subscription') AND avg_days_between BETWEEN 25 AND 35 THEN 95
        -- Software/services with any regular frequency + good consistency
        WHEN category IN ('Software', 'Subscription', 'Entertainment')
          AND avg_days_between BETWEEN 5 AND 120 AND variation_coefficient < 0.3 THEN 90
        -- Exact same amount every month (0% variation) - very likely subscription (excluding bills/payments)
        WHEN variation_coefficient < 0.05 AND avg_days_between BETWEEN 28 AND 32 AND avg_amount >= 5
          AND category NOT IN ('Utilities', 'Gas & Electric', 'Phone', 'Loan Repayment', 'Education', 'Uncategorized')
          THEN 85
        -- Regular frequency + very consistent + not retail/food/bills
        WHEN variation_coefficient < 0.1 AND avg_days_between BETWEEN 25 AND 35
          AND category NOT IN ('Restaurants & Bars', 'Coffee Shops', 'Groceries', 'Shopping', 'Gas', 'Utilities',
                              'Gas & Electric', 'Phone', 'Loan Repayment', 'Education', 'Uncategorized', 'Parking & Tolls')
          THEN 80
        -- Exact same amount + weekly/monthly + not food/bills
        WHEN variation_coefficient < 0.02 AND avg_days_between BETWEEN 6 AND 90
          AND category NOT IN ('Restaurants & Bars', 'Coffee Shops', 'Groceries', 'Shopping', 'Gas', 'Utilities',
                              'Gas & Electric', 'Phone', 'Loan Repayment', 'Education', 'Uncategorized', 'Parking & Tolls')
          THEN 75
        ELSE 0
      END as subscription_score
    FROM merchant_data
    WHERE days_span >= 30  -- Recurring over at least 30 days
  )
  SELECT
    *,
    date(latest_date, '+' || ROUND(avg_days_between) || ' days') as estimated_next_charge
  FROM scored_merchants
  WHERE subscription_score > 0
    AND latest_date >= date('now', '-90 days')  -- Only active subs (charged in last 90 days)
  ORDER BY avg_amount DESC, latest_date DESC
`,
  )
  .all() as any[];

// Add special handling for cursor usage (sum all cursor charges and calculate true monthly average)
const cursorTotal = db
  .query(
    `
  SELECT
    SUM(ABS(amount)) as total,
    COUNT(*) as count,
    MAX(date) as latest_date,
    MIN(date) as earliest_date
  FROM transactions
  WHERE merchant LIKE '%Cursor%' AND amount < 0 AND date >= date('now', '-90 days')
`,
  )
  .get() as {
  total: number;
  count: number;
  latest_date: string;
  earliest_date: string;
} | null;

const cursorSubscription =
  cursorTotal && cursorTotal.total > 0
    ? {
        merchant: "Cursor (All charges)",
        category: "Software",
        avg_amount: cursorTotal.total / 3, // Total for last 90 days / 3 months
        latest_date: cursorTotal.latest_date,
        estimated_next_charge: "~30 days",
        transaction_count: cursorTotal.count,
        avg_days_between: 30,
      }
    : null;

// Remove cursor and known monthly items from main subscriptions list
const filteredSubscriptions = subscriptions.filter(
  (s) =>
    !s.merchant.includes("Cursor") &&
    !s.merchant.includes("Pagerduty") &&
    !s.merchant.includes("Cloudflare") &&
    !s.merchant.includes("Claude") &&
    !s.merchant.includes("New York Times") &&
    !s.merchant.includes("St Subscriptions"),
);

// Add back the known monthly ones (consolidate Claude variants and add NYT, St Subscriptions)
const monthlyToAdd = db
  .query(
    `
  SELECT
    CASE
      WHEN merchant LIKE '%Claude%' THEN 'Claude AI Subscription'
      WHEN merchant LIKE '%New York Times%' THEN 'New York Times'
      WHEN merchant LIKE '%St Subscriptions%' THEN 'Seattle Times (St Sub WA)'
      ELSE merchant
    END as merchant,
    category,
    SUM(ABS(amount)) / COUNT(*) as avg_amount,
    MAX(date) as latest_date,
    COUNT(*) as transaction_count,
    ROUND((julianday(MAX(date)) - julianday(MIN(date))) / (COUNT(*) - 1), 1) as avg_days_between,
    date(MAX(date), '+30 days') as estimated_next_charge
  FROM transactions
  WHERE (merchant IN ('Pagerduty', 'Cloudflare') OR merchant LIKE '%Claude%' OR merchant LIKE '%New York Times%' OR merchant LIKE '%St Subscriptions%')
    AND amount < 0
    AND date >= date('now', '-90 days')
  GROUP BY CASE
    WHEN merchant LIKE '%Claude%' THEN 'Claude AI Subscription'
    WHEN merchant LIKE '%New York Times%' THEN 'New York Times'
    WHEN merchant LIKE '%St Subscriptions%' THEN 'Seattle Times (St Sub WA)'
    ELSE merchant
  END
`,
  )
  .all() as any[];

const allSubscriptions = [...filteredSubscriptions, ...monthlyToAdd];
if (cursorSubscription) allSubscriptions.push(cursorSubscription as any);

// Add Seattle Anxiety - sum all charges instead of individual entries
const seattleTotal = db
  .query(
    `
  SELECT
    'Seattle Anxiety' as merchant,
    'Medical' as category,
    SUM(ABS(amount)) / COUNT(DISTINCT strftime('%Y-%m', date)) as avg_amount,
    MAX(date) as latest_date,
    COUNT(*) as transaction_count,
    30 as avg_days_between,
    date('now', '+30 days') as estimated_next_charge
  FROM transactions
  WHERE merchant LIKE '%Seattle%Anxiety%'
    AND amount < 0
    AND date >= date('now', '-90 days')
`,
  )
  .get() as any;

if (seattleTotal && seattleTotal.avg_amount > 0) {
  allSubscriptions.push(seattleTotal);
}

const finalSubscriptions = allSubscriptions;
finalSubscriptions.sort((a, b) => b.avg_amount - a.avg_amount);

console.log("💳 Active Subscriptions (sorted by price):\n");

if (finalSubscriptions.length === 0) {
  console.log("No subscriptions found.");
} else {
  console.log(
    `${"#".padEnd(3)} ${"Monthly".padEnd(10)} ${"Service".padEnd(30)} ${"Last Charged".padEnd(13)} ${"Est. Next Charge".padEnd(16)}\n`,
  );

  let total = 0;
  finalSubscriptions.forEach((sub, i) => {
    const nextCharge = sub.estimated_next_charge;
    console.log(
      `${(i + 1).toString().padEnd(3)} $${sub.avg_amount.toFixed(2).padStart(8)}  ${sub.merchant.substring(0, 28).padEnd(30)} ${sub.latest_date.padEnd(13)} ${nextCharge}`,
    );
    console.log(
      `   └─ ${sub.category} | ${sub.transaction_count}x | Every ~${sub.avg_days_between} days\n`,
    );
    total += sub.avg_amount;
  });

  console.log("-".repeat(70));
  console.log(`${"TOTAL".padEnd(3)} $${total.toFixed(2).padStart(8)}\n`);
}

// Show detected subscriptions that were charged recently
console.log("\n" + "=".repeat(70));
console.log("💳 Recent Charges from Detected Subscriptions (last 30 days):\n");

const detectedMerchants = subscriptions.map((s) => s.merchant);

if (detectedMerchants.length > 0) {
  const placeholders = detectedMerchants.map(() => "?").join(",");
  const recentSubs = db
    .query(
      `
    SELECT
      date,
      merchant,
      amount,
      category
    FROM transactions
    WHERE amount < 0
      AND date >= date('now', '-30 days')
      AND merchant IN (${placeholders})
    ORDER BY date DESC
  `,
    )
    .all(...detectedMerchants) as any[];

  if (recentSubs.length > 0) {
    recentSubs.forEach((txn) => {
      console.log(
        `${txn.date} | ${txn.merchant.padEnd(30)} | $${Math.abs(txn.amount).toFixed(2).padStart(8)} | ${txn.category}`,
      );
    });
  } else {
    console.log(
      "No recent charges from detected subscriptions in the last 30 days.",
    );
  }
} else {
  console.log("No subscriptions detected.");
}

db.close();
