import type { EvalReport, JudgeTotals } from "#src/tips/eval/report.ts";
import { TIP_SOURCES } from "#src/tips/prompt.ts";

/**
 * The committed summary of the eval reports: one column per generator model,
 * each cell the mean of its runs with every run beside it, and the projected
 * cost of a full run and of a patch.
 */

function rate(count: number, total: number): number {
  return total === 0 ? 0 : Math.round((count / total) * 10_000) / 10_000;
}

/** The size of the plan a full run or a patch would work through. */
export type PlanShape = {
  matchupUnits: number;
  generalSets: number;
  /** Pair units a champion is in, averaged over the champions in the plan. */
  unitsPerChampion: number;
  /** General sets (lanes) per champion in the plan. */
  generalPerChampion: number;
  /** Champions a typical patch changes. */
  patchChampions: number;
};

export type CostProjection = { fullRunUsd: number; patchUsd: number };

export function projectCost(
  report: EvalReport,
  shape: PlanShape,
): CostProjection {
  const { costPerMatchupCaseUsd, costPerGeneralCaseUsd } = report.totals;
  return {
    fullRunUsd:
      shape.matchupUnits * costPerMatchupCaseUsd +
      shape.generalSets * costPerGeneralCaseUsd,
    patchUsd:
      shape.patchChampions *
      (shape.unitsPerChampion * costPerMatchupCaseUsd +
        shape.generalPerChampion * costPerGeneralCaseUsd),
  };
}

