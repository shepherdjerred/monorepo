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
  // Dagger/CI hygiene patterns (banned in .dagger/src/ and scripts/ci/src/)
  /\|\| true/,
  /2>\/dev\/null/,
  /\|\| bun install/,
  /x-access-token/,
  /git add -A/,
  /--no-exit-code/,
];

// Files where suppression patterns are legitimate (config, the script itself, etc.)
const EXCLUDED_FILES = [
  "scripts/check-suppressions.ts",
  "scripts/quality-ratchet.sh",
  "scripts/ci/src/ci/lib/quality.py",
  "Cargo.toml",
  "clippy.toml",
  ".quality-baseline.json",
  // Intentional: HA generated types declare media as string but HA expects object
  "packages/homelab/src/ha/src/util.ts",
  // Intentional: @sentry/react ErrorBoundary types incompatible with React 19
  "packages/clauderon/web/frontend/src/main.tsx",
  "packages/better-skill-capped/src/components/app.tsx",
  "packages/better-skill-capped/src/components/router.tsx",
  // Intentional: discord-player-youtubei types incompatible without --preserveSymlinks
  "packages/birmel/src/music/extractors.ts",
  // Intentional: Sentry ErrorBoundary class types incompatible with React 19
  "packages/discord-plays-pokemon/packages/frontend/src/main.tsx",
  // Documentation: CLAUDE.md files mention suppression patterns as things to avoid
  "CLAUDE.md",
  "packages/dotfiles/CLAUDE.md",
  // Contains patterns as search strings
  "scripts/check-dagger-hygiene.ts",
  // Uses || true for grep exit code
  "scripts/quality-ratchet.ts",
];

type Finding = {
  file: string;
  lineNumber: number;
  line: string;
  pattern: string;
};

async function main(): Promise<void> {
  console.log("Checking for new code quality suppressions...\n");

  // In CI mode, skip staged-diff check (quality-ratchet enforces total counts)
  if (process.argv.includes("--ci")) {
    console.log(
      "CI mode: skipping staged-diff check (quality-ratchet covers this)",
    );
    return;
  }

  // Get the diff of staged files (bypass external diff tools)
  const diffResult =
    await $`git diff --cached --unified=0 --no-ext-diff`.quiet();
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
