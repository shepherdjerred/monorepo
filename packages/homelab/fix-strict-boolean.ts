#!/usr/bin/env bun
/**
 * Fix common strict-boolean-expressions patterns:
 * - `if (nullableString)` -> `if (nullableString !== undefined && nullableString !== "")`
 * - `if (!nullableString)` -> `if (nullableString === undefined || nullableString === "")`
 *
 * This requires manual review of each file to determine the correct fix.
 * Run ESLint to find violations and fix them manually.
 */

// Get all violations from ESLint
import { $ } from "bun";

const result = await $`cd /Users/jerred/git/monorepo/packages/homelab && bunx eslint . -f json 2>/dev/null`.text();
const data = JSON.parse(result);

type Violation = {
  file: string;
  line: number;
  column: number;
  message: string;
};

const violations: Violation[] = [];
for (const file of data) {
  for (const msg of file.messages) {
    if (msg.ruleId === "@typescript-eslint/strict-boolean-expressions") {
      violations.push({
        file: file.filePath,
        line: msg.line,
        column: msg.column,
        message: msg.message,
      });
    }
  }
}

console.log(`Found ${violations.length} strict-boolean-expressions violations`);

// Group by file
const byFile = new Map<string, Violation[]>();
for (const v of violations) {
  const list = byFile.get(v.file) ?? [];
  list.push(v);
  byFile.set(v.file, list);
}

for (const [file, vs] of byFile) {
  const rel = file.replace("/Users/jerred/git/monorepo/packages/homelab/", "");
  console.log(`\n${rel} (${vs.length} violations):`);
  for (const v of vs) {
    console.log(`  L${v.line}:${v.column} ${v.message}`);
  }
}
