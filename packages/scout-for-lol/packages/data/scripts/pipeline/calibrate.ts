// Calibrate the triage thresholds against the cached two-reference-judge labels
// (the 227 units, 1,280 tips the eval judged with Opus and GPT) and, when
// Jerred has marked tips, his marks too. Prints the table the thresholds in
// triage.ts were chosen from.
//
//   pipeline/calibrate.ts [--marks <marks.json>] [--review-set <review-set.json>]

import { parseArgs } from "node:util";
import {
  DECISIONS_PATH,
  DecisionsFileSchema,
} from "#src/tips/eval/decisions.ts";
import { readReports, reportKey } from "#src/tips/eval/rejudge.ts";
import { EVAL_MODELS } from "#src/tips/eval/report.ts";
import { asksAboutInteraction, routeOf } from "./triage.ts";

const MARKS_PATH =
  "/Users/jerred/.local/share/scout-redesign/tips-review/marks.json";

export type Labelled = {
  pWrong: number;
  text: string;
  /** Both reference judges call it wrong. */
  bothWrong: boolean;
  bothCorrect: boolean;
};

export async function labels(): Promise<Labelled[]> {
  const reports = await readReports(EVAL_MODELS, [1, 2]);
  const decisions = DecisionsFileSchema.parse(
    await Bun.file(DECISIONS_PATH).json(),
  );
  const byCase = new Map(
    decisions.cases.map((entry) => [`${entry.report}|${entry.case}`, entry]),
  );
  const rows: Labelled[] = [];
  for (const report of reports) {
    const [first, second] = report.judges;
    if (first === undefined || second === undefined) {
      continue;
    }
    for (const [caseIndex, entry] of report.cases.entries()) {
      const scored = byCase.get(`${reportKey(report)}|${caseIndex.toString()}`);
      if (scored === undefined) {
        continue;
      }
      for (const [setIndex, set] of entry.sets.entries()) {
        for (const [tipIndex, tip] of set.tips.entries()) {
          const a = tip.verdicts.find((v) => v.judge === first.model);
          const b = tip.verdicts.find((v) => v.judge === second.model);
          const score = scored.sets[setIndex]?.[tipIndex];
          if (a === undefined || b === undefined || score === undefined) {
            continue;
          }
          rows.push({
            pWrong: score.pWrong,
            text: tip.text,
            bothWrong: a.correctness === "wrong" && b.correctness === "wrong",
            bothCorrect:
              a.correctness === "correct" && b.correctness === "correct",
          });
        }
      }
    }
  }
  return rows;
}

const pct = (value: number): string => `${(value * 100).toFixed(1)}%`;

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: { marks: { type: "string", default: MARKS_PATH } },
    strict: true,
  });
  const rows = await labels();
  const bad = rows.filter((row) => row.bothWrong);
  const interacting = rows.filter((row) => asksAboutInteraction(row.text));
  console.log(
    `${rows.length.toString()} tips, ${bad.length.toString()} both-refs-wrong (${pct(bad.length / rows.length)}); ${interacting.length.toString()} state an interaction (${pct(interacting.length / rows.length)}), ${pct(interacting.filter((row) => row.bothWrong).length / Math.max(1, bad.length))} of the both-wrong tips among them`,
  );
  console.log(
    "| lo | hi | keep | repair | escalate | wrong kept (miss) | shipped wrong | repair that refs call wrong | repair that refs call correct | both-wrong reaching escalate or repair |",
  );
  console.log("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const lo of [0.05, 0.1, 0.15, 0.2, 0.3]) {
    for (const hi of [0.5, 0.7, 0.85, 0.95]) {
      const routed = rows.map((row) => ({
        row,
        route: routeOf(row.pWrong, row.text, { lo, hi }),
      }));
      const of = (route: string) =>
        routed.filter((entry) => entry.route === route);
      const keep = of("keep");
      const repair = of("repair");
      const escalate = of("escalate");
      const missed = keep.filter((entry) => entry.row.bothWrong).length;
      console.log(
        `| ${lo.toString()} | ${hi.toString()} | ${pct(keep.length / rows.length)} | ${pct(repair.length / rows.length)} | ${pct(escalate.length / rows.length)} | ${missed.toString()} of ${bad.length.toString()} | ${pct(missed / Math.max(1, keep.length))} | ${pct(repair.filter((e) => e.row.bothWrong).length / Math.max(1, repair.length))} | ${pct(repair.filter((e) => e.row.bothCorrect).length / Math.max(1, repair.length))} | ${pct((bad.length - missed) / Math.max(1, bad.length))} |`,
      );
    }
  }
  const marks = Bun.file(values.marks);
  if (await marks.exists()) {
    console.log(`marks found at ${values.marks}; see pipeline/marks.ts`);
  } else {
    console.log(`no marks at ${values.marks} yet`);
  }
}

if (import.meta.main) {
  await main();
}