function oneDecimal(value: number): string {
  return value.toFixed(2);
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function dollars(value: number): string {
  return value < 0.1 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`;
}

type Metric = {
  label: string;
  value: (report: EvalReport) => number;
  format: (value: number) => string;
};

function judgeOf(report: EvalReport, position: 0 | 1): JudgeTotals {
  const judge = report.judges[position];
  if (judge === undefined) {
    throw new Error(
      `report ${report.model} run ${report.run.toString()} has no judge ${position.toString()}`,
    );
  }
  return judge;
}

function metrics(
  shape: PlanShape,
  judges: readonly [string, string],
): Metric[] {
  return [
    {
      label: "First-attempt pass rate",
      value: (r) => r.totals.firstAttemptPassRate,
      format: percent,
    },
    {
      label: "Final pass rate (after one retry)",
      value: (r) => r.totals.finalPassRate,
      format: percent,
    },
    {
      label: "Dropped units (of 40)",
      value: (r) => r.totals.dropped,
      format: (v) => v.toFixed(1),
    },
    {
      label: `Judged wrong, ${judges[0]}`,
      value: (r) => judgeOf(r, 0).wrongRate,
      format: percent,
    },
    {
      label: `Judged wrong, ${judges[1]}`,
      value: (r) => judgeOf(r, 1).wrongRate,
      format: percent,
    },
    {
      label: "Judged wrong by both judges",
      value: (r) => rate(r.agreement.bothWrong, r.agreement.tips),
      format: percent,
    },
    {
      label: `Judged correct, ${judges[0]}`,
      value: (r) => judgeOf(r, 0).correctRate,
      format: percent,
    },
    {
      label: `Judged correct, ${judges[1]}`,
      value: (r) => judgeOf(r, 1).correctRate,
      format: percent,
    },
    {
      label: `Judged not checkable, ${judges[0]}`,
      value: (r) => judgeOf(r, 0).notCheckableRate,
      format: percent,
    },
    {
      label: `Judged not checkable, ${judges[1]}`,
      value: (r) => judgeOf(r, 1).notCheckableRate,
      format: percent,
    },
    {
      label: `Judged useful, ${judges[0]}`,
      value: (r) => judgeOf(r, 0).usefulRate,
      format: percent,
    },
    {
      label: `Judged useful, ${judges[1]}`,
      value: (r) => judgeOf(r, 1).usefulRate,
      format: percent,
    },
    {
      label: "Judged plain (mean of judges)",
      value: (r) => (judgeOf(r, 0).plainRate + judgeOf(r, 1).plainRate) / 2,
      format: percent,
    },
    {
      label: "Judges agree on correctness",
      value: (r) => r.agreement.correctnessAgreeRate,
      format: percent,
    },
    {
      label: "Judge agreement, Cohen's kappa",
      value: (r) => r.agreement.kappa,
      format: (v) => v.toFixed(2),
    },
    {
      label: "Generator tool calls per unit",
      value: (r) => r.totals.toolCallsPerUnit,
      format: oneDecimal,
    },
    {
      label: "Wiki pages used per unit",
      value: (r) => r.totals.wikiPagesPerUnit,
      format: oneDecimal,
    },
    {
      label: "Judge tool calls per unit",
      value: (r) => r.judgeToolCallsPerUnit,
      format: oneDecimal,
    },
    {
      label: "Cost per matchup pair",
      value: (r) => r.totals.costPerMatchupCaseUsd,
      format: dollars,
    },
    {
      label: "Cost per general set",
      value: (r) => r.totals.costPerGeneralCaseUsd,
      format: dollars,
    },
    {
      label: `Full run (${shape.matchupUnits.toString()} pairs + ${shape.generalSets.toString()} general)`,
      value: (r) => projectCost(r, shape).fullRunUsd,
      format: dollars,
    },
    {
      label: `Typical patch (${shape.patchChampions.toString()} champions changed, every touched unit regenerated)`,
      value: (r) => projectCost(r, shape).patchUsd,
      format: dollars,
    },
  ];
}

/** The committed summary: one column per generator model, each cell the mean of its runs with every run beside it. */
/** Tips (accepted units only) of a report. */
function tipsOf(
  report: EvalReport,
): EvalReport["cases"][number]["sets"][number]["tips"] {
  return report.cases.flatMap((entry) =>
    entry.status === "dropped" ? [] : entry.sets.flatMap((set) => set.tips),
  );
}

/** Share of the generator's tips that name a source, over a report. */
function generatorSourceShare(report: EvalReport, source: string): number {
  const tips = tipsOf(report);
  return rate(
    tips.filter((tip) => tip.sources.includes(source)).length,
    tips.length,
  );
}

/** Share of one judge's verdicts that name a source, pooled over reports. */
function judgeSourceShare(
  reports: readonly EvalReport[],
  judge: string,
  source: string,
): number {
  const verdicts = reports.flatMap((report) =>
    tipsOf(report).flatMap((tip) =>
      tip.verdicts.filter((verdict) => verdict.judge === judge),
    ),
  );
  return rate(
    verdicts.filter((verdict) => verdict.sources.includes(source)).length,
    verdicts.length,
  );
}

/** How often the generator and the judges relied on each source. */
function sourceTable(
  reports: readonly EvalReport[],
  models: readonly string[],
  judges: readonly [string, string],
): string[] {
  const runsOf = (model: string): EvalReport[] =>
    reports.filter((report) => report.model === model);
  const header = `| Source | ${models.map((model) => `generator ${model}`).join(" | ")} | judge ${judges[0]} | judge ${judges[1]} |`;
  const divider = `| --- |${[...models, ...judges].map(() => " --- |").join("")}`;
  const rows = TIP_SOURCES.map((source) => {
    const generator = models.map((model) => {
      const shares = runsOf(model).map((report) =>
        generatorSourceShare(report, source),
      );
      return percent(
        shares.reduce((sum, value) => sum + value, 0) /
          Math.max(1, shares.length),
      );
    });
    const judged = judges.map((judge) =>
      percent(judgeSourceShare(reports, judge, source)),
    );
    return `| ${source} | ${[...generator, ...judged].join(" | ")} |`;
  });
  return [header, divider, ...rows];
}

export function renderSummary(
  reports: readonly EvalReport[],
  shape: PlanShape,
): string {
  const models = [...new Set(reports.map((report) => report.model))];
  const first = reports[0];
  if (first === undefined) {
    throw new Error("a summary needs at least one report");
  }
  const judges: readonly [string, string] = [
    judgeOf(first, 0).model,
    judgeOf(first, 1).model,
  ];
  const runsOf = (model: string): EvalReport[] =>
    reports
      .filter((report) => report.model === model)
      .toSorted((left, right) => left.run - right.run);
  const header = `| | ${models.join(" | ")} |`;
  const divider = `| --- |${models.map(() => " --- |").join("")}`;
  const body = metrics(shape, judges).map((metric) => {
    const cells = models.map((model) => {
      const values = runsOf(model).map((report) => metric.value(report));
      const mean =
        values.reduce((sum, value) => sum + value, 0) /
        Math.max(1, values.length);
      return `${metric.format(mean)} (${values.map((value) => metric.format(value)).join(" / ")})`;
    });
    return `| ${metric.label} | ${cells.join(" | ")} |`;
  });
  return [
    "# Tip eval summary",
    "",
    `Generator models compared on the same 40 cases and prompt (\`${first.promptVersion}\`). Each unit is judged by two judge models from different families, ${judges.join(" and ")}, each with the wiki ability notes and a lookup tool (\`${first.judgePromptVersion}\`). Each cell is the mean of the model's runs, with each run in brackets: the run-to-run spread. Costs are the generator's only. The projections scale the per-case cost by the plan: ${shape.unitsPerChampion.toFixed(1)} pair units and ${shape.generalPerChampion.toFixed(1)} general sets per champion; a patch that changes ${shape.patchChampions.toString()} champions regenerates all of them. A patch whose changed facts leave the text valid is re-stamped for nothing instead.`,
    "",
    header,
    divider,
    ...body,
    "",
    "## Source use",
    "",
    "The share of tips (generator) and verdicts (judges) that name each source as what they rest on. The generator's share is the mean over a model's runs; a judge's is pooled over every report. A tip or verdict may name several sources. `wiki-lookup` is a page fetched through the tool; the other sources are in every prompt.",
    "",
    ...sourceTable(reports, models, judges),
    "",
  ].join("\n");
}
