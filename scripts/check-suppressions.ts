#!/usr/bin/env bun

/**
 * Pre-commit hook to detect new code quality suppressions
 * Fails if any new eslint-disable, @ts-ignore, etc. are added
 */

import { $ } from "bun";

// Patterns to detect (case-insensitive where appropriate)
const SUPPRESSION_PATTERNS = [
  /eslint-disable/i,
  /eslint-disable-next-line/i,
  /@ts-ignore/i,
  /@ts-nocheck/i,
  /@ts-expect-error/i,
  /prettier-ignore/i,
  // Rust suppressions
  /#\[allow\(/,
  /#!\[allow\(/,
];

// Files where suppression patterns are legitimate (config, the script itself, etc.)
const EXCLUDED_FILES = [
  "scripts/check-suppressions.ts",
  "Cargo.toml",
  "clippy.toml",
  ".quality-baseline.json",
];

type Finding = {
  file: string;
  lineNumber: number;
  line: string;
  pattern: string;
};

async function main(): Promise<void> {
  console.log("Checking for new code quality suppressions...\n");

  // Get the diff of staged files (bypass external diff tools)
  const diffResult = await $`git diff --cached --unified=0 --no-ext-diff`.quiet();
  const diff = diffResult.text();

  if (!diff) {
    console.log("No staged changes to check");
    return;
  }

  const findings: Finding[] = [];
  const lines = diff.split("\n");
  let currentFile = "";
  let currentLineNumber = 0;

  for (const line of lines) {
    // Track which file we're in
    if (line.startsWith("+++ ")) {
      const match = /^\+\+\+ [a-z]\/(.*)/.exec(line);
      if (match) {
        currentFile = match[1];
        // Skip checking excluded files
        if (EXCLUDED_FILES.some((f) => currentFile.endsWith(f))) {
          currentFile = "";
        }
      }
      continue;
    }

    // Skip if we're in an excluded file
    if (!currentFile) {
      continue;
    }

    // Track line numbers from diff hunks
    if (line.startsWith("@@")) {
      const match = /\+(\d+)/.exec(line);
      if (match) {
        currentLineNumber = parseInt(match[1]);
      }
      continue;
    }

    // Only check added lines (starting with +)
    if (!line.startsWith("+") || line.startsWith("+++")) {
      continue;
    }

    const cleanedLine = line.substring(1); // Remove the + prefix

    // Check if line matches any suppression pattern
    for (const pattern of SUPPRESSION_PATTERNS) {
      if (pattern.test(cleanedLine)) {
        findings.push({
          file: currentFile,
          lineNumber: currentLineNumber,
          line: cleanedLine.trim(),
          pattern: pattern.toString(),
        });
        break; // Only report each line once
      }
    }

    currentLineNumber++;
  }

  if (findings.length === 0) {
    console.log("No new code quality suppressions found");
    return;
  }

  // Report findings
  console.error("Found new code quality suppressions:\n");

  // Group by file
  const byFile = findings.reduce<Record<string, Finding[]>>((acc, finding) => {
    acc[finding.file] ??= [];
    acc[finding.file].push(finding);
    return acc;
  }, {});

  for (const [file, fileFindings] of Object.entries(byFile)) {
    console.error(`  ${file}`);
    for (const finding of fileFindings) {
      console.error(`   Line ${String(finding.lineNumber)}: ${finding.line}`);
    }
    console.error("");
  }

  console.error("Code quality suppressions detected!");
  console.error("");
  console.error("Please review these suppressions carefully:");
  console.error("  - Can you fix the underlying issue instead?");
  console.error("  - Is the suppression absolutely necessary?");
  console.error("  - Have you documented why it's needed?");
  console.error("");
  console.error("If you've reviewed and these are intentional:");
  console.error("  1. Add a comment explaining why");
  console.error("  2. Run: git commit --no-verify");
  console.error("");

  process.exit(1);
}

await main();
