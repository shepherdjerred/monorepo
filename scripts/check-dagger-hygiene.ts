#!/usr/bin/env bun

/**
 * Dagger hygiene checker — scans CI/pipeline code for banned patterns.
 *
 * Banned patterns are things like silent error swallowing, secret leaks,
 * overbroad git staging, and quality gate bypasses. Any match outside the
 * allowlist fails the check.
 */

import { $ } from "bun";

interface BannedPattern {
  name: string;
  pattern: string;
}

interface AllowlistEntry {
  /** File path substring to match */
  file: string;
  /** Pattern name this allowlist entry applies to */
  patternName: string;
  /** Optional: specific line content substring that must also match */
  lineContains?: string;
}

const BANNED_PATTERNS: BannedPattern[] = [
  { name: "silent-error-swallow", pattern: String.raw`\|\| true` },
  { name: "hidden-stderr", pattern: String.raw`2>/dev/null` },
  { name: "frozen-lockfile-bypass", pattern: String.raw`\|\| bun install` },
  { name: "error-to-message", pattern: String.raw`\|\| echo` },
  { name: "token-in-url", pattern: String.raw`x-access-token` },
  { name: "secret-on-disk", pattern: String.raw`> ~/\.npmrc|> /root/\.npmrc` },
  { name: "overbroad-staging", pattern: String.raw`git add -A|git add \.` },
  { name: "quality-gate-bypass", pattern: String.raw`--no-exit-code` },
];

const SEARCH_PATHS = [".dagger/src/", "scripts/ci/src/"];
const FILE_INCLUDE = "*.ts";

const ALLOWLIST: AllowlistEntry[] = [
  {
    file: "scripts/check-dagger-hygiene.ts",
    patternName: "*",
  },
  {
    file: "scripts/quality-ratchet.ts",
    patternName: "*",
  },
  {
    file: ".dagger/src/release.ts",
    patternName: "silent-error-swallow",
    lineContains: "playwright install",
  },
  {
    file: ".dagger/src/release.ts",
    patternName: "hidden-stderr",
    lineContains: "playwright install",
  },
  {
    file: ".dagger/src/release.ts",
    patternName: "hidden-stderr",
    lineContains: "cooklang-obsidian-releases/contents",
  },
  {
    file: ".dagger/src/release.ts",
    patternName: "error-to-message",
    lineContains: "cooklang-obsidian-releases/contents",
  },
];

interface Violation {
  file: string;
  lineNumber: string;
  line: string;
  patternName: string;
}

function isAllowlisted(
  file: string,
  patternName: string,
  lineContent: string,
): boolean {
  return ALLOWLIST.some((entry) => {
    if (!file.includes(entry.file)) return false;
    if (entry.patternName !== "*" && entry.patternName !== patternName)
      return false;
    if (
      entry.lineContains !== undefined &&
      !lineContent.includes(entry.lineContains)
    )
      return false;
    return true;
  });
}

async function scanPattern(banned: BannedPattern): Promise<Violation[]> {
  const violations: Violation[] = [];

  // grep -rnE returns file:line_number:line_content
  // Exit code 1 means no matches — not an error
  const result =
    await $`grep -rnE -e ${banned.pattern} ${SEARCH_PATHS} --include ${FILE_INCLUDE} 2>/dev/null || true`.text();

  for (const line of result.split("\n")) {
    if (line.trim() === "") continue;

    // Parse grep output: file:lineNumber:content
    const firstColon = line.indexOf(":");
    if (firstColon === -1) continue;
    const secondColon = line.indexOf(":", firstColon + 1);
    if (secondColon === -1) continue;

    const file = line.slice(0, firstColon);
    const lineNumber = line.slice(firstColon + 1, secondColon);
    const lineContent = line.slice(secondColon + 1);

    if (isAllowlisted(file, banned.name, lineContent)) continue;

    violations.push({
      file,
      lineNumber,
      line: lineContent.trim(),
      patternName: banned.name,
    });
  }

  return violations;
}

async function main(): Promise<void> {
  const allViolations: Violation[] = [];

  for (const banned of BANNED_PATTERNS) {
    const violations = await scanPattern(banned);
    allViolations.push(...violations);
  }

  if (allViolations.length > 0) {
    console.error("Dagger hygiene violations:\n");
    for (const v of allViolations) {
      console.error(`  ${v.file}:${v.lineNumber} [${v.patternName}]`);
      console.error(`    ${v.line}\n`);
    }
    console.error(`${String(allViolations.length)} violations found`);
    process.exit(1);
  }

  console.log("No violations found");
}

await main();
