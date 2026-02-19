#!/usr/bin/env bun

/**
 * Pre-commit hook to detect new code quality suppressions
 * Fails if any new eslint-disable, @ts-ignore, etc. are added
 */

import { $ } from "bun";

// Patterns to detect (case-insensitive)
const SUPPRESSION_PATTERNS = [
  /eslint-disable/i,
  /eslint-disable-next-line/i,
  /@ts-ignore/i,
  /@ts-nocheck/i,
  /@ts-expect-error/i,
  /prettier-ignore/i,
  // Add more patterns as needed
];

type Finding = {
  file: string;
  lineNumber: number;
  line: string;
  pattern: string;
};

function parseDiffForSuppressions(diff: string): Finding[] {
  const findings: Finding[] = [];
  const lines = diff.split("\n");
  let currentFile = "";
  let currentLineNumber = 0;

  for (const line of lines) {
    // Track which file we're in
    if (line.startsWith("+++ ")) {
      const match = /^\+\+\+ [a-z]\/(.*)/.exec(line);
      const matchedFile = match?.[1];
      if (matchedFile !== undefined && matchedFile.length > 0) {
        currentFile = matchedFile;
        if (currentFile === "scripts/check-suppressions.ts") {
          currentFile = "";
        }
      }
      continue;
    }

    if (!currentFile) {
      continue;
    }

    if (line.startsWith("@@")) {
      const hunkMatch = /\+(\d+)/.exec(line);
      const lineStr = hunkMatch?.[1];
      if (lineStr !== undefined && lineStr.length > 0) {
        currentLineNumber = Number.parseInt(lineStr);
      }
      continue;
    }

    if (!line.startsWith("+") || line.startsWith("+++")) {
      continue;
    }

    const cleanedLine = line.slice(1);

    for (const pattern of SUPPRESSION_PATTERNS) {
      if (pattern.test(cleanedLine)) {
        findings.push({
          file: currentFile,
          lineNumber: currentLineNumber,
          line: cleanedLine.trim(),
          pattern: pattern.toString(),
        });
        break;
      }
    }

    currentLineNumber++;
  }

  return findings;
}

async function main(): Promise<void> {
  console.log("🔍 Checking for new code quality suppressions...\n");

  const diffResult =
    await $`git diff --cached --unified=0 --no-ext-diff`.quiet();
  const diff = diffResult.text();

  if (!diff) {
    console.log("✅ No staged changes to check");
    return;
  }

  const findings = parseDiffForSuppressions(diff);

  if (findings.length === 0) {
    console.log("✅ No new code quality suppressions found");
    return;
  }

  // Report findings
  console.error("❌ Found new code quality suppressions:\n");

  // Group by file
  const byFile = new Map<string, Finding[]>();
  for (const finding of findings) {
    const existing = byFile.get(finding.file);
    if (existing) {
      existing.push(finding);
    } else {
      byFile.set(finding.file, [finding]);
    }
  }

  for (const [file, fileFindings] of byFile.entries()) {
    console.error(`📄 ${file}`);
    for (const finding of fileFindings) {
      console.error(`   Line ${String(finding.lineNumber)}: ${finding.line}`);
    }
    console.error("");
  }

  console.error("⚠️  Code quality suppressions detected!");
  console.error("");
  console.error("Please review these suppressions carefully:");
  console.error("  • Can you fix the underlying issue instead?");
  console.error("  • Is the suppression absolutely necessary?");
  console.error("  • Have you documented why it's needed?");
  console.error("");
  console.error("If you've reviewed and these are intentional:");
  console.error("  1. Add a comment explaining why");
  console.error("  2. Run: git commit --no-verify");
  console.error("");

  process.exit(1);
}

await main();
