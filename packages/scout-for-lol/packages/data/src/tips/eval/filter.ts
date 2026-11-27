import type { TipVerdict } from "#src/tips/eval/judge.ts";
import {
  type RejudgeVariant,
  type RejudgedCase,
  reportKey,
} from "#src/tips/eval/rejudge.ts";
import type { EvalReport } from "#src/tips/eval/report.ts";

/**
 * Sonnet as a filter. The two reference judges (Opus and GPT) already scored
 * every tip; a cheaper judge is only useful if it catches what both of them
 * call wrong without dropping what both call correct. This module measures
 * that, and projects what a full run costs with the filter in the loop.
 */

const rate = (count: number, total: number): number =>
  total === 0 ? 0 : count / total;

export type FilterCounts = {
  /** Tips all three judges scored. */
  tips: number;
  /** Tips both reference judges call wrong. */
  bothWrong: number;
  /** Tips both reference judges call correct. */
  bothCorrect: number;
  /** Both-wrong tips the variant also calls wrong. */
  caught: number;
  /** Tips the variant calls wrong while both references call them correct. */
  falseDrops: number;
  /** Every tip the variant calls wrong: what the filter drops. */
  dropped: number;
  variantCorrect: number;
  variantWrong: number;
  variantNotCheckable: number;
  variantUseful: number;
  variantPlain: number;
};

export type FilterMeasure = FilterCounts & {
  /** Share of both-wrong tips the variant catches. */
  recall: number;
  /** Share of both-correct tips the variant drops. */
  falseDropRate: number;
  droppedShare: number;
  /** Both-wrong tips the filter keeps, over the tips it keeps. */
  shippedWrongRate: number;
  /** Both-wrong tips over all tips: what ships with no filter. */
  unfilteredWrongRate: number;
  variantWrongRate: number;
  variantCorrectRate: number;
  variantNotCheckableRate: number;
  variantUsefulRate: number;
  variantPlainRate: number;
};

const EMPTY: FilterCounts = {
  tips: 0,
  bothWrong: 0,
  bothCorrect: 0,
  caught: 0,
  falseDrops: 0,
  dropped: 0,
  variantCorrect: 0,
  variantWrong: 0,
  variantNotCheckable: 0,
  variantUseful: 0,
  variantPlain: 0,
};

function measureOf(counts: FilterCounts): FilterMeasure {
  const kept = counts.tips - counts.dropped;
  return {
    ...counts,
    recall: rate(counts.caught, counts.bothWrong),
    falseDropRate: rate(counts.falseDrops, counts.bothCorrect),
    droppedShare: rate(counts.dropped, counts.tips),
    shippedWrongRate: rate(counts.bothWrong - counts.caught, kept),
    unfilteredWrongRate: rate(counts.bothWrong, counts.tips),
    variantWrongRate: rate(counts.variantWrong, counts.tips),
    variantCorrectRate: rate(counts.variantCorrect, counts.tips),
    variantNotCheckableRate: rate(counts.variantNotCheckable, counts.tips),
    variantUsefulRate: rate(counts.variantUseful, counts.tips),
    variantPlainRate: rate(counts.variantPlain, counts.tips),
  };
}

function add(left: FilterCounts, right: FilterCounts): FilterCounts {
  return {
    tips: left.tips + right.tips,
    bothWrong: left.bothWrong + right.bothWrong,
    bothCorrect: left.bothCorrect + right.bothCorrect,
    caught: left.caught + right.caught,
    falseDrops: left.falseDrops + right.falseDrops,
    dropped: left.dropped + right.dropped,
    variantCorrect: left.variantCorrect + right.variantCorrect,
    variantWrong: left.variantWrong + right.variantWrong,
    variantNotCheckable: left.variantNotCheckable + right.variantNotCheckable,
    variantUseful: left.variantUseful + right.variantUseful,
    variantPlain: left.variantPlain + right.variantPlain,
  };
}

export type FilterEvaluation = {
  variant: string;
  overall: FilterMeasure;
  byModel: Record<string, FilterMeasure>;
  /** Units the variant failed to score (left out of every count). */
  unscoredUnits: number;
};

function countTip(
  first: TipVerdict,
  second: TipVerdict,
  mine: TipVerdict,
): FilterCounts {
  const bothWrong =
    first.correctness === "wrong" && second.correctness === "wrong";
  const bothCorrect =
    first.correctness === "correct" && second.correctness === "correct";
  const wrong = mine.correctness === "wrong";
  return {
    tips: 1,
    bothWrong: Number(bothWrong),
    bothCorrect: Number(bothCorrect),
    caught: Number(bothWrong && wrong),
    falseDrops: Number(bothCorrect && wrong),
    dropped: Number(wrong),
    variantCorrect: Number(mine.correctness === "correct"),
    variantWrong: Number(wrong),
    variantNotCheckable: Number(mine.correctness === "not-checkable"),
    variantUseful: Number(mine.useful),
    variantPlain: Number(mine.plain),
  };
}

