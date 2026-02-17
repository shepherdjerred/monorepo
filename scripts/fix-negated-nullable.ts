#!/usr/bin/env bun
/**
 * Fix negated nullable expressions like !input.field where field is string | undefined.
 * These appear in if (!a || !b) guards. Transform to (a == null || a.length === 0).
 * Also fixes simple a && b where both are nullable strings.
 * Uses ESLint JSON output to find exact locations and applies text-based fixes.
 */
import * as path from "node:path";
import * as fs from "node:fs";
import { $ } from "bun";

const ROOT = path.resolve(import.meta.dir, "..");

type EslintMessage = {
  ruleId: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  message: string;
};

type EslintResult = {
  filePath: string;
  messages: EslintMessage[];
};

async function getEslintIssues(pkgPath: string): Promise<Map<string, EslintMessage[]>> {
  const result = await $`cd ${path.join(ROOT, pkgPath)} && bunx eslint . --format json`.quiet().nothrow();
  const data = JSON.parse(result.stdout.toString()) as EslintResult[];

  const issuesByFile = new Map<string, EslintMessage[]>();
  for (const file of data) {
    const relevant = file.messages.filter(m =>
      m.ruleId === "@typescript-eslint/strict-boolean-expressions" ||
      m.ruleId === "@typescript-eslint/no-unnecessary-condition"
    );
    if (relevant.length > 0) {
      issuesByFile.set(file.filePath, relevant);
    }
  }
  return issuesByFile;
}

function fixLine(line: string, col: number, message: string): string {
  // The col points to the expression. We need to figure out if it's negated.
  // Check if the character before the col is '!'
  const charBeforeCol = line[col - 2]; // col is 1-based
  const exprStart = col - 1; // 0-based

  // Extract the expression at this column
  // We need to find the end of the identifier/member expression
  let exprEnd = exprStart;
  let depth = 0;
  while (exprEnd < line.length) {
    const ch = line[exprEnd];
    if (ch === '(') depth++;
    else if (ch === ')') {
      if (depth === 0) break;
      depth--;
    }
    else if (ch === ' ' || ch === '|' || ch === '&' || ch === ')' || ch === ',') {
      if (depth === 0) break;
    }
    exprEnd++;
  }

  const expr = line.slice(exprStart, exprEnd);

  // Determine what kind of fix is needed based on the message
  const isNullableString = message.includes("nullable string");
  const isNullableBool = message.includes("nullable boolean");
  const isNullableNum = message.includes("nullable number");
  const isNullableEnum = message.includes("nullable enum");
  const isAny = message.includes("any value");

  // Check if negated (! before expression)
  const isNegated = charBeforeCol === '!';

  let replacement: string;
  if (isNullableString) {
    if (isNegated) {
      replacement = `(${expr} == null || ${expr}.length === 0)`;
      // Also remove the ! before
      return line.slice(0, col - 2) + replacement + line.slice(exprEnd);
    } else {
      replacement = `(${expr} != null && ${expr}.length > 0)`;
      return line.slice(0, exprStart) + replacement + line.slice(exprEnd);
    }
  } else if (isNullableBool) {
    if (isNegated) {
      replacement = `${expr} !== true`;
      return line.slice(0, col - 2) + replacement + line.slice(exprEnd);
    } else {
      replacement = `${expr} === true`;
      return line.slice(0, exprStart) + replacement + line.slice(exprEnd);
    }
  } else if (isNullableNum || isNullableEnum) {
    if (isNegated) {
      replacement = `${expr} == null`;
      return line.slice(0, col - 2) + replacement + line.slice(exprEnd);
    } else {
      replacement = `${expr} != null`;
      return line.slice(0, exprStart) + replacement + line.slice(exprEnd);
    }
  } else if (isAny) {
    // For any values, add a type assertion or null check
    if (isNegated) {
      replacement = `${expr} == null`;
      return line.slice(0, col - 2) + replacement + line.slice(exprEnd);
    } else {
      replacement = `${expr} != null`;
      return line.slice(0, exprStart) + replacement + line.slice(exprEnd);
    }
  }

  return line; // No change
}

async function processPackage(pkgPath: string): Promise<number> {
  console.log(`\nProcessing ${pkgPath}...`);
  const issuesByFile = await getEslintIssues(pkgPath);

  let totalFixes = 0;

  for (const [filePath, messages] of issuesByFile) {
    const sbeMessages = messages.filter(m => m.ruleId === "@typescript-eslint/strict-boolean-expressions");
    if (sbeMessages.length === 0) continue;

    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    let modified = false;

    // Group by line - process from right to left (high col first) to preserve column positions
    const byLine = new Map<number, EslintMessage[]>();
    for (const msg of sbeMessages) {
      if (!byLine.has(msg.line)) byLine.set(msg.line, []);
      byLine.get(msg.line)!.push(msg);
    }

    for (const [lineNum, lineMessages] of byLine) {
      // Sort by column descending so we fix from right to left
      lineMessages.sort((a, b) => b.column - a.column);

      let currentLine = lines[lineNum - 1]; // 0-indexed
      for (const msg of lineMessages) {
        const newLine = fixLine(currentLine, msg.column, msg.message);
        if (newLine !== currentLine) {
          currentLine = newLine;
          modified = true;
          totalFixes++;
        }
      }
      lines[lineNum - 1] = currentLine;
    }

    if (modified) {
      fs.writeFileSync(filePath, lines.join("\n"));
      const rel = path.relative(ROOT, filePath);
      console.log(`  Fixed ${sbeMessages.length} in ${rel}`);
    }
  }

  // Now handle no-unnecessary-condition (optional chains after null checks)
  const issuesByFile2 = await getEslintIssues(pkgPath);
  for (const [filePath, messages] of issuesByFile2) {
    const nucMessages = messages.filter(m => m.ruleId === "@typescript-eslint/no-unnecessary-condition");
    if (nucMessages.length === 0) continue;

    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    let modified = false;

    // Sort by line desc, then col desc
    nucMessages.sort((a, b) => b.line - a.line || b.column - a.column);

    for (const msg of nucMessages) {
      const lineIdx = msg.line - 1;
      const line = lines[lineIdx];

      // Find the ?. at or near the column position
      const searchStart = Math.max(0, msg.column - 5);
      const searchEnd = Math.min(line.length, msg.column + 20);
      const segment = line.slice(searchStart, searchEnd);
      const qIdx = segment.indexOf("?.");
      if (qIdx >= 0) {
        const absIdx = searchStart + qIdx;
        lines[lineIdx] = line.slice(0, absIdx) + line.slice(absIdx + 1); // Remove '?'
        modified = true;
        totalFixes++;
      }
    }

    if (modified) {
      fs.writeFileSync(filePath, lines.join("\n"));
      const rel = path.relative(ROOT, filePath);
      console.log(`  Fixed optional chains in ${rel}`);
    }
  }

  return totalFixes;
}

async function main() {
  const packages = process.argv.slice(2);
  if (packages.length === 0) {
    console.log("Usage: bun run scripts/fix-negated-nullable.ts <pkg1> <pkg2> ...");
    console.log("Example: bun run scripts/fix-negated-nullable.ts packages/birmel packages/clauderon/web/frontend");
    process.exit(1);
  }

  let total = 0;
  for (const pkg of packages) {
    total += await processPackage(pkg);
  }

  console.log(`\nTotal fixes: ${total}`);
}

main().catch(console.error);
