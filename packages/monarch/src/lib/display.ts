import type { ProposedChange } from "./classifier/types.ts";
import type { MatchResult } from "./amazon/matcher.ts";
import type { VenmoMatchResult } from "./venmo/matcher.ts";
import type { AppleMatchResult } from "./apple/matcher.ts";
import type { CostcoMatchResult } from "./costco/matcher.ts";
import type { BiltMatch } from "./conservice/types.ts";
import type { WeekGroup } from "./monarch/weeks.ts";
import type { UsageSummary } from "./usage.ts";

const NO_COLOR = Bun.env["NO_COLOR"] !== undefined;
function ansi(code: number, text: string): string {
  return NO_COLOR ? text : `\u001B[${String(code)}m${text}\u001B[0m`;
}
function green(t: string): string { return ansi(32, t); }
function yellow(t: string): string { return ansi(33, t); }
function dim(t: string): string { return ansi(90, t); }

export function displayWeekChanges(
  changes: ProposedChange[],
  weekGroups: WeekGroup[],
): void {
  if (changes.length === 0) return;

  const recategorizes = changes.filter((c) => c.type === "recategorize");
  const flags = changes.filter((c) => c.type === "flag");

  if (recategorizes.length > 0) {
    console.log("\n=== Proposed Category Changes ===\n");

    // Group changes by week
    const changesByWeek = new Map<string, ProposedChange[]>();
    for (const c of recategorizes) {
      let weekKey = "unknown";
      for (const wg of weekGroups) {
        if (c.transactionDate >= wg.startDate && c.transactionDate <= wg.endDate) {
          weekKey = wg.weekKey;
          break;
        }
      }
      const list = changesByWeek.get(weekKey);
      if (list) {
        list.push(c);
      } else {
        changesByWeek.set(weekKey, [c]);
      }
    }

    for (const [weekKey, weekChanges] of changesByWeek) {
      const wg = weekGroups.find((w) => w.weekKey === weekKey);
      const dateRange = wg ? `${wg.startDate} to ${wg.endDate}` : weekKey;
      console.log(dim(`  --- ${weekKey} (${dateRange}) ---`));

      for (const c of weekChanges) {
        const proposed = green(truncate(c.proposedCategory, 18));
        console.log(
          `  ${c.transactionDate} | $${Math.abs(c.amount).toFixed(2).padStart(8)} | ` +
            `${padRight(truncate(c.merchantName, 24), 26)} ` +
            `${padRight(truncate(c.currentCategory, 16), 18)} → ${proposed} ` +
            dim(`(${c.confidence})`),
        );
      }
      console.log("");
    }
  }

  if (flags.length > 0) {
    console.log("\n=== Flagged for Review ===\n");
    for (const f of flags) {
      console.log(
        `  ${yellow(f.merchantName)} — ${f.reason ?? "ambiguous, needs manual review"}`,
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

export type SummaryOptions = {
  totalTransactions: number;
  weekChanges: ProposedChange[];
  amazonChanges: ProposedChange[];
  venmoChanges: ProposedChange[];
  biltChanges: ProposedChange[];
  usaaChanges: ProposedChange[];
  sclChanges: ProposedChange[];
  appleChanges: ProposedChange[];
  costcoChanges: ProposedChange[];
  matchResult: MatchResult | null;
  venmoMatchResult: VenmoMatchResult | null;
  appleMatchResult: AppleMatchResult | null;
  costcoMatchResult: CostcoMatchResult | null;
};

export function displaySummary(options: SummaryOptions): void {
  const { totalTransactions, weekChanges, amazonChanges, venmoChanges, biltChanges, usaaChanges, sclChanges, appleChanges, costcoChanges, matchResult, venmoMatchResult, appleMatchResult, costcoMatchResult } = options;
  const allChanges = [...weekChanges, ...amazonChanges, ...venmoChanges, ...biltChanges, ...usaaChanges, ...sclChanges, ...appleChanges, ...costcoChanges];
  const recategorizes = allChanges.filter(
    (c) => c.type === "recategorize",
  );
  const splits = allChanges.filter((c) => c.type === "split");
  const flags = allChanges.filter((c) => c.type === "flag");
  const unchanged = totalTransactions - allChanges.length;

  console.log("\n=== Summary ===\n");
  console.log(
    `  Total transactions analyzed: ${String(totalTransactions)}`,
  );
  console.log(
    `  Already correct:             ${String(unchanged)}`,
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

  if (venmoMatchResult !== null) {
    const total =
      venmoMatchResult.matched.length +
      venmoMatchResult.unmatchedTransactions.length;
    console.log(
      `  Venmo match rate:            ${String(venmoMatchResult.matched.length)}/${String(total)}`,
    );
  }

  if (biltChanges.length > 0) {
    console.log(
      `  Bilt splits:                 ${String(biltChanges.length)}`,
    );
  }

  if (usaaChanges.length > 0) {
    console.log(
      `  USAA splits:                 ${String(usaaChanges.length)}`,
    );
  }

  if (sclChanges.length > 0) {
    console.log(
      `  SCL recategorizations:       ${String(sclChanges.length)}`,
    );
  }

  if (appleMatchResult !== null) {
    const total =
      appleMatchResult.matched.length +
      appleMatchResult.unmatchedTransactions.length;
    console.log(
      `  Apple match rate:            ${String(appleMatchResult.matched.length)}/${String(total)}`,
    );
  }

  if (appleChanges.length > 0) {
    console.log(
      `  Apple recategorizations:     ${String(appleChanges.length)}`,
    );
  }

  if (costcoMatchResult !== null) {
    const total =
      costcoMatchResult.matched.length +
      costcoMatchResult.unmatchedTransactions.length;
    console.log(
      `  Costco match rate:           ${String(costcoMatchResult.matched.length)}/${String(total)}`,
    );
  }

  if (costcoChanges.length > 0) {
    console.log(
      `  Costco classifications:      ${String(costcoChanges.length)}`,
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

export function displayVenmoChanges(
  changes: ProposedChange[],
  matchResult: VenmoMatchResult | null,
): void {
  const venmoChanges = changes.filter((c) => c.type === "recategorize");
  if (venmoChanges.length === 0 && matchResult === null) return;

  console.log("\n=== Venmo Transactions ===\n");

  if (matchResult !== null) {
    const total = matchResult.matched.length + matchResult.unmatchedTransactions.length;
    const matchRate = total > 0
      ? ((matchResult.matched.length / total) * 100).toFixed(1)
      : "0";
    console.log(`Match rate: ${String(matchResult.matched.length)}/${String(total)} (${matchRate}%)`);
    console.log("");
  }

  for (const c of venmoChanges) {
    console.log(
      `  ${c.transactionDate} | $${Math.abs(c.amount).toFixed(2)} | ${truncate(c.merchantName, 40)} → ${green(c.proposedCategory)}`,
    );
  }
}

export function displayBiltChanges(
  changes: ProposedChange[],
  matches: BiltMatch[],
): void {
  if (changes.length === 0 && matches.length === 0) return;

  console.log("\n=== Bilt Transactions ===\n");
  console.log(`Matched ${String(matches.length)} Bilt payments to Conservice data\n`);

  for (const c of changes) {
    if (c.type === "split" && c.splits !== undefined) {
      console.log(
        `  ${c.transactionDate} | $${Math.abs(c.amount).toFixed(2)} | ${c.merchantName} → SPLIT:`,
      );
      for (const s of c.splits) {
        console.log(
          `    ├─ ${padRight(s.itemName, 20)} | $${s.amount.toFixed(2)} → ${green(s.categoryName)}`,
        );
      }
    } else {
      console.log(
        `  ${c.transactionDate} | $${Math.abs(c.amount).toFixed(2)} | ${c.merchantName} → ${green(c.proposedCategory)}`,
      );
    }
  }
}

export function displayUsaaChanges(changes: ProposedChange[]): void {
  if (changes.length === 0) return;

  console.log("\n=== USAA Insurance Splits ===\n");

  for (const c of changes) {
    if (c.type === "split" && c.splits !== undefined) {
      console.log(
        `  ${c.transactionDate} | $${Math.abs(c.amount).toFixed(2)} | ${c.merchantName} → SPLIT:`,
      );
      for (const s of c.splits) {
        console.log(
          `    ├─ ${padRight(s.itemName, 20)} | $${s.amount.toFixed(2)} → ${green(s.categoryName)}`,
        );
      }
    }
  }
}

export function displaySclChanges(changes: ProposedChange[]): void {
  if (changes.length === 0) return;

  console.log("\n=== Seattle City Light ===\n");

  for (const c of changes) {
    console.log(
      `  ${c.transactionDate} | $${Math.abs(c.amount).toFixed(2)} | ${c.merchantName} → ${green(c.proposedCategory)}`,
    );
  }
}

export function displayAppleChanges(
  changes: ProposedChange[],
  matchResult: AppleMatchResult | null,
): void {
  const appleChanges = changes.filter(
    (c) => c.type === "recategorize" || c.type === "split",
  );

  if (appleChanges.length === 0 && matchResult === null) return;

  console.log("\n=== Apple Transactions ===\n");

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

  for (const c of appleChanges) {
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

export function displayCostcoChanges(
  changes: ProposedChange[],
  matchResult: CostcoMatchResult | null,
): void {
  const costcoChanges = changes.filter(
    (c) => c.type === "recategorize" || c.type === "split",
  );

  if (costcoChanges.length === 0 && matchResult === null) return;

  console.log("\n=== Costco Transactions ===\n");

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

  for (const c of costcoChanges) {
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

function padRight(str: string, width: number): string {
  if (str.length >= width) return str.slice(0, width);
  return str + " ".repeat(width - str.length);
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + "…";
}
