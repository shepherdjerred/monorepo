#!/usr/bin/env bun

/**
 * Quality ratchet — tracks lint/type suppressions per-file so they are not fungible.
 *
 * Each suppression is pinned to a specific file. You cannot add a new suppression
 * in one file by removing one from another. Any new suppression in an unallowed
 * file (or exceeding the allowed count in an existing file) fails the check.
 */

import { $ } from "bun";

interface Baseline {
  "eslint-disable": Record<string, number>;
  "ts-suppressions": Record<string, number>;
  "rust-allow": Record<string, number>;
  "prettier-ignore": Record<string, number>;
  updated: string;
}

interface GrepRule {
  key: keyof Omit<Baseline, "updated">;
  pattern: string;
  searchPaths: string[];
  includes: string[];
  /** Directory names to pass to --exclude-dir */
  excludeDirs: string[];
  /** Path substrings to filter from output (for paths like /generated/ that --exclude-dir can't handle) */
  excludePathPatterns: string[];
}

const RULES: GrepRule[] = [
  {
    key: "eslint-disable",
    pattern: String.raw`^\s*(//|/\*)\s*eslint-disable`,
    searchPaths: ["packages/", ".dagger/"],
    includes: ["*.ts", "*.tsx"],
    excludeDirs: ["node_modules", "dist", "archive"],
    excludePathPatterns: ["/generated/"],
  },
  {
    key: "ts-suppressions",
    pattern: String.raw`^\s*//\s*@ts-(expect-error|ignore|nocheck)`,
    searchPaths: ["packages/", ".dagger/"],
    includes: ["*.ts", "*.tsx"],
    excludeDirs: ["node_modules", "dist", "archive"],
    excludePathPatterns: ["/generated/"],
  },
  {
    key: "rust-allow",
    pattern: String.raw`#\[allow\(`,
    searchPaths: ["packages/clauderon/src/"],
    includes: ["*.rs"],
    excludeDirs: [],
    excludePathPatterns: [],
  },
  {
    key: "prettier-ignore",
    pattern: String.raw`^\s*(//|/\*)\s*prettier-ignore`,
    searchPaths: ["packages/", ".dagger/"],
    includes: ["*.ts", "*.tsx", "*.js", "*.jsx", "*.css", "*.json"],
    excludeDirs: ["node_modules", "dist", "archive"],
    excludePathPatterns: [],
  },
];

async function grepSuppressions(rule: GrepRule): Promise<Map<string, number>> {
  const includeArgs = rule.includes.flatMap((g) => ["--include", g]);
  const excludeDirArgs = rule.excludeDirs.flatMap((e) => ["--exclude-dir", e]);

  // grep returns exit code 1 when no matches found — that's fine
  const result =
    await $`grep -rE ${rule.pattern} ${rule.searchPaths} ${includeArgs} ${excludeDirArgs} 2>/dev/null || true`.text();

  const counts = new Map<string, number>();

  for (const line of result.split("\n")) {
    if (line.trim() === "") continue;
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;
    const file = line.slice(0, colonIndex);

    // Filter out paths matching exclude patterns
    if (rule.excludePathPatterns.some((p) => file.includes(p))) continue;

    counts.set(file, (counts.get(file) ?? 0) + 1);
  }

  return counts;
}

async function main() {
  const baselineText = await Bun.file(".quality-baseline.json").text();
  const baseline: Baseline = JSON.parse(baselineText);

  let failed = false;
  const summaryLines: string[] = [];

  for (const rule of RULES) {
    const allowed = baseline[rule.key];
    const current = await grepSuppressions(rule);
    const allowedTotal = Object.values(allowed).reduce((a, b) => a + b, 0);
    const currentTotal = [...current.values()].reduce((a, b) => a + b, 0);

    summaryLines.push(`  ${rule.key}: ${String(currentTotal)} / ${String(allowedTotal)} allowed`);

    // Check for suppressions in files not in the allowlist
    for (const [file, count] of current) {
      if (!(file in allowed)) {
        console.error(`FAIL: ${rule.key} found in unallowed file: ${file} (${String(count)} occurrences)`);
        failed = true;
      } else if (count > allowed[file]) {
        console.error(
          `FAIL: ${rule.key} count increased in ${file} (${String(count)} > ${String(allowed[file])} allowed)`,
        );
        failed = true;
      }
    }

    // Report if an allowed file no longer has suppressions (can tighten the allowlist)
    for (const [file, allowedCount] of Object.entries(allowed)) {
      const actualCount = current.get(file) ?? 0;
      if (actualCount === 0) {
        console.log(`NOTE: ${file} has 0 ${rule.key} suppressions but ${String(allowedCount)} allowed — consider removing from allowlist`);
      } else if (actualCount < allowedCount) {
        console.log(
          `NOTE: ${file} has ${String(actualCount)} ${rule.key} suppressions but ${String(allowedCount)} allowed — consider tightening`,
        );
      }
    }
  }

  console.log("Suppression counts (current / allowed):");
  for (const line of summaryLines) {
    console.log(line);
  }

  if (failed) {
    console.error(
      "\nQuality ratchet failed. If suppressions were intentionally added,\n" +
        "update the per-file allowlist in .quality-baseline.json.",
    );
    process.exit(1);
  }

  console.log("\nQuality ratchet passed");
}

await main();
