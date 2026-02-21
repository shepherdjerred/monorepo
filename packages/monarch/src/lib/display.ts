import type { ProposedChange } from "./classifier/types.ts";
import type { MatchResult } from "./amazon/matcher.ts";

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
      console.log(
        padRight(truncate(c.merchantName, 28), 30) +
          padRight(truncate(c.currentCategory, 18), 20) +
          padRight(truncate(c.proposedCategory, 18), 20) +
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
        `  ${f.merchantName} — ${f.reason ?? "ambiguous merchant, needs manual review"}`,
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
          `    ├─ ${truncate(s.itemName, 40)} | $${s.amount.toFixed(2)} → ${s.categoryName}`,
        );
      }
    } else {
      console.log(
        `  ${c.transactionDate} | $${Math.abs(c.amount).toFixed(2)} | ${c.merchantName} → ${c.proposedCategory}`,
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

function padRight(str: string, width: number): string {
  if (str.length >= width) return str.slice(0, width);
  return str + " ".repeat(width - str.length);
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + "…";
}
