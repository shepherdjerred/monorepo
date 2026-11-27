import {
  type CacheMeasure,
  type FilterEvaluation,
  type PlanReuse,
  type PriceMultipliers,
  cacheBehavior,
  inputFactor,
  stageCostUsd,
} from "#src/tips/eval/filter.ts";
import type { RejudgeVariant } from "#src/tips/eval/rejudge.ts";
import type { EvalReport } from "#src/tips/eval/report.ts";
import type { PlanShape } from "#src/tips/eval/summary.ts";
import type { TipModelPricing } from "#src/tips/model.ts";

/**
 * Cost of a full run, and of a patch, with Sonnet filtering what a generator
 * writes: both stages on the batch tier, each stage's shared prefix cached.
 * The prices are the measured ones (see `scripts/tips-eval/batch-sample.ts`); the tokens
 * per unit are the eval's.
 */

export type ProjectionInput = {
  /** The generator's reports (every run of one model). */
  reports: readonly EvalReport[];
  generatorPricing: TipModelPricing;
  filter: RejudgeVariant;
  judgePricing: TipModelPricing;
  filterEvaluation: FilterEvaluation;
  /** What the batch sample showed for the generation and the judging stage. */
  generationSample: CacheMeasure;
  judgingSample: CacheMeasure;
  multipliers: PriceMultipliers;
  shape: PlanShape;
  /** Units and distinct anchor champions of the full plan. */
  fullPlan: PlanReuse;
};

export type Projection = {
  generator: string;
  filter: string;
  generationFullUsd: number;
  filterFullUsd: number;
  fullRunUsd: number;
  generationPatchUsd: number;
  filterPatchUsd: number;
  patchUsd: number;
  /** Tips both reference judges call wrong that the filter keeps, over the tips it keeps. */
  shippedWrongRate: number;
  unfilteredWrongRate: number;
  /** Share of tips the filter drops. */
  droppedShare: number;
  /** Share of the tips both references call correct that the filter drops. */
  falseDropRate: number;
  fitsUnder100: boolean;
};

const mean = (values: readonly number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);

/** Standard-price cost of one unit's input and output, split. */
function splitUsd(
  inputTokens: number,
  outputTokens: number,
  pricing: TipModelPricing,
): { inputUsd: number; outputUsd: number } {
  return {
    inputUsd: (inputTokens * pricing.inputPerMTok) / 1_000_000,
    outputUsd: (outputTokens * pricing.outputPerMTok) / 1_000_000,
  };
}

export function project(input: ProjectionInput): Projection {
  const { reports, multipliers, shape } = input;
  const generator = reports[0]?.model ?? "";
  const cases = mean(reports.map((report) => report.totals.cases));
  const inTokens =
    mean(reports.map((report) => report.totals.inputTokens)) / cases;
  const outTokens =
    mean(reports.map((report) => report.totals.outputTokens)) / cases;
  const pair = mean(
    reports.map((report) => report.totals.costPerMatchupCaseUsd),
  );
  const general = mean(
    reports.map((report) => report.totals.costPerGeneralCaseUsd),
  );
  const generalRatio = pair === 0 ? 1 : general / pair;

  // Per-unit tokens are the average eval case; a pair costs `pair`, a general set `general`.
  const avg = splitUsd(inTokens, outTokens, input.generatorPricing);
  const avgUsd = avg.inputUsd + avg.outputUsd;
  const scalePair = pair === 0 ? 0 : pair / avgUsd;
  const generationUnit = (kind: "pair" | "general") => {
    const scale = kind === "pair" ? scalePair : scalePair * generalRatio;
    return { inputUsd: avg.inputUsd * scale, outputUsd: avg.outputUsd * scale };
  };

  const filterJobs = Math.max(1, input.filter.jobs - input.filter.failed);
  const filterTokens = input.filter.tokens;
  const filterIn =
    (filterTokens.inputTokens +
      filterTokens.cacheReadTokens +
      filterTokens.cacheWriteTokens) /
    filterJobs;
  const filterOut = filterTokens.outputTokens / filterJobs;
  const filterAvg = splitUsd(filterIn, filterOut, input.judgePricing);
  const filterUnit = (kind: "pair" | "general") => {
    const scale = kind === "pair" ? 1 : generalRatio;
    return {
      inputUsd: filterAvg.inputUsd * scale,
      outputUsd: filterAvg.outputUsd * scale,
    };
  };

  const generationFactor = (reuse: PlanReuse) =>
    inputFactor(cacheBehavior(input.generationSample), reuse, multipliers);
  const judgingFactor = (reuse: PlanReuse) =>
    inputFactor(cacheBehavior(input.judgingSample), reuse, multipliers);

  const full = input.fullPlan;
  const generationFull =
    stageCostUsd(
      generationUnit("pair"),
      shape.matchupUnits,
      generationFactor(full),
      multipliers,
    ) +
    stageCostUsd(
      generationUnit("general"),
      shape.generalSets,
      generationFactor(full),
      multipliers,
    );
  const filterFull =
    stageCostUsd(
      filterUnit("pair"),
      shape.matchupUnits,
      judgingFactor(full),
      multipliers,
    ) +
    stageCostUsd(
      filterUnit("general"),
      shape.generalSets,
      judgingFactor(full),
      multipliers,
    );

  const patchPairs = shape.patchChampions * shape.unitsPerChampion;
  const patchGeneral = shape.patchChampions * shape.generalPerChampion;
  const patchReuse: PlanReuse = {
    units: patchPairs + patchGeneral,
    anchors: shape.patchChampions,
  };
  const generationPatch =
    stageCostUsd(
      generationUnit("pair"),
      patchPairs,
      generationFactor(patchReuse),
      multipliers,
    ) +
    stageCostUsd(
      generationUnit("general"),
      patchGeneral,
      generationFactor(patchReuse),
      multipliers,
    );
  const filterPatch =
    stageCostUsd(
      filterUnit("pair"),
      patchPairs,
      judgingFactor(patchReuse),
      multipliers,
    ) +
    stageCostUsd(
      filterUnit("general"),
      patchGeneral,
      judgingFactor(patchReuse),
      multipliers,
    );

  const measure = input.filterEvaluation.byModel[generator];
  if (measure === undefined) {
    throw new Error(`the filter evaluation has no tips from ${generator}`);
  }
  const fullRun = generationFull + filterFull;
  return {
    generator,
    filter: input.filter.name,
    generationFullUsd: generationFull,
    filterFullUsd: filterFull,
    fullRunUsd: fullRun,
    generationPatchUsd: generationPatch,
    filterPatchUsd: filterPatch,
    patchUsd: generationPatch + filterPatch,
    shippedWrongRate: measure.shippedWrongRate,
    unfilteredWrongRate: measure.unfilteredWrongRate,
    droppedShare: measure.droppedShare,
    falseDropRate: measure.falseDropRate,
    fitsUnder100: fullRun < 100,
  };
}
