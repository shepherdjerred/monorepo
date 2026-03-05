import type { ProposedChange } from "./classifier/types.ts";
import type { EnrichmentStats } from "./enrichment/pipeline.ts";
import type { EnrichmentSuggestion } from "./knowledge/types.ts";
import type { UsageSummary } from "./usage.ts";

const NO_COLOR = Bun.env["NO_COLOR"] !== undefined;
function ansi(code: number, text: string): string {
  return NO_COLOR ? text : `\u001B[${String(code)}m${text}\u001B[0m`;
}
function green(t: string): string {
  return ansi(32, t);
}
function yellow(t: string): string {
  return ansi(33, t);
}
function cyan(t: string): string {
  return ansi(36, t);
}
function dim(t: string): string {
  return ansi(90, t);
}
function bold(t: string): string {
  return NO_COLOR ? t : `\u001B[1m${t}\u001B[0m`;
}

function padRight(str: string, width: number): string {
  if (str.length >= width) return str.slice(0, width);
  return str + " ".repeat(width - str.length);
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + "…";
}

export function displayTierBreakdown(
  tier1: number,
  tier2: number,
  tier3: number,
): void {
  console.log(`\n  Tier 1 (KB lookup):    ${bold(String(tier1))}`);
  console.log(`  Tier 2 (batch):        ${bold(String(tier2))}`);
  console.log(`  Tier 3 (agentic):      ${bold(String(tier3))}`);
}

export function displayEnrichmentStats(stats: EnrichmentStats): void {
  console.log("\n=== Enrichment Stats ===\n");

  const sources: [string, { matched: number; total: number }][] = [
    ["Amazon", stats.amazon],
    ["Venmo", stats.venmo],
    ["Bilt", stats.bilt],
    ["USAA", stats.usaa],
    ["SCL", stats.scl],
    ["Apple", stats.apple],
    ["Costco", stats.costco],
  ];

  for (const [name, rate] of sources) {
    if (rate.total === 0) continue;
    const pct =
      rate.total > 0 ? ((rate.matched / rate.total) * 100).toFixed(0) : "0";
    console.log(
      `  ${padRight(name, 8)} ${String(rate.matched)}/${String(rate.total)} matched (${pct}%)`,
    );
  }
}

export function displayChanges(changes: ProposedChange[]): void {
  const recategorizes = changes.filter((c) => c.type === "recategorize");
  const splits = changes.filter((c) => c.type === "split");
  const flags = changes.filter((c) => c.type === "flag");

  if (recategorizes.length > 0) {
    console.log("\n=== Proposed Category Changes ===\n");

    for (const c of recategorizes) {
      const proposed = green(truncate(c.proposedCategory, 18));
      console.log(
        `  ${c.transactionDate} | $${Math.abs(c.amount).toFixed(2).padStart(8)} | ` +
          `${padRight(truncate(c.merchantName, 24), 26)} ` +
          `${padRight(truncate(c.currentCategory, 16), 18)} → ${proposed} ` +
          dim(`(${c.confidence})`),
      );
    }
  }

  if (splits.length > 0) {
    console.log("\n=== Proposed Splits ===\n");

    for (const c of splits) {
      console.log(
        `  ${c.transactionDate} | $${Math.abs(c.amount).toFixed(2)} | ${c.merchantName} → SPLIT:`,
      );
      if (c.splits) {
        for (const s of c.splits) {
          console.log(
            `    ├─ ${truncate(s.itemName, 40)} | $${s.amount.toFixed(2)} → ${green(s.categoryName)}`,
          );
        }
      }
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

export type SummaryOptions = {
  totalTransactions: number;
  tier1Changes: number;
  tier2Changes: number;
  tier3Changes: number;
  flagged: number;
  enrichmentStats: EnrichmentStats;
};

export function displaySummary(options: SummaryOptions): void {
  const {
    totalTransactions,
    tier1Changes,
    tier2Changes,
    tier3Changes,
    flagged,
    enrichmentStats,
  } = options;

  const totalChanges = tier1Changes + tier2Changes + tier3Changes;
  const unchanged = totalTransactions - totalChanges;

  console.log("\n=== Summary ===\n");
  console.log(`  Total transactions:    ${String(totalTransactions)}`);
  console.log(`  Already correct:       ${String(unchanged)}`);
  console.log(`  Changes proposed:      ${bold(String(totalChanges))}`);
  console.log(`    Tier 1 (KB):         ${String(tier1Changes)}`);
  console.log(`    Tier 2 (batch):      ${String(tier2Changes)}`);
  console.log(`    Tier 3 (agentic):    ${String(tier3Changes)}`);
  console.log(`  Flagged for review:    ${String(flagged)}`);

  console.log(
    `  Tier distribution:     ${String(enrichmentStats.tier1Count)}/${String(enrichmentStats.tier2Count)}/${String(enrichmentStats.tier3Count)} (T1/T2/T3)`,
  );
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
      console.log(
        `    ├─ ${truncate(s.itemName, 40)} | $${s.amount.toFixed(2)} → ${green(s.categoryName)}`,
      );
    }
  } else if (change.type === "flag") {
    console.log(
      `  Proposed: ${yellow("FLAG")} (${change.reason ?? "ambiguous"})`,
    );
  } else {
    console.log(
      `  Proposed: ${green(change.proposedCategory)} ${dim(`(confidence: ${change.confidence})`)}`,
    );
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

export function displaySuggestions(suggestions: EnrichmentSuggestion[]): void {
  if (suggestions.length === 0) return;

  console.log("\n=== Enrichment Suggestions ===\n");

  for (const s of suggestions.slice(0, 10)) {
    const impactColor =
      s.impact === "high" ? cyan : s.impact === "medium" ? yellow : dim;
    const impactLabel = impactColor(`[${s.impact}]`);

    console.log(
      `  ${impactLabel} ${bold(s.merchantName)} (${String(s.transactionCount)} txns, $${s.totalAmount.toFixed(0)})`,
    );
    console.log(`    ${s.reason}`);
    console.log(`    → ${dim(s.suggestedAction)}`);
    console.log("");
  }

  if (suggestions.length > 10) {
    console.log(
      dim(`  ... and ${String(suggestions.length - 10)} more suggestions`),
    );
  }
}
