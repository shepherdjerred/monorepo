import { describe, expect, test } from "vitest";
import type { Correctness, TipVerdict } from "#src/tips/eval/judge.ts";
import {
  cacheBehavior,
  evaluateFilter,
  inputFactor,
} from "#src/tips/eval/filter.ts";
import { project } from "#src/tips/eval/projection.ts";
import { type RejudgeVariant } from "#src/tips/eval/rejudge.ts";
import { EVAL_MODELS } from "#src/tips/eval/report.ts";
import {
  type EvalCaseResult,
  type EvalReport,
  type ReportTip,
  buildReport,
} from "#src/tips/eval/report.ts";

const OPUS = "judge-opus";
const GPT = "judge-gpt";

function verdict(correctness: Correctness, judge?: string) {
  const base: TipVerdict = {
    correctness,
    useful: true,
    plain: true,
    reason: "r",
    sources: [],
  };
  return judge === undefined ? base : { ...base, judge };
}

function tip(text: string, opus: Correctness, gpt: Correctness): ReportTip {
  return {
    text,
    cites: [],
    sources: [],
    verdicts: [
      { ...verdict(opus), judge: OPUS },
      { ...verdict(gpt), judge: GPT },
    ],
  };
}

function entry(tips: ReportTip[]): EvalCaseResult {
  return {
    kind: "general",
    lane: "middle",
    champions: ["Ahri"],
    status: "passed-first-attempt",
    calls: 1,
    costUsd: 0.01,
    toolCalls: 0,
    wikiPages: 2,
    judgeCostUsd: 0,
    judgeToolCalls: 0,
    firstAttemptIssues: [],
    finalIssues: [],
    sets: [{ champion: "Ahri", tips }],
    glossaryAdditions: [],
  };
}

function reportOf(model: string, cases: EvalCaseResult[]): EvalReport {
  return buildReport(
    {
      model,
      run: 1,
      promptVersion: "tips-test",
      judgeModels: [OPUS, GPT],
      judgeCostUsd: {},
      now: new Date("2026-11-26T00:00:00Z"),
    },
    cases,
    {
      inputTokens: 40_000,
      outputTokens: 4000,
      cachedInputTokens: 0,
      costUsd: 0.2,
    },
  );
}

// Five tips: A both wrong, B both wrong, C both correct, D both correct, E split.
const REPORT = reportOf("gen-a", [
  entry([
    tip("A", "wrong", "wrong"),
    tip("B", "wrong", "wrong"),
    tip("C", "correct", "correct"),
    tip("D", "correct", "correct"),
    tip("E", "wrong", "correct"),
  ]),
]);

function variantOf(
  correctness: Correctness[],
  options: { jobs?: number; failed?: number } = {},
): RejudgeVariant {
  return {
    name: "sonnet-test",
    model: "claude-sonnet-5-5",
    effort: "medium",
    jobs: options.jobs ?? 1,
    failed: options.failed ?? 0,
    rounds: 1,
    toolCalls: 0,
    tokens: {
      inputTokens: 10_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 1000,
    },
    costUsd: 0.02,
    listUsd: 0.04,
    cases: [
      {
        report: "gen-a#1",
        case: 0,
        sets: [
          correctness.map((entryCorrectness) => verdict(entryCorrectness)),
        ],
        costUsd: 0.02,
        toolCalls: 0,
      },
    ],
  };
}

describe("evaluateFilter", () => {
  test("recall, false drops and shipped-wrong rate against the two reference judges", () => {
    // Catches A, misses B, drops C (a false drop) and the split E, keeps D.
    const evaluation = evaluateFilter(
      [REPORT],
      variantOf(["wrong", "correct", "wrong", "correct", "wrong"]),
    );
    expect(evaluation.overall).toMatchObject({
      tips: 5,
      bothWrong: 2,
      bothCorrect: 2,
      caught: 1,
      falseDrops: 1,
      dropped: 3,
      recall: 0.5,
      falseDropRate: 0.5,
      droppedShare: 0.6,
      // B is the one both-wrong tip kept, among the 2 tips kept.
      shippedWrongRate: 0.5,
      unfilteredWrongRate: 0.4,
    });
    expect(evaluation.overall.variantWrongRate).toBeCloseTo(0.6);
    expect(evaluation.byModel["gen-a"]).toEqual(evaluation.overall);
    expect(evaluation.unscoredUnits).toBe(0);
  });

  test("a variant that failed a unit leaves it out rather than counting it as kept", () => {
    const failed: RejudgeVariant = { ...variantOf([]), cases: [], failed: 1 };
    const evaluation = evaluateFilter([REPORT], failed);
    expect(evaluation.overall.tips).toBe(0);
    expect(evaluation.unscoredUnits).toBe(1);
  });

  test("a verdict list shorter than the tips is a broken contract", () => {
    expect(() =>
      evaluateFilter([REPORT], variantOf(["wrong", "correct"])),
    ).toThrow("missing a verdict");
  });
});

