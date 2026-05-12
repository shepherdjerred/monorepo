#!/usr/bin/env bun
/**
 * Verify every tracked file's index line endings match its .gitattributes
 * declaration. Exits non-zero on any mismatch.
 *
 * Two failure modes:
 * 1. Index has CRLF/mixed but attributes don't say `eol=crlf` → file leaked
 *    Windows endings into a Unix-only path (the renovate-481 lesson).
 * 2. Index has LF but attributes say `eol=crlf` → Windows tooling will
 *    rewrite the file on save, producing churn.
 *
 * Files marked `-text` or `binary` are skipped (intentionally preserved).
 *
 * Used by:
 * - `lefthook.yml` pre-commit (staged files only, see check-line-endings hook)
 * - `scripts/ci/` Buildkite step (full repo)
 *
 * Usage:
 *   bun scripts/check-line-endings.ts          # full repo
 *   bun scripts/check-line-endings.ts <files>  # specific files (lefthook)
 */
import { spawnSync } from "node:child_process";

interface EolEntry {
  index: string;
  workTree: string;
  attr: string;
  path: string;
}

function parseEolLine(line: string): EolEntry | null {
  // Format: "i/<eol>  w/<eol>  attr/<attr>  \t<path>"
  // The work-tree column is empty when the file is not checked out, e.g.
  // "i/crlf  w/      attr/text=auto eol=lf 	path". So `w/` may be followed
  // by zero or more non-whitespace characters.
  const match = line.match(/^i\/(\S*)\s+w\/(\S*)\s+attr\/(.*?)\s*\t(.+)$/u);
  if (!match) return null;
  return {
    index: match[1] ?? "",
    workTree: match[2] ?? "",
    attr: match[3] ?? "",
    path: match[4] ?? "",
  };
}

function isViolation(entry: EolEntry): string | null {
  // Skip preserved-as-is files (binary, -text, archive/practice, fixtures).
  if (entry.attr.includes("-text") || entry.attr === "") return null;

  // Skip files git can't classify (symlinks have empty index/work-tree EOL,
  // empty files report `none`).
  if (entry.index === "" || entry.index === "none") return null;

  const wantsCrlf = entry.attr.includes("eol=crlf");

  // Index always stores LF for text files in git, so `i/lf` is correct for
  // both eol=lf AND eol=crlf paths. The relevant violations are CRLF or
  // mixed in the index, which mean the blob itself contains CR bytes.
  if (entry.index === "crlf" && !wantsCrlf) {
    return `index has CRLF but attributes want LF (attr=${entry.attr})`;
  }
  if (entry.index === "mixed") {
    return `index has MIXED line endings (attr=${entry.attr})`;
  }
  return null;
}

function main(): void {
  const args = process.argv.slice(2);
  const cmd = ["ls-files", "--eol", "-z"];
  if (args.length > 0) {
    cmd.push("--", ...args);
  }

  // maxBuffer: full repo --eol output exceeds the default 1 MiB cap.
  const result = spawnSync("git", cmd, {
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    console.error(
      `git ls-files --eol failed (status=${String(result.status)}, signal=${String(result.signal)}): ${result.stderr}`,
    );
    process.exit(2);
  }

  // -z gives NUL-terminated records. Each record is one line.
  const records = result.stdout.split("\0").filter((r) => r.length > 0);
  const violations: { path: string; reason: string }[] = [];

  for (const record of records) {
    const entry = parseEolLine(record);
    if (!entry) continue;
    const reason = isViolation(entry);
    if (reason !== null) {
      violations.push({ path: entry.path, reason });
    }
  }

  if (violations.length === 0) {
    if (args.length === 0) console.log(`✓ ${records.length} files clean`);
    process.exit(0);
  }

  console.error(
    `✗ ${violations.length} file(s) with line-ending violations:\n`,
  );
  for (const v of violations) {
    console.error(`  ${v.path}`);
    console.error(`    ${v.reason}`);
  }
  console.error(
    `\nFix: re-save the file as LF (or add an explicit \`eol=crlf\` rule\n` +
      `to .gitattributes if it really is a Windows-only file). Then run\n` +
      `\`git add --renormalize <path>\` and commit.`,
  );
  process.exit(1);
}

main();
