import path from "node:path";
import { readdir } from "node:fs/promises";
import { z } from "zod";
import { SuggestionConditionSchema } from "@scout-for-lol/data";
import {
  ExploreCapabilitySetSchema,
  chipExpectation as chipExpectationFor,
} from "#src/explore/replay/profiles.ts";
import { ReplayCaseCandidateSchema } from "#src/explore/replay/bundle.ts";
import { ReplayDiffSchema } from "#src/explore/replay/diff.ts";
import { scoreCase } from "#src/explore/replay/scoring.ts";
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
 *
 * Signals are RE-SCORED from the stored evidence rather than read back from
 * the record, through the same `scoreCase` the run itself used. A bundle is
 * what happened; the scoring is a judgement over it, and judgements change —
 * two did on the day the first full sweep was read. Re-deriving means a
 * grader fix reaches every bundle ever written, with no re-run and no spend.
 */

const USAGE = `Usage: bun run explore:summarize -- <bundle-dir> [--worst <n>]

Prints condition rollups, signal counts and the cases most worth opening.`;

/** Only the fields the rollup needs; a case record carries much more. */
const CaseFileSchema = z
  .object({
    meta: z
      .object({
        caseId: z.string(),
        condition: z.string().nullable(),
        category: z.string().nullable(),
        capabilities: ExploreCapabilitySetSchema,
        capabilityMismatches: z.array(z.string()),
        // Absent in bundles written before the field existed; derived from
        // `error` for those rather than refusing to read them.
        status: z.enum(["ok", "error", "timeout"]).optional(),
      })
      .loose(),
    candidate: ReplayCaseCandidateSchema,
    // The comparison the run recorded, absent in a bundle with no baseline.
    diff: ReplayDiffSchema.nullable().default(null),
    trace: z.array(
      z.object({ toolName: z.string(), status: z.string() }).loose(),
    ),
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
    const result = CaseFileSchema.safeParse(raw);
    if (!result.success) {
      // Re-scoring works on any bundle whose recorded capability set this
      // code understands. Adding a capability breaks that: the older bundle
      // never resolved it, so its cases say nothing about it, and inventing a
      // value would score evidence against a configuration that never ran.
      const missing = result.error.issues
        .filter(
          (issue) =>
            issue.path[0] === "meta" &&
            issue.path[1] === "capabilities" &&
            issue.code === "invalid_type",
        )
        .map((issue) => String(issue.path[2]));
      if (missing.length > 0) {
        throw new Error(
          [
            `${path.basename(runDir)} predates ${missing.join(", ")} and cannot be re-scored.`,
            "Its cases never resolved those capabilities, so no value for them would be true of this run.",
            "Re-run the sweep against a re-captured dataset pin to get a comparable bundle.",
          ].join("\n"),
        );
      }
      throw result.error;
    }
    const parsed = result.data;
    const status =
      parsed.meta.status ??
      (parsed.error === null
        ? "ok"
        : parsed.error.toLowerCase().includes("abort")
          ? "timeout"
          : "error");
    const condition = SuggestionConditionSchema.safeParse(
      parsed.meta.condition,
    );
    const scored = scoreCase({
      status,
      answer: parsed.candidate.answer,
      trace: parsed.trace,
      rowsReturned: parsed.candidate.rowsReturned,
      capabilities: parsed.meta.capabilities,
      condition: condition.success ? condition.data : null,
      capabilityMismatches: parsed.meta.capabilityMismatches,
      candidate: parsed.candidate,
      // The comparison the run recorded. It cannot be rebuilt here — the
      // baseline lived in another bundle — but it was stored, and discarding
      // it would drop `refusal_regression`, `rows_zero_was_nonzero` and
      // `numeric_claim_dropped` from every re-scored conversation and
      // `--baseline` run, making the summary quieter than the bundle.
      comparison:
        parsed.diff === null
          ? { kind: "none" }
          : { kind: "diff", diff: parsed.diff },
      normalizeQuery: (text) => text,
    });
    cases.push(
      RollupCaseSchema.parse({
        caseId: parsed.meta.caseId,
        condition: parsed.meta.condition,
        category: parsed.meta.category,
        expectation: condition.success
          ? chipExpectationFor(parsed.meta.capabilities, condition.data)
          : null,
        status,
        signals: scored.signals,
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