function countCase(
  report: EvalReport,
  caseIndex: number,
  judges: readonly [string, string],
  scored: RejudgedCase,
): FilterCounts {
  const entry = report.cases[caseIndex];
  let counts = EMPTY;
  for (const [setIndex, set] of (entry?.sets ?? []).entries()) {
    for (const [tipIndex, tip] of set.tips.entries()) {
      const first = tip.verdicts.find((v) => v.judge === judges[0]);
      const second = tip.verdicts.find((v) => v.judge === judges[1]);
      const mine = scored.sets[setIndex]?.[tipIndex];
      if (first === undefined || second === undefined || mine === undefined) {
        throw new Error(
          `tip ${tipIndex.toString()} of set ${setIndex.toString()} in ${reportKey(report)} case ${caseIndex.toString()} is missing a verdict`,
        );
      }
      counts = add(counts, countTip(first, second, mine));
    }
  }
  return counts;
}

/** Measure one variant against the two reference judges of each report. */
export function evaluateFilter(
  reports: readonly EvalReport[],
  variant: RejudgeVariant,
): FilterEvaluation {
  const verdicts = new Map(
    variant.cases.map((entry) => [
      `${entry.report}|${entry.case.toString()}`,
      entry,
    ]),
  );
  const byModel = new Map<string, FilterCounts>();
  let unscored = 0;
  for (const report of reports) {
    const [firstJudge, secondJudge] = report.judges;
    if (firstJudge === undefined || secondJudge === undefined) {
      throw new Error(`report ${reportKey(report)} has fewer than two judges`);
    }
    const judges: readonly [string, string] = [
      firstJudge.model,
      secondJudge.model,
    ];
    let counts = byModel.get(report.model) ?? EMPTY;
    for (const [caseIndex, entry] of report.cases.entries()) {
      const scored = verdicts.get(
        `${reportKey(report)}|${caseIndex.toString()}`,
      );
      if (entry.status === "dropped") {
        continue;
      }
      if (scored === undefined) {
        unscored += 1;
        continue;
      }
      counts = add(counts, countCase(report, caseIndex, judges, scored));
    }
    byModel.set(report.model, counts);
  }
  const all = [...byModel.values()].reduce(
    (sum, counts) => add(sum, counts),
    EMPTY,
  );
  return {
    variant: variant.name,
    overall: measureOf(all),
    byModel: Object.fromEntries(
      [...byModel.entries()].map(([model, counts]) => [
        model,
        measureOf(counts),
      ]),
    ),
    unscoredUnits: unscored,
  };
}

/** What the batch sample showed about one stage's prompts and the cache. */
export type CacheMeasure = {
  jobs: number;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

export type PriceMultipliers = {
  /** Batch tier: half the standard price. */
  batch: number;
  /** A cache read, against the input price. */
  cacheRead: number;
  /** A cache write at the TTL used, against the input price. */
  cacheWrite: number;
};

/**
 * The cache behavior the sample measured: the share of a prompt that is the
 * shared prefix, and how often a job that could read the cache did. The sample
 * has one anchor champion, so every job but the first could read.
 */
export function cacheBehavior(sample: CacheMeasure): {
  prefixShare: number;
  hitRate: number;
} {
  const prompt =
    sample.inputTokens + sample.cacheReadTokens + sample.cacheWriteTokens;
  const prefix = sample.cacheReadTokens + sample.cacheWriteTokens;
  const hit = rate(sample.cacheReadTokens, prefix);
  const possible = rate(sample.jobs - 1, sample.jobs);
  return {
    prefixShare: rate(prefix, prompt),
    hitRate: possible === 0 ? 0 : Math.min(1, hit / possible),
  };
}

/** The plan's size, for how often a prefix is shared. */
export type PlanReuse = {
  /** Units to generate or judge (pairs plus general sets). */
  units: number;
  /** Distinct champions whose block leads some unit. */
  anchors: number;
};

/**
 * The multiplier on the standard input price once the batch discount and the
 * cache are applied: the shared prefix is read from the cache on a hit and
 * written on a miss, the rest is plain batch input.
 */
export function inputFactor(
  behavior: { prefixShare: number; hitRate: number },
  reuse: PlanReuse,
  multipliers: PriceMultipliers,
): number {
  const readable = rate(reuse.units - reuse.anchors, reuse.units);
  const read = behavior.hitRate * readable;
  return (
    multipliers.batch *
    (1 -
      behavior.prefixShare +
      behavior.prefixShare *
        (read * multipliers.cacheRead + (1 - read) * multipliers.cacheWrite))
  );
}

export type StageCost = {
  /** Standard price of the stage's input and output tokens for one unit, no batch, no cache. */
  inputUsd: number;
  outputUsd: number;
};

/** Cost of `units` units at the batch price with the cache. */
export function stageCostUsd(
  unit: StageCost,
  units: number,
  factor: number,
  multipliers: PriceMultipliers,
): number {
  return units * (unit.inputUsd * factor + unit.outputUsd * multipliers.batch);
}
