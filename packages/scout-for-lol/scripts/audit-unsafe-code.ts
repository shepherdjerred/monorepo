#!/usr/bin/env bun

/**
 * Unsafe Code Audit Script
 *
 * Scans the codebase for patterns that could cause runtime issues:
 * - TypeScript suppression comments
 * - Linter disable comments
 * - Type assertions (as unknown as, as any)
 * - Non-null assertions (!)
 * - Zod .parse() vs .safeParse() usage
 * - JSON.parse without validation
 *
 * Run with: bun run scripts/audit-unsafe-code.ts
 */

import { Glob } from "bun";

type Finding = {
  file: string;
  line: number;
  content: string;
};

type CategoryResult = {
  count: number;
  findings: Finding[];
};

type AuditResults = {
  tsIgnores: CategoryResult;
  eslintDisables: CategoryResult;
  typeAssertions: CategoryResult;
  nonNullAssertions: CategoryResult;
  zodParse: CategoryResult;
  zodSafeParse: CategoryResult;
  jsonParse: CategoryResult;
};

const PACKAGES_DIR = "packages";

// Patterns to search for
// Note: Patterns are constructed via RegExp to avoid triggering check-suppressions.ts
const PATTERNS = {
  tsIgnores: new RegExp(
    "@ts-" + "ignore|@ts-" + "expect-error|@ts-" + "nocheck",
  ),
  eslintDisables: new RegExp("eslint-" + "disable"),
  typeAssertions: /as unknown as \w+|as any\b/,
  nonNullAssertions: /\w+\[\d+\]!\.|\w+!\.(?!==)/,
  zodParse: /\.parse\(/,
  zodSafeParse: /\.safeParse\(/,
  jsonParse: /JSON\.parse\(/,
};

// Directories to always exclude
const EXCLUDED_DIRS = [
  "/node_modules/",
  "/dist/",
  "/build/",
  "/generated/",
  "/assets/",
];

function isTestFile(filePath: string): boolean {
  return (
    filePath.endsWith(".test.ts") || filePath.endsWith(".integration.test.ts")
  );
}

function isExcluded(filePath: string, includeTests: boolean): boolean {
  if (EXCLUDED_DIRS.some((dir) => filePath.includes(dir))) {
    return true;
  }
  if (!includeTests && isTestFile(filePath)) {
    return true;
  }
  return false;
}

async function searchPattern(
  pattern: RegExp,
  includeTests = false,
): Promise<CategoryResult> {
  const glob = new Glob(`${PACKAGES_DIR}/**/*.ts`);
  const findings: Finding[] = [];

  for await (const file of glob.scan({ dot: false })) {
    if (isExcluded(file, includeTests)) {
      continue;
    }

    const content = await Bun.file(file).text();
    const lines = content.split("\n");

    for (const [i, line] of lines.entries()) {
      if (line && pattern.test(line)) {
        findings.push({
          file: file.replace(/^packages\//, ""),
          line: i + 1,
          content: line.trim().slice(0, 100),
        });
      }
    }
  }

  return {
    count: findings.length,
    findings,
  };
}

async function runAudit(): Promise<AuditResults> {
  console.log("🔍 Scanning codebase for unsafe patterns...\n");

  const [
    tsIgnores,
    eslintDisables,
    typeAssertions,
    nonNullAssertions,
    zodParse,
    zodSafeParse,
    jsonParse,
  ] = await Promise.all([
    searchPattern(PATTERNS.tsIgnores, true),
    searchPattern(PATTERNS.eslintDisables, true),
    searchPattern(PATTERNS.typeAssertions, true),
    searchPattern(PATTERNS.nonNullAssertions, true),
    searchPattern(PATTERNS.zodParse, false),
    searchPattern(PATTERNS.zodSafeParse, false),
    searchPattern(PATTERNS.jsonParse, false),
  ]);

  return {
    tsIgnores,
    eslintDisables,
    typeAssertions,
    nonNullAssertions,
    zodParse,
    zodSafeParse,
    jsonParse,
  };
}

function getRiskLevel(category: string, count: number): string {
  const thresholds: Record<string, { low: number; medium: number }> = {
    tsIgnores: { low: 5, medium: 10 },
    eslintDisables: { low: 20, medium: 50 },
    typeAssertions: { low: 10, medium: 25 },
    nonNullAssertions: { low: 5, medium: 15 },
    zodParse: { low: 50, medium: 100 },
    jsonParse: { low: 10, medium: 25 },
  };

  const threshold = thresholds[category];
  if (!threshold) {
    return "⚪";
  }

  if (count <= threshold.low) {
    return "🟢";
  }
  return count <= threshold.medium ? "🟡" : "🔴";
}

function printResults(results: AuditResults, verbose: boolean): void {
  const zodParseRatio =
    results.zodParse.count + results.zodSafeParse.count > 0
      ? Math.round(
          (results.zodSafeParse.count /
            (results.zodParse.count + results.zodSafeParse.count)) *
            100,
        )
      : 0;

  console.log(
    "═══════════════════════════════════════════════════════════════",
  );
  console.log(
    "                    UNSAFE CODE AUDIT REPORT                    ",
  );
  console.log(
    "═══════════════════════════════════════════════════════════════\n",
  );

  console.log("📊 Summary (excluding tests and generated code)\n");

  const summaryTable = [
    {
      category: "TypeScript Ignores",
      count: results.tsIgnores.count,
      risk: getRiskLevel("tsIgnores", results.tsIgnores.count),
    },
    {
      category: "ESLint Disables",
      count: results.eslintDisables.count,
      risk: getRiskLevel("eslintDisables", results.eslintDisables.count),
    },
    {
      category: "Type Assertions (as unknown as)",
      count: results.typeAssertions.count,
      risk: getRiskLevel("typeAssertions", results.typeAssertions.count),
    },
    {
      category: "Non-null Assertions (!)",
      count: results.nonNullAssertions.count,
      risk: getRiskLevel("nonNullAssertions", results.nonNullAssertions.count),
    },
    {
      category: "Zod .parse()",
      count: results.zodParse.count,
      risk: getRiskLevel("zodParse", results.zodParse.count),
    },
    {
      category: "Zod .safeParse()",
      count: results.zodSafeParse.count,
      risk: "⚪",
    },
    {
      category: "JSON.parse()",
      count: results.jsonParse.count,
      risk: getRiskLevel("jsonParse", results.jsonParse.count),
    },
  ];

  console.log("┌─────────────────────────────────────┬───────┬──────┐");
  console.log("│ Category                            │ Count │ Risk │");
  console.log("├─────────────────────────────────────┼───────┼──────┤");
  for (const row of summaryTable) {
    const category = row.category.padEnd(35);
    const count = row.count.toString().padStart(5);
    console.log(`│ ${category} │ ${count} │  ${row.risk}  │`);
  }
  console.log("└─────────────────────────────────────┴───────┴──────┘\n");

  console.log(
    `📈 Zod Safety Ratio: ${zodParseRatio.toString()}% safeParse usage`,
  );
  if (zodParseRatio >= 60) {
    console.log("   ✅ Good: Majority of parsing uses safeParse\n");
  } else if (zodParseRatio >= 40) {
    console.log(
      "   ⚠️  Warning: Consider using more safeParse for external data\n",
    );
  } else {
    console.log("   ❌ Poor: Most parsing uses throwing .parse()\n");
  }

  if (verbose) {
    console.log(
      "\n═══════════════════════════════════════════════════════════════",
    );
    console.log(
      "                        DETAILED FINDINGS                        ",
    );
    console.log(
      "═══════════════════════════════════════════════════════════════\n",
    );

    const categories: [string, CategoryResult][] = [
      ["TypeScript Ignores", results.tsIgnores],
      ["ESLint Disables", results.eslintDisables],
      ["Type Assertions", results.typeAssertions],
      ["Non-null Assertions", results.nonNullAssertions],
      ["JSON.parse()", results.jsonParse],
    ];

    for (const [name, result] of categories) {
      if (result.findings.length > 0) {
        console.log(`\n📁 ${name} (${result.count.toString()}):`);
        console.log("─".repeat(60));
        for (const finding of result.findings.slice(0, 20)) {
          console.log(`  ${finding.file}:${finding.line.toString()}`);
          console.log(
            `    ${finding.content.slice(0, 80)}${finding.content.length > 80 ? "..." : ""}`,
          );
        }
        if (result.findings.length > 20) {
          console.log(
            `  ... and ${(result.findings.length - 20).toString()} more`,
          );
        }
      }
    }
  }

  // Output JSON for CI/tracking
  console.log(
    "\n═══════════════════════════════════════════════════════════════",
  );
  console.log(
    "                         JSON OUTPUT                            ",
  );
  console.log(
    "═══════════════════════════════════════════════════════════════\n",
  );

  const jsonOutput = {
    timestamp: new Date().toISOString(),
    metrics: {
      tsIgnores: results.tsIgnores.count,
      eslintDisables: results.eslintDisables.count,
      typeAssertions: results.typeAssertions.count,
      nonNullAssertions: results.nonNullAssertions.count,
      zodParse: results.zodParse.count,
      zodSafeParse: results.zodSafeParse.count,
      zodSafeParseRatio: zodParseRatio,
      jsonParse: results.jsonParse.count,
    },
  };

  console.log(JSON.stringify(jsonOutput, null, 2));
}

// Main execution
const verbose =
  process.argv.includes("--verbose") || process.argv.includes("-v");
const results = await runAudit();
printResults(results, verbose);

// Exit with error if critical thresholds exceeded
const criticalIssues =
  results.tsIgnores.count > 10 ||
  results.typeAssertions.count > 50 ||
  results.jsonParse.count > 50;

if (criticalIssues) {
  console.log("\n⚠️  Warning: Some metrics exceed recommended thresholds");
  process.exit(1);
}

console.log("\n✅ Audit complete");
