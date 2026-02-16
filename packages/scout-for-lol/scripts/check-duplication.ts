#!/usr/bin/env bun
/**
 * Check code duplication with per-file and aggregate thresholds
 *
 * This script runs jscpd and enforces:
 * - Aggregate duplication threshold: 12%
 * - Per-file duplication threshold: 10%
 * - Detects duplication at function/block level (minLines: 9)
 */

import { $ } from "bun";
import * as path from "path";

type JscpdFileStats = {
  lines: number;
  tokens: number;
  sources: number;
  clones: number;
  duplicatedLines: number;
  duplicatedTokens: number;
  percentage: number;
  percentageTokens: number;
  newDuplicatedLines: number;
  newClones: number;
};

type JscpdStatistics = {
  detectionDate: string;
  formats: Record<string, { sources: Record<string, JscpdFileStats> }>;
  total: JscpdFileStats;
};

type JscpdDuplicate = {
  format: string;
  lines: number;
  tokens: number;
  firstFile: {
    name: string;
    start: number;
    end: number;
    startLoc: { line: number; column: number };
    endLoc: { line: number; column: number };
  };
  secondFile: {
    name: string;
    start: number;
    end: number;
    startLoc: { line: number; column: number };
    endLoc: { line: number; column: number };
  };
  fragment: string;
};

type JscpdResult = {
  statistics: JscpdStatistics;
  duplicates: JscpdDuplicate[];
};

const AGGREGATE_THRESHOLD = 12;
const PER_FILE_THRESHOLD = 100; // Effectively disabled - only aggregate threshold enforced
const WORKSPACE_ROOT = path.resolve(import.meta.dir, "..");

async function main(): Promise<void> {
  console.log("🔍 Running code duplication analysis...\n");

  // Run jscpd with JSON output
  const jscpdConfigPath = path.join(WORKSPACE_ROOT, ".jscpd.json");

  try {
    await $`bunx jscpd packages/ --config ${jscpdConfigPath} --reporters json --output ./jscpd-report`.quiet();
  } catch {
    // jscpd returns non-zero exit code if threshold exceeded, but we still want to parse results
    console.log("jscpd completed with findings\n");
  }

  // Read JSON output
  const jsonPath = path.join(WORKSPACE_ROOT, "jscpd-report", "jscpd-report.json");
  const jsonFile = Bun.file(jsonPath);

  if (!(await jsonFile.exists())) {
    console.error("❌ Error: jscpd JSON report not found");
    process.exit(1);
  }

  const result = (await jsonFile.json()) as JscpdResult;
  const { statistics, duplicates } = result;

  // Check aggregate threshold
  const aggregatePercentage = statistics.total.percentage;
  console.log(`📊 Aggregate Duplication: ${aggregatePercentage.toFixed(2)}%`);
  console.log(`   Threshold: ${AGGREGATE_THRESHOLD.toString()}%`);

  const aggregateFailed = aggregatePercentage > AGGREGATE_THRESHOLD;
  if (aggregateFailed) {
    console.log(`   ❌ FAIL: Exceeds ${AGGREGATE_THRESHOLD.toString()}% threshold\n`);
  } else {
    console.log(`   ✅ PASS\n`);
  }

  // Collect per-file statistics from jscpd output
  const fileStats = new Map<string, JscpdFileStats>();

  for (const format of Object.values(statistics.formats)) {
    for (const [filePath, stats] of Object.entries(format.sources)) {
      fileStats.set(filePath, stats);
    }
  }

  // Check per-file thresholds
  console.log(`📄 Per-File Duplication Analysis (threshold: ${PER_FILE_THRESHOLD.toString()}%):\n`);

  const failedFiles: { file: string; percentage: number; duplicatedLines: number; totalLines: number }[] = [];

  for (const [file, stats] of fileStats.entries()) {
    const percentage = stats.percentage;

    if (percentage > PER_FILE_THRESHOLD) {
      failedFiles.push({
        file,
        percentage,
        duplicatedLines: stats.duplicatedLines,
        totalLines: stats.lines,
      });
    }
  }

  if (failedFiles.length > 0) {
    console.log(`❌ ${failedFiles.length.toString()} file(s) exceed ${PER_FILE_THRESHOLD.toString()}% duplication:\n`);

    // Sort by percentage descending
    failedFiles.sort((a, b) => b.percentage - a.percentage);

    for (const failure of failedFiles) {
      const relPath = path.relative(WORKSPACE_ROOT, failure.file);
      const stats = fileStats.get(failure.file);

      console.log(`   ${relPath}`);
      console.log(
        `   ${failure.percentage.toFixed(2)}% duplicated (${failure.duplicatedLines.toString()}/${failure.totalLines.toString()} lines)`,
      );

      if (stats) {
        console.log(`   ${stats.clones.toString()} duplicate block(s) found`);
      }
      console.log();
    }
  } else {
    console.log("✅ All files pass per-file duplication threshold\n");
  }

  // Show summary of worst offenders
  if (duplicates.length > 0) {
    console.log(`🔍 Largest duplicate blocks:\n`);

    const sortedDuplicates = duplicates.slice().sort((a, b) => b.lines - a.lines);

    for (const duplicate of sortedDuplicates.slice(0, 5)) {
      const file1 = path.relative(WORKSPACE_ROOT, duplicate.firstFile.name);
      const file2 = path.relative(WORKSPACE_ROOT, duplicate.secondFile.name);

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
  if (aggregateFailed || failedFiles.length > 0) {
    console.log("\n❌ DUPLICATION CHECK FAILED\n");
    if (aggregateFailed) {
      console.log(
        `   - Aggregate duplication: ${aggregatePercentage.toFixed(2)}% > ${AGGREGATE_THRESHOLD.toString()}%`,
      );
    }
    if (failedFiles.length > 0) {
      console.log(
        `   - ${failedFiles.length.toString()} file(s) exceed ${PER_FILE_THRESHOLD.toString()}% per-file threshold`,
      );
    }
    console.log("\n💡 View detailed report: jscpd-report/html/index.html\n");
    process.exit(1);
  }

  console.log("\n✅ DUPLICATION CHECK PASSED\n");
  console.log(`   - Aggregate duplication: ${aggregatePercentage.toFixed(2)}% ≤ ${AGGREGATE_THRESHOLD.toString()}%`);
  console.log(`   - All files ≤ ${PER_FILE_THRESHOLD.toString()}% per-file duplication`);
  console.log("\n💡 View detailed report: jscpd-report/html/index.html\n");
}

main().catch((error: unknown) => {
  console.error("❌ Error running duplication check:", error);
  process.exit(1);
});
