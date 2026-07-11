#!/usr/bin/env bun

/**
 * commit-msg hook to enforce conventional commits with required scopes.
 * Format: type(scope): description  OR  type(scope)!: description
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const VALID_TYPES: readonly string[] = [
  "feat",
  "fix",
  "chore",
  "ci",
  "docs",
  "refactor",
  "test",
  "perf",
  "build",
  "style",
  "revert",
  "misc",
];

// Scopes beyond the auto-derived `packages/*` directory names.
// - practice: coding-practice projects under `sandbox/practice/` (outside packages/)
// - archive: legacy projects under `sandbox/archive/`
// - root: cross-cutting changes (scripts/, root configs, lockfiles)
// - dagger: `.dagger/` CI pipeline definitions
// - deps: dependency bumps (Renovate's `chore(deps):` convention)
// - ci: `scripts/ci/` pipeline generator and `.buildkite/`
// - cooklang: release-bot version bumps spanning the cooklang-* packages
const EXTRA_SCOPES: readonly string[] = [
  "practice",
  "archive",
  "root",
  "dagger",
  "deps",
  "ci",
  "cooklang",
];

const BYPASS_PATTERNS = [
  /^Merge /,
  /^Revert "/,
  /^fixup! /,
  /^squash! /,
  /^amend! /,
];

const COMMIT_PATTERN = /^(\w+)\(([^)]+)\)!?:\s+.+/;

async function getPackageScopes(): Promise<string[]> {
  const packagesDir = path.join(import.meta.dirname, "..", "packages");
  const entries = await readdir(packagesDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

function stripComments(message: string): string {
  return message
    .split("\n")
    .filter((line) => !line.startsWith("#"))
    .join("\n")
    .trim();
}

async function main(): Promise<void> {
  const commitMsgFile = process.argv[2];
  if (!commitMsgFile) {
    console.error("Usage: validate-commit-msg.ts <commit-msg-file>");
    process.exit(1);
  }

  const rawMessage = await readFile(commitMsgFile, "utf8");
  const message = stripComments(rawMessage);
  const firstLine = (message.split("\n")[0] ?? "").trim();

  if (!firstLine) {
    console.error("Error: empty commit message");
    process.exit(1);
  }

  // Allow bypass patterns
  if (BYPASS_PATTERNS.some((pattern) => pattern.test(firstLine))) {
    return;
  }

  const match = COMMIT_PATTERN.exec(firstLine);
  if (!match) {
    console.error(`Invalid commit message format: "${firstLine}"`);
    console.error("");
    console.error("Expected: type(scope): description");
    console.error("     or:  type(scope)!: description");
    console.error("");
    console.error(`Valid types: ${VALID_TYPES.join(", ")}`);
    process.exit(1);
  }

  const type = match[1];
  const scope = match[2];
  if (type === undefined || scope === undefined) {
    console.error(`Invalid commit message format: "${firstLine}"`);
    process.exit(1);
  }

  if (!VALID_TYPES.includes(type)) {
    console.error(`Invalid commit type: "${type}"`);
    console.error("");
    console.error(`Valid types: ${VALID_TYPES.join(", ")}`);
    process.exit(1);
  }

  const validScopes = [...(await getPackageScopes()), ...EXTRA_SCOPES].sort();
  if (!validScopes.includes(scope)) {
    console.error(`Invalid commit scope: "${scope}"`);
    console.error("");
    console.error(`Valid scopes: ${validScopes.join(", ")}`);
    process.exit(1);
  }
}

await main();
