#!/usr/bin/env bun
/**
 * Fix negated nullable expressions like !input.field where field is string | undefined.
 * These appear in if (!a || !b) guards. Transform to (a == null || a.length === 0).
 * Also fixes simple a && b where both are nullable strings.
 * Uses ESLint JSON output to find exact locations and applies text-based fixes.
 */
import path from "node:path";
import { $ } from "bun";
import { z } from "zod";

const ROOT = path.resolve(import.meta.dir, "..");

const EslintMessageSchema = z.object({
  ruleId: z.string().nullable(),
  line: z.number(),
  column: z.number(),
  endLine: z.number().optional(),
  endColumn: z.number().optional(),
  message: z.string(),
});
type EslintMessage = z.infer<typeof EslintMessageSchema>;

const EslintResultSchema = z.object({
  filePath: z.string(),
  messages: z.array(EslintMessageSchema),
});
const EslintOutputSchema = z.array(EslintResultSchema);

async function getEslintIssues(
  pkgPath: string,
): Promise<Map<string, EslintMessage[]>> {
  const result =
    await $`cd ${path.join(ROOT, pkgPath)} && bunx eslint . --format json`
      .quiet()
      .nothrow();
  const data = EslintOutputSchema.parse(JSON.parse(result.stdout.toString()));

  const issuesByFile = new Map<string, EslintMessage[]>();
  for (const file of data) {
    const relevant = file.messages.filter(
      (m) =>
        m.ruleId === "@typescript-eslint/strict-boolean-expressions" ||
        m.ruleId === "@typescript-eslint/no-unnecessary-condition",
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
    if (ch === "(") depth++;
    else if (ch === ")") {
      if (depth === 0) break;
      depth--;
    } else if (
      (ch === " " || ch === "|" || ch === "&" || ch === ")" || ch === ",") &&
      depth === 0
    )
      break;
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
  const isNegated = charBeforeCol === "!";

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
    const sbeMessages = messages.filter(
      (m) => m.ruleId === "@typescript-eslint/strict-boolean-expressions",
    );
    if (sbeMessages.length === 0) continue;

    const content = await Bun.file(filePath).text();
    const lines = content.split("\n");
    let modified = false;

    // Group by line - process from right to left (high col first) to preserve column positions
    const byLine = new Map<number, EslintMessage[]>();
    for (const msg of sbeMessages) {
      const existing = byLine.get(msg.line);
      if (existing) {
        existing.push(msg);
      } else {
        byLine.set(msg.line, [msg]);
      }
    }

    for (const [lineNum, lineMessages] of byLine) {
      // Sort by column descending so we fix from right to left
      lineMessages.sort((a, b) => b.column - a.column);

      let currentLine = lines[lineNum - 1]; // 0-indexed
      if (currentLine === undefined) continue;
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
      await Bun.write(filePath, lines.join("\n"));
      const rel = path.relative(ROOT, filePath);
      console.log(`  Fixed ${String(sbeMessages.length)} in ${rel}`);
    }
  }

  // Now handle no-unnecessary-condition (optional chains after null checks)
  const issuesByFile2 = await getEslintIssues(pkgPath);
  for (const [filePath, messages] of issuesByFile2) {
    const nucMessages = messages.filter(
      (m) => m.ruleId === "@typescript-eslint/no-unnecessary-condition",
    );
    if (nucMessages.length === 0) continue;

    const content = await Bun.file(filePath).text();
    const lines = content.split("\n");
    let modified = false;

    // Sort by line desc, then col desc
    nucMessages.sort((a, b) => b.line - a.line || b.column - a.column);

    for (const msg of nucMessages) {
      const lineIdx = msg.line - 1;
      const line = lines[lineIdx];
      if (line === undefined) continue;

      // Find the ?. at or near the column position
      const searchStart = Math.max(0, msg.column - 5);
      const searchEnd = Math.min(line.length, msg.column + 20);
      const segment = line.slice(searchStart, searchEnd);
      const qIdx = segment.indexOf("?.");
      if (qIdx !== -1) {
        const absIdx = searchStart + qIdx;
        lines[lineIdx] = line.slice(0, absIdx) + line.slice(absIdx + 1); // Remove '?'
        modified = true;
        totalFixes++;
      }
    }

    if (modified) {
      await Bun.write(filePath, lines.join("\n"));
      const rel = path.relative(ROOT, filePath);
      console.log(`  Fixed optional chains in ${rel}`);
    }
  }

  return totalFixes;
}

async function main() {
  const packages = process.argv.slice(2);
  if (packages.length === 0) {
    console.log(
      "Usage: bun run scripts/fix-negated-nullable.ts <pkg1> <pkg2> ...",
    );
    console.log(
      "Example: bun run scripts/fix-negated-nullable.ts packages/birmel packages/temporal",
    );
    process.exit(1);
  }

  let total = 0;
  for (const pkg of packages) {
    total += await processPackage(pkg);
  }

  console.log(`\nTotal fixes: ${String(total)}`);
}

try {
  await main();
} catch (error) {
  console.error(error);
}
