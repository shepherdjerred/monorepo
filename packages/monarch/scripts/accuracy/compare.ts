#!/usr/bin/env bun
import path from "node:path";
import type { Dataset, ComparisonResult } from "./types.ts";
import type { ProposedChange } from "../../src/lib/classifier/types.ts";

const datasetPath = path.join(import.meta.dirname, "dataset.json");
const toolOutputPath = path.join(import.meta.dirname, "tool-output.json");
const reportPath = path.join(import.meta.dirname, "accuracy-report.json");

const datasetFile = Bun.file(datasetPath);
if (!(await datasetFile.exists())) {
  console.error("dataset.json not found. Run sample.ts first.");
  process.exit(1);
}

const dataset: Dataset = (await datasetFile.json()) as Dataset;

if (dataset.labels.length === 0) {
  console.error("No labels found in dataset.json. Run label-server.ts and label some transactions first.");
  process.exit(1);
}

// Load tool output (proposed changes)
const toolOutputFile = Bun.file(toolOutputPath);
const toolChanges: ProposedChange[] = (await toolOutputFile.exists())
  ? ((await toolOutputFile.json()) as ProposedChange[])
  : [];

const changeMap = new Map<string, ProposedChange>();
for (const change of toolChanges) {
  changeMap.set(change.transactionId, change);
}

// Build transaction lookup
const txnMap = new Map(dataset.transactions.map((t) => [t.id, t]));

// Compare each labeled transaction
const results: ComparisonResult[] = [];

for (const label of dataset.labels) {
  const txn = txnMap.get(label.transactionId);
  if (!txn) continue;

  const change = changeMap.get(label.transactionId);
  const toolCategory = change ? change.proposedCategory : txn.currentCategory;
  const toolConfidence = change ? change.confidence : ("agreed" as const);

  const isCorrect =
    toolCategory.toLowerCase() === label.correctCategory.toLowerCase();
  const monarchWasCorrect =
    txn.currentCategory.toLowerCase() === label.correctCategory.toLowerCase();

  results.push({
    transactionId: label.transactionId,
    merchantName: txn.merchantName,
    amount: txn.amount,
    date: txn.date,
    deepPath: txn.deepPath,
    groundTruthCategory: label.correctCategory,
    toolCategory,
    toolConfidence,
    isCorrect,
    monarchWasCorrect,
  });
}

// === Metrics ===
const total = results.length;
const correct = results.filter((r) => r.isCorrect).length;
const monarchCorrect = results.filter((r) => r.monarchWasCorrect).length;

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
};

function pct(n: number, d: number): string {
  if (d === 0) return "N/A";
  return `${((n / d) * 100).toFixed(1)}%`;
}

console.log(
  `\n${c.bold}=== Monarch Accuracy Report ===${c.reset}\n`,
);
console.log(`Labeled transactions: ${c.bold}${String(total)}${c.reset}`);
console.log(
  `Tool output changes:  ${c.bold}${String(toolChanges.length)}${c.reset}`,
);

// Overall accuracy
console.log(
  `\n${c.bold}Overall Accuracy${c.reset}`,
);
console.log(
  `  Tool accuracy:    ${c.bold}${pct(correct, total)}${c.reset} (${String(correct)}/${String(total)})`,
);
console.log(
  `  Monarch baseline: ${c.bold}${pct(monarchCorrect, total)}${c.reset} (${String(monarchCorrect)}/${String(total)})`,
);
const delta = correct - monarchCorrect;
const deltaColor = delta > 0 ? c.green : delta < 0 ? c.red : c.dim;
console.log(
  `  Delta:            ${deltaColor}${delta > 0 ? "+" : ""}${String(delta)} transactions${c.reset}`,
);

// By confidence
console.log(
  `\n${c.bold}Accuracy by Confidence${c.reset}`,
);
const confidenceBuckets = ["high", "medium", "low", "agreed"] as const;
for (const conf of confidenceBuckets) {
  const bucket = results.filter((r) => r.toolConfidence === conf);
  if (bucket.length === 0) continue;
  const bucketCorrect = bucket.filter((r) => r.isCorrect).length;
  console.log(
    `  ${conf.padEnd(8)} ${pct(bucketCorrect, bucket.length).padStart(6)} (${String(bucketCorrect)}/${String(bucket.length)})`,
  );
}

// By deep path
console.log(
  `\n${c.bold}Accuracy by Deep Path${c.reset}`,
);
const deepPaths = [...new Set(results.map((r) => r.deepPath))].sort();
for (const dp of deepPaths) {
  const bucket = results.filter((r) => r.deepPath === dp);
  const bucketCorrect = bucket.filter((r) => r.isCorrect).length;
  const bucketMonarch = bucket.filter((r) => r.monarchWasCorrect).length;
  console.log(
    `  ${dp.padEnd(10)} tool=${pct(bucketCorrect, bucket.length).padStart(6)}  monarch=${pct(bucketMonarch, bucket.length).padStart(6)}  (n=${String(bucket.length)})`,
  );
}

// Change precision & recall
const changesInLabeled = results.filter((r) => r.toolConfidence !== "agreed");
const neededChange = results.filter((r) => !r.monarchWasCorrect);
const toolProposedChange = changesInLabeled;
const truePositiveChanges = toolProposedChange.filter(
  (r) => r.isCorrect && !r.monarchWasCorrect,
);
const changePrecision = toolProposedChange.length > 0
  ? toolProposedChange.filter((r) => r.isCorrect).length /
    toolProposedChange.length
  : 0;
const changeRecall = neededChange.length > 0
  ? truePositiveChanges.length / neededChange.length
  : 0;

