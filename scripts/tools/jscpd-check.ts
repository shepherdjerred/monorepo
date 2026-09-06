#!/usr/bin/env bun

/**
 * jscpd baseline ratchet — pins existing code duplication per file pair.
 *
 * The old gate was a single global threshold (3% duplicated lines), which is
 * fungible: new copy-paste in one package could hide behind deletions in
 * another, and the budget quietly absorbed hundreds of new clones. This
 * check mirrors scripts/tools/quality-ratchet.ts instead: every clone pair is
 * pinned to the SORTED pair of repo-relative file paths in
 * .jscpd-baseline.json. A brand-new pair, or more clones for an existing
 * pair, fails with the offending file:line ranges. Fewer clones than the
 * baseline also fails — run `bun run jscpd --update` to tighten the
 * baseline (unlike copies, ratchets only move one way on purpose).
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { run } from "../lib/run.ts";

export const BASELINE_FILE = ".jscpd-baseline.json";

const LocSchema = z.object({ line: z.number(), column: z.number() });
const FileRefSchema = z.object({
  name: z.string(),
  startLoc: LocSchema,
  endLoc: LocSchema,
});
const DuplicateSchema = z.object({
  tokens: z.number().int().nonnegative(),
  firstFile: FileRefSchema,
  secondFile: FileRefSchema,
});
const ReportSchema = z.object({ duplicates: z.array(DuplicateSchema) });

/**
 * Per-pair budget. `clones` alone is not enough: a pair whose single clone
 * grows from 70 to 700 tokens keeps count 1 and would slip through. Tokens
 * are jscpd's own size measure, so this ratchets the thing that actually
 * matters — how much duplicated code exists — not just how many fragments.
 */
export const PairBudgetSchema = z.object({
  clones: z.number().int().positive(),
  tokens: z.number().int().nonnegative(),
});
export type PairBudget = z.infer<typeof PairBudgetSchema>;

export const BaselineSchema = z.object({
  pairs: z.record(z.string(), PairBudgetSchema),
});
export type Baseline = z.infer<typeof BaselineSchema>;

export type Clone = {
  pair: string;
  tokens: number;
  firstFile: string;
  firstRange: string;
  secondFile: string;
  secondRange: string;
};

/** Baseline key: the two repo-relative paths, sorted, joined with `|`. */
export function pairKey(fileA: string, fileB: string): string {
  return [fileA, fileB].sort((a, b) => a.localeCompare(b)).join("|");
}

function toRepoRelative(name: string, repoRoot: string): string {
  const rel = path.isAbsolute(name) ? path.relative(repoRoot, name) : name;
  return rel.replaceAll("\\", "/");
}

/** Zod-parse a jscpd JSON report and normalize each clone to repo paths. */
export function parseReport(reportJson: unknown, repoRoot: string): Clone[] {
  const report = ReportSchema.parse(reportJson);
  return report.duplicates.map((duplicate) => {
    const firstFile = toRepoRelative(duplicate.firstFile.name, repoRoot);
    const secondFile = toRepoRelative(duplicate.secondFile.name, repoRoot);
    return {
      pair: pairKey(firstFile, secondFile),
      tokens: duplicate.tokens,
      firstFile,
      firstRange: `${String(duplicate.firstFile.startLoc.line)}-${String(duplicate.firstFile.endLoc.line)}`,
      secondFile,
      secondRange: `${String(duplicate.secondFile.startLoc.line)}-${String(duplicate.secondFile.endLoc.line)}`,
    };
  });
}

/** Aggregate clone count AND duplicated token size per file pair. */
export function countByPair(clones: Clone[]): Map<string, PairBudget> {
  const counts = new Map<string, PairBudget>();
  for (const clone of clones) {
    const existing = counts.get(clone.pair);
    counts.set(clone.pair, {
      clones: (existing?.clones ?? 0) + 1,
      tokens: (existing?.tokens ?? 0) + clone.tokens,
    });
  }
  return counts;
}

/** Rebuild the committed baseline object from the current scan. */
export function buildBaseline(clones: Clone[]): Baseline {
  const counts = countByPair(clones);
  const pairs: Record<string, PairBudget> = {};
  for (const key of [...counts.keys()].sort((a, b) => a.localeCompare(b))) {
    const budget = counts.get(key);
    if (budget === undefined) {
      throw new Error(`missing budget for pair ${key}`);
    }
    pairs[key] = budget;
  }
  return { pairs };
}

