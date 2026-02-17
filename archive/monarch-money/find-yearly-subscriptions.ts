#!/usr/bin/env bun

import { Database } from "bun:sqlite";

const db = new Database("transactions.db");

// Find yearly subscriptions using statistical patterns
const yearlySubscriptions = db
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
      -- Subscription likelihood score for yearly subscriptions
      CASE
        -- Yearly frequency (300-400 days) + consistent amounts
        WHEN avg_days_between BETWEEN 300 AND 400 AND variation_coefficient < 0.3 THEN 95
        -- Yearly pattern + good consistency
        WHEN avg_days_between BETWEEN 300 AND 400 AND variation_coefficient < 0.5 THEN 85
        -- Exact same amount every year (0% variation)
        WHEN variation_coefficient < 0.05 AND avg_days_between BETWEEN 300 AND 400 THEN 90
        -- Roughly yearly with consistency
        WHEN avg_days_between BETWEEN 250 AND 450 AND variation_coefficient < 0.2 THEN 75
        -- Semi-annual or less frequent but consistent, non-food
        WHEN avg_days_between BETWEEN 150 AND 250 AND variation_coefficient < 0.15
          AND category NOT IN ('Restaurants & Bars', 'Coffee Shops', 'Groceries', 'Shopping', 'Gas', 'Uncategorized')
          THEN 70
        -- Single transaction but software/subscription category + modest amount (likely yearly)
        WHEN transaction_count = 1 AND category IN ('Software', 'Subscription', 'Entertainment') AND avg_amount >= 10 THEN 75
        ELSE 0
      END as subscription_score
    FROM merchant_data
    WHERE (days_span >= 150 OR transaction_count = 1)  -- Recurring over 150+ days OR single recent charge
  )
  SELECT
    *,
    CASE
      WHEN transaction_count = 1 THEN date(latest_date, '+365 days')
      ELSE date(latest_date, '+' || ROUND(avg_days_between) || ' days')
    END as estimated_next_charge
  FROM scored_merchants
  WHERE subscription_score > 0
    AND category NOT IN ('Restaurants & Bars', 'Coffee Shops', 'Groceries', 'Shopping', 'Gas', 'Uncategorized', 'Transfer', 'Credit Card Payment', 'Parking & Tolls', 'Auto Payment')
    AND merchant NOT LIKE '%Claude%'  -- Claude is monthly, not yearly
    AND merchant NOT LIKE '%Pagerduty%'  -- Pagerduty is monthly
    AND merchant NOT LIKE '%Cursor%'  -- Cursor variants are monthly (aggregated elsewhere)
    AND merchant NOT LIKE '%Cloudflare%'  -- Cloudflare is monthly
    AND merchant NOT LIKE '%St Subscriptions%'  -- St Subscriptions (Seattle Times) is monthly
    AND merchant NOT LIKE '%Contexts%'  -- Contexts is one-time purchase
    AND latest_date >= date('now', '-500 days')  -- Active in last 500 days
  ORDER BY avg_amount DESC, latest_date DESC
`,
  )
  .all() as any[];

console.log("📅 Yearly Subscriptions (sorted by price):\n");

if (yearlySubscriptions.length === 0) {
  console.log("No yearly subscriptions found.");
} else {
  console.log(
    `${"#".padEnd(3)} ${"Yearly".padEnd(10)} ${"Service".padEnd(30)} ${"Last Charged".padEnd(13)} ${"Est. Next Charge".padEnd(16)}\n`,
  );

  let total = 0;
  yearlySubscriptions.forEach((sub, i) => {
    const nextCharge = sub.estimated_next_charge;
    console.log(
      `${(i + 1).toString().padEnd(3)} $${sub.avg_amount.toFixed(2).padStart(8)}  ${sub.merchant.substring(0, 28).padEnd(30)} ${sub.latest_date.padEnd(13)} ${nextCharge}`,
    );
    console.log(
      `   └─ ${sub.category} | ${sub.transaction_count}x | Every ~${sub.avg_days_between} days | Confidence: ${sub.subscription_score}%\n`,
    );
    total += sub.avg_amount;
  });

  console.log("-".repeat(70));
  console.log(`${"TOTAL".padEnd(3)} $${total.toFixed(2).padStart(8)}\n`);
}

console.log("\n" + "=".repeat(70));
console.log("📅 Recent Yearly Subscription Charges (last 200 days):\n");

const recentYearly = db
  .query(
    `
  SELECT
    date,
    merchant,
    amount,
    category
  FROM transactions
  WHERE amount < 0
    AND date >= date('now', '-200 days')
    AND merchant IN (${yearlySubscriptions.map(() => "?").join(",")})
  ORDER BY date DESC
`,
  )
  .all(...yearlySubscriptions.map((s) => s.merchant)) as any[];

if (recentYearly.length > 0) {
  recentYearly.forEach((txn) => {
    console.log(
      `${txn.date} | ${txn.merchant.padEnd(30)} | $${Math.abs(txn.amount).toFixed(2).padStart(8)} | ${txn.category}`,
    );
  });
} else {
  console.log("No recent charges from detected yearly subscriptions.");
}

db.close();