console.log(
  `\n${c.bold}Change Analysis${c.reset}`,
);
console.log(
  `  Changes proposed: ${String(toolProposedChange.length)}`,
);
console.log(
  `  Changes needed:   ${String(neededChange.length)}`,
);
console.log(
  `  Change precision: ${c.bold}${(changePrecision * 100).toFixed(1)}%${c.reset} (when tool changes, is it right?)`,
);
console.log(
  `  Change recall:    ${c.bold}${(changeRecall * 100).toFixed(1)}%${c.reset} (when change needed, did tool catch it?)`,
);

// By tier
console.log(
  `\n${c.bold}Accuracy by Tier${c.reset}`,
);
const tiers = [1, 2, 3, undefined] as const;
for (const tier of tiers) {
  const tierChanges = toolChanges.filter((ch) => ch.tier === tier);
  if (tierChanges.length === 0) continue;
  const tierIds = new Set(tierChanges.map((ch) => ch.transactionId));
  const tierResults = results.filter((r) => tierIds.has(r.transactionId));
  if (tierResults.length === 0) continue;
  const tierCorrect = tierResults.filter((r) => r.isCorrect).length;
  const label = tier === undefined ? "legacy" : `tier ${String(tier)}`;
  console.log(
    `  ${label.padEnd(8)} ${pct(tierCorrect, tierResults.length).padStart(6)} (${String(tierCorrect)}/${String(tierResults.length)})`,
  );
}

// By enrichment source
console.log(
  `\n${c.bold}Accuracy by Enrichment Source${c.reset}`,
);
const enrichmentSources = [
  ...new Set(
    toolChanges
      .map((ch) => ch.enrichmentSource)
      .filter((s): s is string => s !== undefined),
  ),
].sort();
for (const source of enrichmentSources) {
  const sourceChanges = toolChanges.filter(
    (ch) => ch.enrichmentSource === source,
  );
  const sourceIds = new Set(sourceChanges.map((ch) => ch.transactionId));
  const sourceResults = results.filter((r) => sourceIds.has(r.transactionId));
  if (sourceResults.length === 0) continue;
  const sourceCorrect = sourceResults.filter((r) => r.isCorrect).length;
  console.log(
    `  ${source.padEnd(10)} ${pct(sourceCorrect, sourceResults.length).padStart(6)} (${String(sourceCorrect)}/${String(sourceResults.length)})`,
  );
}

// Split detection
const labelsWithSplit = dataset.labels.filter((l) => l.shouldSplit);
const toolSplits = new Set(
  toolChanges.filter((ch) => ch.type === "split").map((ch) => ch.transactionId),
);
const labeledIds = new Set(dataset.labels.map((l) => l.transactionId));
const splitTP = labelsWithSplit.filter((l) =>
  toolSplits.has(l.transactionId),
).length;
const splitFP = [...toolSplits].filter(
  (id) =>
    labeledIds.has(id) &&
    !labelsWithSplit.some((l) => l.transactionId === id),
).length;
const splitFN = labelsWithSplit.filter(
  (l) => !toolSplits.has(l.transactionId),
).length;

console.log(
  `\n${c.bold}Split Detection${c.reset}`,
);
console.log(`  Ground truth splits: ${String(labelsWithSplit.length)}`);
console.log(`  Tool proposed splits: ${String(toolSplits.size)}`);
console.log(
  `  True positives: ${String(splitTP)}  False positives: ${String(splitFP)}  False negatives: ${String(splitFN)}`,
);

// Confusion matrix (top misclassifications)
console.log(
  `\n${c.bold}Top Misclassifications${c.reset}`,
);
const misses = results.filter((r) => !r.isCorrect);
const confusionCounts = new Map<string, number>();
for (const m of misses) {
  const key = `${m.groundTruthCategory} -> ${m.toolCategory}`;
  confusionCounts.set(key, (confusionCounts.get(key) ?? 0) + 1);
}
const sortedConfusion = [...confusionCounts.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 15);
for (const [pair, n] of sortedConfusion) {
  console.log(`  ${c.red}${String(n).padStart(3)}${c.reset}  ${pair}`);
}

if (misses.length === 0) {
  console.log(`  ${c.green}No misclassifications!${c.reset}`);
}

// Save report
const report = {
  generatedAt: new Date().toISOString(),
  totalLabeled: total,
  toolAccuracy: correct / total,
  monarchBaseline: monarchCorrect / total,
  changePrecision,
  changeRecall,
  byConfidence: Object.fromEntries(
    confidenceBuckets.map((conf) => {
      const bucket = results.filter((r) => r.toolConfidence === conf);
      const bucketCorrect = bucket.filter((r) => r.isCorrect).length;
      return [conf, { total: bucket.length, correct: bucketCorrect }];
    }),
  ),
  byDeepPath: Object.fromEntries(
    deepPaths.map((dp) => {
      const bucket = results.filter((r) => r.deepPath === dp);
      return [
        dp,
        {
          total: bucket.length,
          toolCorrect: bucket.filter((r) => r.isCorrect).length,
          monarchCorrect: bucket.filter((r) => r.monarchWasCorrect).length,
        },
      ];
    }),
  ),
  splitDetection: {
    groundTruth: labelsWithSplit.length,
    toolProposed: toolSplits.size,
    truePositives: splitTP,
    falsePositives: splitFP,
    falseNegatives: splitFN,
  },
  topMisclassifications: sortedConfusion.map(([pair, n]) => ({
    pair,
    count: n,
  })),
  results,
};

await Bun.write(reportPath, JSON.stringify(report, null, 2));
console.log(`\n${c.dim}Report saved to ${reportPath}${c.reset}`);
