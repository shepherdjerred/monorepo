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
  // Shell hygiene patterns (error swallowing, token-in-URL)
  /\|\| true/,
  /2>\/dev\/null/,
  /\|\| bun install/,
  /x-access-token/,
  /git add -A/,
  /--no-exit-code/,
];

// Files where suppression patterns are legitimate (config, the script itself, etc.)
const EXCLUDED_FILES = [
  // Vendored fork of @dank074/discord-video-stream — preserve upstream source as-is, including
  // its @ts-expect-error comments (matched as a path prefix).
  "packages/discord-video-stream/",
  "scripts/check-suppressions.ts",
  "scripts/quality-ratchet.sh",
  "CHANGELOG.md",
  "Cargo.toml",
  "clippy.toml",
  ".quality-baseline.json",
  "packages/better-skill-capped/src/components/app.tsx",
  "packages/better-skill-capped/src/components/router.tsx",
  // Intentional: discord-player-youtubei types incompatible without --preserveSymlinks
  "packages/birmel/src/music/extractors.ts",
  // Intentional: Zod-validated discord.js Channel stub (60+ properties impractical to mock)
  "packages/birmel/tests/agent-tools/tools/discord/channel-resolver.test.ts",
  // Intentional: Sentry ErrorBoundary class types incompatible with React 19
  "packages/discord-plays-pokemon/packages/frontend/src/main.tsx",
  // Intentional: Sentry ErrorBoundary class types incompatible with React 19 (same issue as Pokemon)
  "packages/discord-plays-mario-kart/packages/frontend/src/main.tsx",
  // Vendored third-party code: mupen64plus-core (GPL-2.0) — preserve upstream source as-is
  "packages/discord-plays-mario-kart/wasm-src/code/src/mupen64plus-core/",
  // Intentional: public Firebase web API key (same as better-skill-capped fetcher)
  "packages/temporal/src/activities/fetcher.ts",
  // Intentional: ha-codegen emits `/* eslint-disable */` into the generated HA schema header
  "packages/home-assistant/src/codegen/emit.ts",
  // Intentional: committed stub for the generated HA schema; gets overwritten by ha-codegen
  "packages/temporal/src/generated/ha-schema.stub.ts",
  // Machine-generated cdk8s CRD imports: update-imports.ts prepends
  // `// @ts-nocheck` and cdk8s-cli emits `/* eslint-disable ... */` headers.
  // Refreshed by the homelab-crd-imports-daily Temporal schedule; the
  // quality-ratchet likewise excludes /generated/ paths.
  "packages/homelab/src/cdk8s/generated/imports/",
  // Intentional: compile-time type tests — @ts-expect-error is the whole point
  "packages/home-assistant/test/typed-client.test-d.ts",
  // Documentation: AGENTS.md files and docs mention suppression patterns as things to avoid
  "AGENTS.md",
  "CLAUDE.md",
  "packages/docs/",
  // Agent prompts are prose that PROHIBITS the banned patterns by name
  // (e.g. refine-release-please.md tells the agent never to `git add -A`).
  "scripts/prompts/",
  "packages/dotfiles/AGENTS.md",
  "packages/dotfiles/CLAUDE.md",
  // Uses || true for grep exit code
  "scripts/quality-ratchet.ts",
  // Prometheus exporter shell script: `2>/dev/null` falls back to a 0 metric
  // when zpool/date are unavailable, which is the right behavior for scrape
  // resilience; the ban targets automation scripts, not arbitrary shell.
  "packages/homelab/src/cdk8s/src/resources/monitoring/scripts/zfs_zpool.sh",
  // Intentional: writes a GIT_ASKPASS script that returns the literal string
  // "x-access-token" as the git username (with $GH_TOKEN as the password).
  // This is the recommended pattern that the AGENTS.md rule actually points
  // toward — the ban is on putting `x-access-token` in URLs, not in askpass.
  "packages/temporal/src/activities/data-dragon.ts",
  // Same pattern: GIT_ASKPASS script for the pr-review-bot workdir clone.
  // The literal "x-access-token" is the username GitHub's HTTPS clone
  // expects when the password is a PAT; not a token-in-URL.
  "packages/temporal/src/lib/pr-review-workdir.ts",
  // Same GIT_ASKPASS pattern as data-dragon.ts — emits "x-access-token" as the
  // git username for the bare blobless clone the ci/merge-conflict checker uses
  // to fetch refs/heads/main + refs/pull/*/head before running merge-tree.
  "packages/temporal/src/activities/check-pr-merge-conflicts-git.ts",
  // Same GIT_ASKPASS pattern as data-dragon.ts — emits "x-access-token" as the
  // git username for the PR babysitter's persistent per-PR workdir clone.
  "packages/temporal/src/activities/pr-babysit/ensure-workdir.ts",
  // Intentional: Sentry ErrorBoundary class types incompatible with React 19
  // (same pattern as discord-plays-pokemon/packages/frontend/src/main.tsx)
  "packages/discord-plays-mario-kart/packages/frontend/src/main.tsx",
  // Upstream vendored mupen64plus build script — `2>/dev/null` is part of the
  // original build system's install detection logic; not ours to lint.
  "packages/discord-plays-mario-kart/wasm-src/code/src/mupen64plus-core/tools/install_binary_bundle.sh",
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
      if (match?.[1] !== undefined) {
        currentFile = match[1];
        // Skip checking excluded files
        if (
          EXCLUDED_FILES.some(
            (f) => currentFile.endsWith(f) || currentFile.startsWith(f),
          )
        ) {
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
      if (match?.[1] !== undefined) {
        currentLineNumber = Number.parseInt(match[1]);
      }
      continue;
    }

    // Only check added lines (starting with +)
    if (!line.startsWith("+") || line.startsWith("+++")) {
      continue;
    }

    const cleanedLine = line.slice(1); // Remove the + prefix

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
    const bucket = (acc[finding.file] ??= []);
    bucket.push(finding);
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
