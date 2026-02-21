import type { ProposedChange } from "./classifier/types.ts";
import type { MatchResult } from "./amazon/matcher.ts";
import type { UsageSummary } from "./usage.ts";

const NO_COLOR = Bun.env["NO_COLOR"] !== undefined;
function ansi(code: number, text: string): string {
  return NO_COLOR ? text : `\u001B[${String(code)}m${text}\u001B[0m`;
}
function green(t: string): string { return ansi(32, t); }
function yellow(t: string): string { return ansi(33, t); }
function dim(t: string): string { return ansi(90, t); }

export function displayMerchantChanges(changes: ProposedChange[]): void {
  const recategorizes = changes.filter((c) => c.type === "recategorize");
  const flags = changes.filter((c) => c.type === "flag");

  if (recategorizes.length > 0) {
    console.log("\n=== Proposed Category Changes ===\n");
    console.log(
      padRight("Merchant", 30) +
        padRight("Current", 20) +
        padRight("Proposed", 20) +
        padRight("Conf.", 8) +
        padRight("Count", 8) +
        "Amount",
    );
    console.log("-".repeat(100));

    for (const c of recategorizes) {
      const proposed = green(truncate(c.proposedCategory, 18));
      console.log(
        padRight(truncate(c.merchantName, 28), 30) +
          padRight(truncate(c.currentCategory, 18), 20) +
          padRight(proposed, 20 + (proposed.length - truncate(c.proposedCategory, 18).length)) +
          padRight(c.confidence, 8) +
          padRight("1", 8) +
          `$${Math.abs(c.amount).toFixed(2)}`,
      );
    }
  }

  if (flags.length > 0) {
    console.log("\n=== Flagged for Review ===\n");
    for (const f of flags) {
      console.log(
        `  ${yellow(f.merchantName)} — ${f.reason ?? "ambiguous merchant, needs manual review"}`,
      );
    }
  }
}

export function displayAmazonChanges(
  changes: ProposedChange[],
  matchResult: MatchResult | null,
): void {
  const amazonChanges = changes.filter(
    (c) => c.type === "recategorize" || c.type === "split",
  );

  if (amazonChanges.length === 0 && matchResult === null) return;

  console.log("\n=== Amazon Transactions ===\n");

  if (matchResult !== null) {
    const total =
      matchResult.matched.length +
      matchResult.unmatchedTransactions.length;
    const matchRate =
      total > 0
        ? ((matchResult.matched.length / total) * 100).toFixed(1)
        : "0";
    console.log(
      `Match rate: ${String(matchResult.matched.length)}/${String(total)} (${matchRate}%)`,
    );
    console.log("");
  }

  for (const c of amazonChanges) {
    if (c.type === "split" && c.splits !== undefined) {
      console.log(
        `  ${c.transactionDate} | $${Math.abs(c.amount).toFixed(2)} | ${c.merchantName} → SPLIT:`,
      );
      for (const s of c.splits) {
        console.log(
          `    ├─ ${truncate(s.itemName, 40)} | $${s.amount.toFixed(2)} → ${green(s.categoryName)}`,
        );
      }
    } else {
      console.log(
        `  ${c.transactionDate} | $${Math.abs(c.amount).toFixed(2)} | ${c.merchantName} → ${green(c.proposedCategory)}`,
      );
    }
  }
}

export function displaySummary(
  merchantChanges: ProposedChange[],
  amazonChanges: ProposedChange[],
  matchResult: MatchResult | null,
): void {
  const allChanges = [...merchantChanges, ...amazonChanges];
  const recategorizes = allChanges.filter(
    (c) => c.type === "recategorize",
  );
  const splits = allChanges.filter((c) => c.type === "split");
  const flags = allChanges.filter((c) => c.type === "flag");

  console.log("\n=== Summary ===\n");
  console.log(
    `  Total transactions analyzed: ${String(allChanges.length)}`,
  );
  console.log(
    `  Re-categorizations proposed: ${String(recategorizes.length)}`,
  );
  console.log(`  Splits proposed:             ${String(splits.length)}`);
  console.log(`  Flagged for review:          ${String(flags.length)}`);

  if (matchResult !== null) {
    const total =
      matchResult.matched.length +
      matchResult.unmatchedTransactions.length;
    console.log(
      `  Amazon match rate:           ${String(matchResult.matched.length)}/${String(total)}`,
    );
    console.log(
      `  Unmatched Amazon txns:       ${String(matchResult.unmatchedTransactions.length)}`,
    );
  }

  console.log("");
}

export function displaySingleChange(change: ProposedChange): void {
  const date = change.transactionDate;
  const merchant = change.merchantName;
  const amount = `$${Math.abs(change.amount).toFixed(2)}`;

  console.log(`\n--- ${date} | ${merchant} | ${amount}`);
  console.log(`  Current:  ${change.currentCategory}`);

  if (change.type === "split" && change.splits !== undefined) {
    console.log(`  Proposed: ${green("SPLIT")}`);
    for (const s of change.splits) {
      console.log(`    ├─ ${truncate(s.itemName, 40)} | $${s.amount.toFixed(2)} → ${green(s.categoryName)}`);
    }
  } else if (change.type === "flag") {
    console.log(`  Proposed: ${yellow("FLAG")} (${change.reason ?? "ambiguous"})`);
  } else {
    console.log(`  Proposed: ${green(change.proposedCategory)} ${dim(`(confidence: ${change.confidence})`)}`);
  }
}

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

export function displayUsageSummary(summary: UsageSummary): void {
  console.log("\n=== API Usage ===\n");
  console.log(`  Claude API calls:    ${String(summary.calls)}`);
  console.log(`  Input tokens:        ${formatNumber(summary.inputTokens)}`);
  console.log(`  Output tokens:       ${formatNumber(summary.outputTokens)}`);
  console.log(`  Estimated cost:      $${summary.estimatedCost.toFixed(4)}`);
  console.log("");
}

function padRight(str: string, width: number): string {
  if (str.length >= width) return str.slice(0, width);
  return str + " ".repeat(width - str.length);
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + "…";
}
