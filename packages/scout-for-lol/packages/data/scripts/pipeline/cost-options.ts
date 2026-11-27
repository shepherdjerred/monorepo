// Cost against expected shipped quality for five configurations of the
// pipeline, from the last run's per-pass spend and the cached
// two-reference-judge labels. No API call.
//
//   pipeline/cost-options.ts [--write]

import { parseArgs } from "node:util";
import { z } from "zod";
import { EVAL_RAW_DIRECTORY } from "#src/tips/eval/raw-directory.ts";
import { labels } from "./calibrate.ts";
import { routeOf } from "./triage.ts";

const REPORT_PATH = `${EVAL_RAW_DIRECTORY}/pipeline-run.json`;
const OUTPUT_PATH = `${import.meta.dir}/../../src/tips/eval/cost-options.md`;

const ReportSchema = z.object({
  unitsRun: z.number(),
  spendByPass: z.record(z.string(), z.object({ usd: z.number() })),
  tipsPerSetAfterEachPass: z.array(
    z.object({ pass: z.string(), sets: z.record(z.string(), z.number()) }),
  ),
});

/** Sonnet's pass 1 for the same 35 units in the review set run ($0.757). */
const PASS_ONE_PER_UNIT = 0.757 / 35;
/** Combos with the empty-by-default prompt: generation only, almost nothing to escalate or reference. */
const COMBOS_PER_UNIT = 0.002;
/** Haiku 5.5 costs a twentieth of Sonnet 5.5 per token, input and output. */
const HAIKU_FACTOR = 0.05;
/** Sonnet medium's recall on the tips both references call wrong (eval-filter.md). */
const ESCALATION_MISS = 1 - 0.838;
/** Share of escalated and repaired tips that survive the passes (613 kept of 723 less the 225 not examined: from the run). */
const SURVIVE_EXAMINED = 0.78;
/** Of the tips escalated, the share the judge called wrong (104 of 410), and left not-checkable (48 of 410). */
const WRONG_OF_ESCALATED = 104 / 410;
const UNCHECKED_OF_ESCALATED = 48 / 410;
/** The unfiltered both-wrong rate of each generator in the eval: Haiku against Sonnet. */
const HAIKU_RATE_FACTOR = 0.09 / 0.08;
const FULL_UNITS = 2798;
const PATCH_UNITS = 380;
const REFERENCE_SETS = 62;

type Config = {
  name: string;
  fills: number;
  /** Decisions p(wrong) below which a tip with no interaction claim is kept unexamined. */
  lo: number;
  secondLook: boolean;
  haikuFills: boolean;
};

const CONFIGS: readonly Config[] = [
  {
    name: "(a) as run",
    fills: 3,
    lo: 0.15,
    secondLook: true,
    haikuFills: false,
  },
  {
    name: "(b) 2 fill passes",
    fills: 2,
    lo: 0.15,
    secondLook: true,
    haikuFills: false,
  },
  {
    name: "(c) escalate only p(wrong) >= 0.3 plus interaction claims",
    fills: 3,
    lo: 0.3,
    secondLook: true,
    haikuFills: false,
  },
  {
    name: "(d) (b) and (c), no second look",
    fills: 2,
    lo: 0.3,
    secondLook: false,
    haikuFills: false,
  },
  {
    name: "(e) (d) with Haiku fill passes",
    fills: 2,
    lo: 0.3,
    secondLook: false,
    haikuFills: true,
  },
];

const usd = (value: number): string =>
  value < 10 ? `$${value.toFixed(2)}` : `$${Math.round(value).toString()}`;
