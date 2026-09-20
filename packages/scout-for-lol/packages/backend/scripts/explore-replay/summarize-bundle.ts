import path from "node:path";
import { readdir } from "node:fs/promises";
import { z } from "zod";
import {
  RollupCaseSchema,
  queryReach,
  rollupByCondition,
  signalTally,
  worstCases,
  type RollupCase,
} from "#src/explore/replay/rollup.ts";

/**
 * Read a replay bundle and print what a reviewer needs first.
 *
 * Read-only and offline: it opens the per-case records a run already wrote and
 * derives the rollups. Nothing here calls a model or touches a dataset, so it
 * is safe to run against a bundle over and over while reading it.
 */

const USAGE = `Usage: bun run explore:summarize -- <bundle-dir> [--worst <n>]

Prints condition rollups, signal counts and the cases most worth opening.`;

/** Only the fields the rollup needs; a case record carries much more. */
const CaseFileSchema = z
  .object({
    meta: z.object({
      caseId: z.string(),
      condition: z.string().nullable(),
      category: z.string().nullable(),
      expectation: z.enum(["answerable", "gated-off"]).nullable(),
    }),
    candidate: z.object({
      answer: z.string().nullable(),
      queryText: z.string().nullable(),
      rowsReturned: z.number().nullable(),
      toolNames: z.array(z.string()),
    }),
    signals: z.array(z.string()),
    error: z.string().nullable(),
  })
  .loose();

async function readCases(runDir: string): Promise<readonly RollupCase[]> {
  const caseDir = path.join(runDir, "cases");
  const files = (await readdir(caseDir)).filter((name) =>
    name.endsWith(".json"),
  );
  const cases: RollupCase[] = [];
  for (const file of files) {
    const raw: unknown = await Bun.file(path.join(caseDir, file)).json();
    const parsed = CaseFileSchema.parse(raw);
    cases.push(
      RollupCaseSchema.parse({
        caseId: parsed.meta.caseId,
        condition: parsed.meta.condition,
        category: parsed.meta.category,
        expectation: parsed.meta.expectation,
        status:
          parsed.error === null
            ? "ok"
            : parsed.error.toLowerCase().includes("abort")
              ? "timeout"
              : "error",
        signals: parsed.signals,
        answerLength: parsed.candidate.answer?.length ?? 0,
        rowsReturned: parsed.candidate.rowsReturned,
        toolNames: parsed.candidate.toolNames,
        queried: parsed.candidate.toolNames.includes("run_report_query"),
      }),
    );
  }
  return cases;
}

function pad(value: string, width: number): string {
  return value.length >= width
    ? value
    : value + " ".repeat(width - value.length);
}

async function main(): Promise<void> {
  const args = Bun.argv.slice(2);
  if (args.length === 0 || args.includes("--help")) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  const runDir = args[0];
  if (runDir === undefined) throw new Error("A bundle directory is required.");
  const worstIndex = args.indexOf("--worst");
  const worstLimit =
    worstIndex === -1 ? 10 : Number(args[worstIndex + 1] ?? "10");

  const cases = await readCases(runDir);
  const reach = queryReach(cases);

  const lines: string[] = [
    `${cases.length.toString()} cases in ${path.basename(runDir)}`,
    `queried the lake: ${reach.queried.toString()}  |  answered without a query: ${reach.answeredWithoutQuery.toString()}`,
    "",
    `${pad("condition", 14)}${pad("cases", 7)}${pad("expects", 12)}${pad("violations", 12)}${pad("queried", 9)}median len`,
  ];
  for (const row of rollupByCondition(cases)) {
    lines.push(
      `${pad(row.condition, 14)}${pad(row.cases.toString(), 7)}${pad(row.expectation, 12)}${pad(row.violations.toString(), 12)}${pad(row.queried.toString(), 9)}${row.medianAnswerLength.toString()}`,
    );
  }

  lines.push("", "signals:");
  const tally = signalTally(cases);
  if (tally.length === 0) lines.push("  (none)");
  for (const row of tally) {
    lines.push(`  ${pad(row.signal, 30)}${row.count.toString()}`);
  }

  lines.push("", `worst ${worstLimit.toString()} cases:`);
  for (const entry of worstCases(cases, worstLimit)) {
    lines.push(
      `  ${pad(entry.caseId, 20)}${pad(entry.condition ?? "-", 14)}${entry.signals.join(", ")}`,
    );
  }

  process.stdout.write(`${lines.join("\n")}\n`);
}

await main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