function describeClones(clones: Clone[], pair: string): string[] {
  return clones
    .filter((clone) => clone.pair === pair)
    .map(
      (clone) =>
        `    ${clone.firstFile}:${clone.firstRange} <-> ${clone.secondFile}:${clone.secondRange}`,
    );
}

/**
 * Compare the current scan to the baseline. Mirrors quality-ratchet.ts: new
 * pairs, more clones, or more duplicated tokens fail with locations;
 * decreases fail with an instruction to tighten (`--update` rewrites the
 * baseline). Tokens are checked as well as counts so that growing an
 * existing clone — same pair, same count, far more duplicated code — cannot
 * pass silently.
 */
export function compareToBaseline(
  clones: Clone[],
  baseline: Baseline,
): string[] {
  const failures: string[] = [];
  const current = countByPair(clones);

  const sortedPairs = [...current.keys()].sort((a, b) => a.localeCompare(b));
  for (const pair of sortedPairs) {
    const budget = current.get(pair);
    if (budget === undefined) {
      throw new Error(`missing budget for pair ${pair}`);
    }
    const allowed = baseline.pairs[pair];
    const names = pair.replaceAll("|", " and ");
    if (allowed === undefined) {
      failures.push(
        `FAIL: new duplication between ${names} (${String(budget.clones)} clone${budget.clones === 1 ? "" : "s"}, ${String(budget.tokens)} tokens):`,
        ...describeClones(clones, pair),
      );
    } else if (budget.clones > allowed.clones) {
      failures.push(
        `FAIL: duplication increased for ${names} (${String(budget.clones)} > ${String(allowed.clones)} clones allowed):`,
        ...describeClones(clones, pair),
      );
    } else if (budget.tokens > allowed.tokens) {
      failures.push(
        `FAIL: duplicated size grew for ${names} (${String(budget.tokens)} > ${String(allowed.tokens)} tokens allowed):`,
        ...describeClones(clones, pair),
      );
    }
  }

  for (const [pair, allowed] of Object.entries(baseline.pairs)) {
    const budget = current.get(pair);
    const clones_ = budget?.clones ?? 0;
    const tokens = budget?.tokens ?? 0;
    if (clones_ < allowed.clones) {
      failures.push(
        `FAIL: ${pair} has ${String(clones_)} clone${clones_ === 1 ? "" : "s"} but ${String(allowed.clones)} allowed — run \`bun run jscpd --update\` to tighten the baseline`,
      );
    } else if (tokens < allowed.tokens) {
      failures.push(
        `FAIL: ${pair} has ${String(tokens)} duplicated tokens but ${String(allowed.tokens)} allowed — run \`bun run jscpd --update\` to tighten the baseline`,
      );
    }
  }

  return failures;
}

async function scan(repoRoot: string): Promise<Clone[]> {
  const outputDir = await mkdtemp(path.join(tmpdir(), "jscpd-check-"));
  try {
    await run(
      [
        "bunx",
        "--no-install",
        "jscpd",
        "--reporters",
        "json",
        "--absolute",
        "--output",
        outputDir,
      ],
      { cwd: repoRoot },
    );
    const reportText = await readFile(
      path.join(outputDir, "jscpd-report.json"),
      "utf8",
    );
    const parsed: unknown = JSON.parse(reportText);
    return parseReport(parsed, repoRoot);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const repoRoot = path.join(import.meta.dirname, "..", "..");
  const update = process.argv.slice(2).includes("--update");
  const clones = await scan(repoRoot);

  const baselinePath = path.join(repoRoot, BASELINE_FILE);
  if (update) {
    const baseline = buildBaseline(clones);
    await Bun.write(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
    console.log(
      `${BASELINE_FILE} updated: ${String(Object.keys(baseline.pairs).length)} pairs, ${String(clones.length)} clones`,
    );
    return;
  }

  const baselineText = await readFile(baselinePath, "utf8");
  const baseline = BaselineSchema.parse(JSON.parse(baselineText));
  const failures = compareToBaseline(clones, baseline);

  console.log(
    `jscpd baseline: ${String(clones.length)} clones across ${String(countByPair(clones).size)} file pairs (${String(Object.keys(baseline.pairs).length)} allowed pairs)`,
  );

  if (failures.length > 0) {
    for (const line of failures) {
      console.error(line);
    }
    console.error(
      "\njscpd baseline ratchet failed. Deduplicate the new clones, or — only\n" +
        "for deliberate, reviewed duplication — run `bun run jscpd --update`.",
    );
    process.exit(1);
  }

  console.log("jscpd baseline ratchet passed");
}

if (import.meta.main) {
  await main();
}