describe("cache and price model", () => {
  const multipliers = { batch: 0.5, cacheRead: 0.1, cacheWrite: 2 };

  test("reads the prefix share and hit rate from a sample with one anchor", () => {
    // 10 jobs, one anchor: 9 could read. Prefix 5000 tokens each: 9 reads, 1 write.
    const behavior = cacheBehavior({
      jobs: 10,
      inputTokens: 100_000,
      cacheReadTokens: 45_000,
      cacheWriteTokens: 5000,
    });
    expect(behavior.prefixShare).toBeCloseTo(0.3333, 3);
    expect(behavior.hitRate).toBeCloseTo(1);
  });

  test("the input factor falls as more units share an anchor", () => {
    const behavior = { prefixShare: 0.5, hitRate: 1 };
    const few = inputFactor(behavior, { units: 10, anchors: 10 }, multipliers);
    const many = inputFactor(behavior, { units: 100, anchors: 2 }, multipliers);
    // No reuse: half the prompt is written at 2x on the batch tier; heavy reuse: nearly all read.
    expect(few).toBeCloseTo(0.5 * (0.5 + 0.5 * 2));
    expect(many).toBeLessThan(few);
    expect(many).toBeCloseTo(0.5 * (0.5 + 0.5 * (0.98 * 0.1 + 0.02 * 2)), 3);
  });
});

describe("project", () => {
  test("prices both stages at the measured batch and cache factors and applies the filter's measured rates", () => {
    const evaluation = evaluateFilter(
      [REPORT],
      variantOf(["wrong", "correct", "wrong", "correct", "wrong"]),
    );
    const projection = project({
      reports: [REPORT],
      generatorPricing: { inputPerMTok: 2, outputPerMTok: 10 },
      filter: variantOf([]),
      judgePricing: { inputPerMTok: 2, outputPerMTok: 10 },
      filterEvaluation: evaluation,
      generationSample: {
        jobs: 10,
        inputTokens: 100_000,
        cacheReadTokens: 45_000,
        cacheWriteTokens: 5000,
      },
      judgingSample: {
        jobs: 10,
        inputTokens: 100_000,
        cacheReadTokens: 45_000,
        cacheWriteTokens: 5000,
      },
      multipliers: { batch: 0.5, cacheRead: 0.1, cacheWrite: 2 },
      shape: {
        matchupUnits: 1000,
        generalSets: 100,
        unitsPerChampion: 20,
        generalPerChampion: 1,
        patchChampions: 10,
      },
      fullPlan: { units: 1100, anchors: 100 },
    });

    expect(projection.generator).toBe("gen-a");
    expect(projection.shippedWrongRate).toBe(0.5);
    expect(projection.droppedShare).toBe(0.6);
    expect(projection.fullRunUsd).toBeCloseTo(
      projection.generationFullUsd + projection.filterFullUsd,
    );
    expect(projection.patchUsd).toBeCloseTo(
      projection.generationPatchUsd + projection.filterPatchUsd,
    );
    // The batch tier alone halves the standard price, so both stages cost under half of it.
    expect(projection.generationFullUsd).toBeLessThan(1000 * 0.01 + 100 * 0.01);
    expect(projection.fitsUnder100).toBe(true);
  });
});

describe("the committed comparison", () => {
  test("the written comparison names both variants and every generator", async () => {
    const text = await Bun.file(`${import.meta.dir}/eval-filter.md`).text();
    for (const name of ["sonnet-medium", "sonnet-low", ...EVAL_MODELS]) {
      expect(text).toContain(name);
    }
    expect(text).toContain("Measured batch and cache savings");
  });
});