const pct = (value: number): string => `${(value * 100).toFixed(1)}%`;

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: { write: { type: "boolean", default: false } },
    strict: true,
  });
  const report = ReportSchema.parse(await Bun.file(REPORT_PATH).json());
  const units = report.unitsRun;
  const spend = (pass: string): number =>
    (report.spendByPass[pass]?.usd ?? 0) / units;
  const tipsAfter = (pass: string): number =>
    Object.values(
      report.tipsPerSetAfterEachPass.find((entry) => entry.pass === pass)
        ?.sets ?? {},
    ).reduce((a, b) => a + b, 0);
  const pass1Tips = tipsAfter("pass 1");
  const tipsByFills: Record<number, number> = {
    2: tipsAfter("fill 2"),
    3: tipsAfter("fill 3"),
  };
  const rows = await labels();

  const routing = (lo: number) => {
    const routed = rows.map((row) => ({
      row,
      route: routeOf(row.pWrong, row.text, { lo, hi: 0.85 }),
    }));
    const share = (route: string) =>
      routed.filter((entry) => entry.route === route).length / rows.length;
    const bad = (route: string) =>
      routed.filter((entry) => entry.route === route && entry.row.bothWrong)
        .length;
    return {
      keep: share("keep"),
      repair: share("repair"),
      escalate: share("escalate"),
      badKeep: bad("keep"),
      badOther: bad("escalate") + bad("repair"),
      badEscalate: bad("escalate"),
    };
  };
  const base = routing(0.15);
  const baseTips = tipsByFills[3] ?? 1;
  const baseEscalated = baseTips * base.escalate;
  const baseRepairLoad =
    baseTips * (base.repair + WRONG_OF_ESCALATED * base.escalate);

  const out: string[] = [];
  out.push("# Cost against shipped quality");
  out.push("");
  out.push(
    `Estimates from the last run's per-pass spend (${units.toString()} units) and the cached labels of the two reference judges (1,280 tips); nothing here was run. Cost is linear in units: ${FULL_UNITS.toString()} for a full run, ${PATCH_UNITS.toString()} for a typical patch; prefix-cache reuse across the plan would take 5 to 25% off.`,
  );
  out.push("");
  out.push(
    "| Configuration | Final tips per set | Both-reference-wrong share shipped | Full run | Per patch |",
  );
  out.push("| --- | --- | --- | --- | --- |");
  for (const config of CONFIGS) {
    const tips = tipsByFills[config.fills] ?? 0;
    const route = routing(config.lo);
    const escalated = tips * route.escalate;
    const repairLoad =
      tips * (route.repair + WRONG_OF_ESCALATED * route.escalate);
    const fillCost = [1, 2, 3]
      .filter((n) => n <= config.fills)
      .reduce((sum, n) => sum + spend(`fill:${n.toString()}`), 0);
    const perUnit =
      PASS_ONE_PER_UNIT +
      fillCost * (config.haikuFills ? HAIKU_FACTOR : 1) +
      (spend("triage") + spend("retriage")) * (tips / baseTips) +
      spend("escalate:lookup") * (escalated / baseEscalated) +
      (config.secondLook
        ? spend("escalate:search") * (escalated / baseEscalated)
        : 0) +
      (spend("repair") + spend("escalate:recheck")) *
        (repairLoad / baseRepairLoad) +
      COMBOS_PER_UNIT;

    // Tips per set: drops fall on the tips that were examined.
    const examined = route.escalate + route.repair;
    const finalTips = tips * (1 - examined * (1 - SURVIVE_EXAMINED));

    // Shipped both-wrong share: what triage keeps unexamined, plus what the
    // escalation judge misses among the rest, plus (with no second look) the
    // unchecked tips kept as they are.
    const fillShare = (tips - pass1Tips) / tips;
    const generator =
      1 + (config.haikuFills ? fillShare * (HAIKU_RATE_FACTOR - 1) : 0);
    const rowsN = rows.length;
    const escalateRate =
      route.badEscalate / Math.max(1, rowsN * route.escalate);
    const unchecked = config.secondLook
      ? 0
      : UNCHECKED_OF_ESCALATED * route.escalate * rowsN * escalateRate;
    const shippedBad =
      (route.badKeep + ESCALATION_MISS * route.badOther + unchecked) *
      generator;
    const shippedTips =
      rowsN * (route.keep + (1 - route.keep) * SURVIVE_EXAMINED);
    out.push(
      `| ${config.name} | ${(finalTips / REFERENCE_SETS).toFixed(1)} | ${pct(shippedBad / shippedTips)} | ${usd(perUnit * FULL_UNITS)} | ${usd(perUnit * PATCH_UNITS)} |`,
    );
  }
  out.push("");
  out.push(
    "Unfiltered, a generator's tips are 7.7% both-reference-wrong (Haiku 9.0%, Sonnet 8.0%, Opus 6.2%); Sonnet medium alone as a filter left 1.9%.",
  );
  out.push("");
  out.push("How the numbers are built:");
  out.push(
    `- Cost per unit: Sonnet pass 1 ($${PASS_ONE_PER_UNIT.toFixed(3)}), each fill pass as measured, triage scaled by the tip count, escalation and the second look by the number of tips escalated, repair and re-check by the number sent to repair or judged wrong, and $${COMBOS_PER_UNIT.toFixed(3)} for combos under the empty-by-default prompt.`,
  );
  out.push(
    "- (a) is below the $349 linear figure in the run report: that included combos at $0.012 per unit under the old prompt and the retry of the 4 units whose first answer failed ($0.004 per unit), neither of which a normal run pays.",
  );
  out.push(
    "- Share escalated, kept and repaired at each threshold is counted on the cached labels (calibration table); Decisions' p(wrong) is the same score the run used.",
  );
  out.push(
    `- Shipped both-reference-wrong: the both-wrong tips triage keeps unexamined, plus ${pct(ESCALATION_MISS)} of those in the escalated and repair buckets (Sonnet medium's measured miss rate), over the tips that survive. It assumes the repaired and re-checked tips are caught at the same rate; the pipeline's own repair step was not scored against the references. With no second look, the 12% of escalated tips left not-checkable ship as they are (interaction claims among them are still dropped, not counted here).`,
  );
  out.push(
    `- Final tips per set: tips after the fill passes (${((tipsByFills[2] ?? 0) / REFERENCE_SETS).toFixed(1)} after two, ${((tipsByFills[3] ?? 0) / REFERENCE_SETS).toFixed(1)} after three) less the ${pct(1 - SURVIVE_EXAMINED)} of examined tips the run dropped.`,
  );
  out.push(
    `- (e): Haiku costs a twentieth of Sonnet per token; its tips are 9.0% against Sonnet's 8.0% both-wrong before filtering in the eval, applied to the fill tips only. Haiku's fill tips per pass, and how many near-duplicates it writes, were not measured; the earlier Haiku sample wrote about five tips per side where Sonnet wrote six.`,
  );
  const text = `${out.join("\n")}\n`;
  console.log(text);
  if (values.write) {
    await Bun.write(OUTPUT_PATH, text);
  }
}

if (import.meta.main) {
  await main();
}
