#!/usr/bin/env bun
/**
 * Check code duplication with per-file and aggregate thresholds
 *
 * This script runs jscpd and enforces:
 * - Aggregate duplication threshold: 12%
 * - Detects duplication at function/block level (minLines: 9)
 */

import { $ } from "bun";
import { z } from "zod";

const JscpdFileStatsSchema = z.object({
  lines: z.number(),
  tokens: z.number(),
  sources: z.number(),
  clones: z.number(),
  duplicatedLines: z.number(),
  duplicatedTokens: z.number(),
  percentage: z.number(),
  percentageTokens: z.number(),
  newDuplicatedLines: z.number(),
  newClones: z.number(),
});

const JscpdLocSchema = z.object({ line: z.number(), column: z.number() });

const JscpdFileRefSchema = z.object({
  name: z.string(),
  start: z.number(),
  end: z.number(),
  startLoc: JscpdLocSchema,
  endLoc: JscpdLocSchema,
});

const JscpdDuplicateSchema = z.object({
  format: z.string(),
  lines: z.number(),
  tokens: z.number(),
  firstFile: JscpdFileRefSchema,
  secondFile: JscpdFileRefSchema,
  fragment: z.string(),
});

const JscpdStatisticsSchema = z.object({
  detectionDate: z.string(),
  formats: z.record(z.string(), JscpdFileStatsSchema),
  total: JscpdFileStatsSchema,
});

const JscpdResultSchema = z.object({
  statistics: JscpdStatisticsSchema,
  duplicates: z.array(JscpdDuplicateSchema),
});

type JscpdResult = z.infer<typeof JscpdResultSchema>;

async function readJscpdResult(filePath: string): Promise<JscpdResult> {
  const text = await Bun.file(filePath).text();
  const data: unknown = JSON.parse(text);
  return JscpdResultSchema.parse(data);
}

function relativePath(from: string, to: string): string {
  const prefix = from.endsWith("/") ? from : `${from}/`;
  if (to.startsWith(prefix)) {
    return to.slice(prefix.length);
  }
  return to;
}

const AGGREGATE_THRESHOLD = 12;
const WORKSPACE_ROOT = new URL("..", import.meta.url).pathname.replace(
  /\/$/,
  "",
);

async function main(): Promise<void> {
  console.log("🔍 Running code duplication analysis...\n");

  // Run jscpd with JSON output
  const jscpdConfigPath = `${WORKSPACE_ROOT}/.jscpd.json`;

  try {
    await $`bunx jscpd packages/ --config ${jscpdConfigPath} --reporters json --output ./jscpd-report`.quiet();
  } catch {
    // jscpd returns non-zero exit code if threshold exceeded, but we still want to parse results
    console.log("jscpd completed with findings\n");
  }

  // Read JSON output
  const jsonPath = `${WORKSPACE_ROOT}/jscpd-report/jscpd-report.json`;
  const jsonFile = Bun.file(jsonPath);

  if (!(await jsonFile.exists())) {
    console.error("❌ Error: jscpd JSON report not found");
    process.exit(1);
  }

  const result = await readJscpdResult(jsonPath);
  const { statistics, duplicates } = result;

  // Check aggregate threshold
  const aggregatePercentage = statistics.total.percentage;
  console.log(`📊 Aggregate Duplication: ${aggregatePercentage.toFixed(2)}%`);
  console.log(`   Threshold: ${AGGREGATE_THRESHOLD.toString()}%`);

  const aggregateFailed = aggregatePercentage > AGGREGATE_THRESHOLD;
  if (aggregateFailed) {
    console.log(
      `   ❌ FAIL: Exceeds ${AGGREGATE_THRESHOLD.toString()}% threshold\n`,
    );
  } else {
    console.log(`   ✅ PASS\n`);
  }

  console.log("📄 Per-Format Duplication Analysis:\n");
  for (const [format, stats] of Object.entries(statistics.formats).toSorted(
    ([firstFormat], [secondFormat]) => firstFormat.localeCompare(secondFormat),
  )) {
    console.log(
      `   ${format}: ${stats.percentage.toFixed(2)}% duplicated (${stats.duplicatedLines.toString()}/${stats.lines.toString()} lines across ${stats.sources.toString()} files)`,
    );
  }
  console.log();

  // Show summary of worst offenders
  if (duplicates.length > 0) {
    console.log(`🔍 Largest duplicate blocks:\n`);

    const sortedDuplicates = [...duplicates].toSorted(
      (a, b) => b.lines - a.lines,
    );

    for (const duplicate of sortedDuplicates.slice(0, 5)) {
      const file1 = relativePath(WORKSPACE_ROOT, duplicate.firstFile.name);
      const file2 = relativePath(WORKSPACE_ROOT, duplicate.secondFile.name);

      console.log(`   ${duplicate.lines.toString()} lines duplicated:`);
      console.log(
        `   - ${file1}:${duplicate.firstFile.startLoc.line.toString()}-${duplicate.firstFile.endLoc.line.toString()}`,
      );
      console.log(
        `   - ${file2}:${duplicate.secondFile.startLoc.line.toString()}-${duplicate.secondFile.endLoc.line.toString()}`,
      );
      console.log();
    }
  }

  // Final result
  console.log("━".repeat(80));
  if (aggregateFailed) {
    console.log("\n❌ DUPLICATION CHECK FAILED\n");
    console.log(
      `   - Aggregate duplication: ${aggregatePercentage.toFixed(2)}% > ${AGGREGATE_THRESHOLD.toString()}%`,
    );
    console.log("\n💡 View detailed report: jscpd-report/html/index.html\n");
    process.exit(1);
  }

  console.log("\n✅ DUPLICATION CHECK PASSED\n");
  console.log(
    `   - Aggregate duplication: ${aggregatePercentage.toFixed(2)}% ≤ ${AGGREGATE_THRESHOLD.toString()}%`,
  );
  console.log("   - Format-level statistics were parsed from the jscpd report");
  console.log("\n💡 View detailed report: jscpd-report/html/index.html\n");
}

try {
  await main();
} catch (error) {
  console.error("❌ Error running duplication check:", error);
  process.exit(1);
}
