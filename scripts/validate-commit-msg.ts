#!/usr/bin/env bun

/**
 * commit-msg hook to enforce conventional commits with required scopes.
 * Format: type(scope): description  OR  type(scope)!: description
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const VALID_TYPES = [
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
] as const;

const EXTRA_SCOPES = ["practice", "archive", "root", "dagger"] as const;

const BYPASS_PATTERNS = [
  /^Merge /,
  /^Revert "/,
  /^fixup! /,
  /^squash! /,
  /^amend! /,
];

const COMMIT_PATTERN = /^(\w+)\(([^)]+)\)!?:\s+.+/;

function getPackageScopes(): string[] {
  const packagesDir = join(import.meta.dirname, "..", "packages");
  return readdirSync(packagesDir, { withFileTypes: true })
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

function main(): void {
  const commitMsgFile = process.argv[2];
  if (!commitMsgFile) {
    console.error("Usage: validate-commit-msg.ts <commit-msg-file>");
    process.exit(1);
  }

  const rawMessage = readFileSync(commitMsgFile, "utf-8");
  const message = stripComments(rawMessage);
  const firstLine = message.split("\n")[0].trim();

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

  if (!VALID_TYPES.includes(type as (typeof VALID_TYPES)[number])) {
    console.error(`Invalid commit type: "${type}"`);
    console.error("");
    console.error(`Valid types: ${VALID_TYPES.join(", ")}`);
    process.exit(1);
  }

  const validScopes = [...getPackageScopes(), ...EXTRA_SCOPES].sort();
  if (!validScopes.includes(scope)) {
    console.error(`Invalid commit scope: "${scope}"`);
    console.error("");
    console.error(`Valid scopes: ${validScopes.join(", ")}`);
    process.exit(1);
  }
}

main();
