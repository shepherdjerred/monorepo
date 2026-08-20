import { readdir } from "node:fs/promises";
import path from "node:path";

export const VALID_COMMIT_TYPES: readonly string[] = [
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

export const EXTRA_COMMIT_SCOPES: readonly string[] = [
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

export type CommitMessageValidation =
  | { valid: true }
  | { valid: false; error: string };

export function stripCommitMessageComments(message: string): string {
  return message
    .split("\n")
    .filter((line) => !line.startsWith("#"))
    .join("\n")
    .trim();
}

export async function validCommitScopes(
  repositoryRoot: string,
): Promise<string[]> {
  const packagesDirectory = path.join(repositoryRoot, "packages");
  const entries = await readdir(packagesDirectory, { withFileTypes: true });
  return [
    ...entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name),
    ...EXTRA_COMMIT_SCOPES,
  ].sort();
}

export async function validateCommitMessage(
  message: string,
  repositoryRoot: string,
): Promise<CommitMessageValidation> {
  const firstLine = (
    stripCommitMessageComments(message).split("\n")[0] ?? ""
  ).trim();
  if (firstLine.length === 0) {
    return { valid: false, error: "Error: empty commit message" };
  }
  if (BYPASS_PATTERNS.some((pattern) => pattern.test(firstLine))) {
    return { valid: true };
  }
  const match = COMMIT_PATTERN.exec(firstLine);
  if (match === null) {
    return {
      valid: false,
      error: [
        `Invalid commit message format: "${firstLine}"`,
        "",
        "Expected: type(scope): description",
        "     or:  type(scope)!: description",
        "",
        `Valid types: ${VALID_COMMIT_TYPES.join(", ")}`,
      ].join("\n"),
    };
  }
  const type = match[1];
  const scope = match[2];
  if (type === undefined || scope === undefined) {
    return {
      valid: false,
      error: `Invalid commit message format: "${firstLine}"`,
    };
  }
  if (!VALID_COMMIT_TYPES.includes(type)) {
    return {
      valid: false,
      error: [
        `Invalid commit type: "${type}"`,
        "",
        `Valid types: ${VALID_COMMIT_TYPES.join(", ")}`,
      ].join("\n"),
    };
  }
  const scopes = await validCommitScopes(repositoryRoot);
  if (!scopes.includes(scope)) {
    return {
      valid: false,
      error: [
        `Invalid commit scope: "${scope}"`,
        "",
        `Valid scopes: ${scopes.join(", ")}`,
      ].join("\n"),
    };
  }
  return { valid: true };
}
