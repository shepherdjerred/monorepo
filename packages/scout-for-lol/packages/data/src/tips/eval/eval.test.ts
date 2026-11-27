import { describe, expect, test } from "vitest";
import { getChampionByKey } from "#src/model/riot/champion-registry.ts";
import { runEval } from "#src/tips/eval/eval.ts";
import { JudgeDraftSchema } from "#src/tips/eval/judge.ts";
import {
  EVAL_CASES_PATH,
  EVAL_MODELS,
  EVAL_SUMMARY_PATH,
  EvalCasesSchema,
  EvalReportSchema,
} from "#src/tips/eval/report.ts";
import {
  type PlanShape,
  projectCost,
  renderSummary,
} from "#src/tips/eval/summary.ts";
import { FAKE_WIKI_PAGES, fakeWiki } from "#src/tips/fake-wiki.fixture.ts";
import {
  type FakeCall,
  CHARMED_DRAFT,
  fakeTipModel,
  withBasis,
} from "#src/tips/fake-model.fixture.ts";
import type { WikiLookup } from "#src/tips/model.ts";
import type { GlossaryEntry, GlossaryId } from "#src/tips/schema.ts";
import {
  AHRI_INTO_SYNDRA_TIPS,
  AHRI_MID_GENERAL_TIPS,
  SYNDRA_INTO_AHRI_TIPS,
} from "#src/tips/tips.fixture.ts";

const NOW = new Date("2026-11-25T12:00:00.000Z");

async function readCases() {
  return EvalCasesSchema.parse(await Bun.file(EVAL_CASES_PATH).json());
}

describe("the eval cases", () => {
  test("are 30 pairs and 10 single champions, with the two named cases", async () => {
    const cases = await readCases();
    expect(cases.matchups).toHaveLength(30);
    expect(cases.general).toHaveLength(10);
    expect(cases.matchups).toContainEqual({
      lane: "middle",
      champion: "Ahri",
      opponent: "Syndra",
    });
    expect(cases.general).toContainEqual({ lane: "middle", champion: "Ahri" });
  });

  test("name real champions, each pair once, and cover every lane", async () => {
    const cases = await readCases();
    const keys = [
      ...cases.matchups.flatMap((entry) => [entry.champion, entry.opponent]),
      ...cases.general.map((entry) => entry.champion),
    ];
    for (const key of keys) {
      expect(getChampionByKey(key), key).toBeDefined();
    }
    const pairs = cases.matchups.map((entry) =>
      [entry.lane, ...[entry.champion, entry.opponent].toSorted()].join(":"),
    );
    expect(new Set(pairs).size).toBe(pairs.length);
    for (const entry of cases.matchups) {
      expect(entry.champion).not.toBe(entry.opponent);
    }
    expect(new Set(cases.matchups.map((entry) => entry.lane))).toEqual(
      new Set(["top", "jungle", "middle", "adc", "support"]),
    );
  });
});

/**
 * A judge: the first tip of each unit is wrong, the second correct and not
 * useful, the rest correct. `second` makes the other judge disagree on the
 * second tip (not checkable) and read the wiki once.
 */
function judgeAnswer(second: boolean) {
  return async (
    call: FakeCall,
    _index: number,
    lookup: WikiLookup | undefined,
  ): Promise<unknown> => {
    if (second) {
      await lookup?.("Slow");
    }
    const count = call.prompt.match(/^\d+\. /gmu)?.length ?? 0;
    return {
      verdicts: Array.from({ length: count }, (_unused, index) => ({
        index,
        correctness:
          index === 0
            ? "wrong"
            : second && index === 1
              ? "not-checkable"
              : "correct",
        useful: index !== 1,
        plain: true,
        reason: `reason ${index.toString()}`,
        sources: second ? ["wiki-lookup"] : ["ability-facts"],
      })),
    };
  };
}

describe("runEval", () => {
  const cases = {
    matchups: [
      { lane: "middle", champion: "Ahri", opponent: "Syndra" },
      { lane: "middle", champion: "Syndra", opponent: "Ahri" },
    ],
    general: [{ lane: "middle", champion: "Ahri" }],
  } as const;

  async function run() {
    const matchupAnswer = {
      forward: withBasis(AHRI_INTO_SYNDRA_TIPS),
      reverse: withBasis(SYNDRA_INTO_AHRI_TIPS),
      glossary: [],
    };
    let matchupCalls = 0;
    const model = fakeTipModel((call) => {
      if (call.schemaName === "scout_general_tips") {
        return {
          tips: withBasis(AHRI_MID_GENERAL_TIPS),
          glossary: [CHARMED_DRAFT],
        };
      }
      matchupCalls += 1;
      // The first matchup case fails once and then passes; the second never passes.
      if (matchupCalls === 1) {
        return {
          ...matchupAnswer,
          forward: [
            { text: "Win 51%.", cites: [], basis: [] },
            ...withBasis(AHRI_INTO_SYNDRA_TIPS).slice(1),
          ],
        };
      }
      return matchupCalls === 2
        ? matchupAnswer
        : {
            ...matchupAnswer,
            reverse: [
              { text: "Win 51%.", cites: [], basis: [] },
              ...withBasis(SYNDRA_INTO_AHRI_TIPS).slice(1),
            ],
          };
    });
    const first = fakeTipModel(judgeAnswer(false), "judge-a");
    const second = fakeTipModel(judgeAnswer(true), "judge-b");
    const report = await runEval({
      model,
      judges: [
        { model: first, maxOutputTokens: 1000 },
        { model: second, maxOutputTokens: 1000 },
      ],
      wiki: fakeWiki(FAKE_WIKI_PAGES),
      promptVersion: "tips-test-1",
      run: 2,
      cases: { matchups: [...cases.matchups], general: [...cases.general] },
      glossary: new Map<GlossaryId, GlossaryEntry>(),
      maxOutputTokens: 1000,
      concurrency: 1,
      now: NOW,
    });
    return { report, first, second };
  }

  test("scores first-attempt and final passes, drops, cost, wiki use and text", async () => {
    const { report } = await run();

    expect(EvalReportSchema.parse(report)).toEqual(report);
    expect(report).toMatchObject({ run: 2, model: "fake-model" });
    expect(report.totals).toMatchObject({
      cases: 3,
      matchupCases: 2,
      generalCases: 1,
      passedFirstAttempt: 1,
      passedAfterRetry: 1,
      dropped: 1,
      firstAttemptPassRate: 0.3333,
      finalPassRate: 0.6667,
      calls: 5,
      toolCalls: 0,
    });
    expect(report.totals.costUsd).toBeCloseTo(0.05);
    expect(report.totals.costPerMatchupCaseUsd).toBeCloseTo(0.02);
    expect(report.firstAttemptIssuesByCode).toMatchObject({ statistic: 2 });
    expect(report.cases.map((entry) => entry.status)).toEqual([
      "passed-after-retry",
      "dropped",
      "passed-first-attempt",
    ]);
    // Every case used the two champions' pages and patch histories (matchups: 4, general: 2).
    expect(report.cases.map((entry) => entry.wikiPages)).toEqual([4, 4, 2]);
    const [retried, dropped] = report.cases;
    expect(retried?.sets.map((set) => set.champion)).toEqual([
      "Ahri",
      "Syndra",
    ]);
    expect(retried?.sets[0]?.tips.map((tip) => tip.text)).toEqual(
      AHRI_INTO_SYNDRA_TIPS.map((tip) => tip.text),
    );
    // A dropped case keeps the last rejected answer so a human can read it.
    expect(dropped?.sets[1]?.tips[0]?.text).toBe("Win 51%.");
    expect(dropped?.finalIssues.length).toBeGreaterThan(0);
    expect(report.cases[2]?.glossaryAdditions.map((entry) => entry.id)).toEqual(
      ["charmed"],
    );
  });

  test("both judges score every tip of an accepted unit, once per unit, never a rejected answer", async () => {
    const { report, first, second } = await run();

    // The matchup case is one call per judge (both directions together), plus the general case.
    expect(first.calls).toHaveLength(2);
    expect(second.calls).toHaveLength(2);
    expect(first.calls[0]?.hasLookup).toBe(true);
    // The judge prompt carries the wiki notes and numbers tips across both sets.
    expect(first.calls[0]?.prompt).toContain(
      "Orb of Deception passes through minions",
    );
    expect(first.calls[0]?.prompt).toContain("Set A:");
    expect(first.calls[0]?.prompt).toContain("Set B:");

    const accepted = report.cases.flatMap((entry) =>
      entry.status === "dropped" ? [] : entry.sets,
    );
    for (const tip of accepted.flatMap((set) => set.tips)) {
      expect(tip.verdicts.map((verdict) => verdict.judge)).toEqual([
        "judge-a",
        "judge-b",
      ]);
    }
    const dropped = report.cases.find((entry) => entry.status === "dropped");
    expect(
      dropped?.sets
        .flatMap((set) => set.tips)
        .every((tip) => tip.verdicts.length === 0),
    ).toBe(true);

    // Tips judged: the matchup unit (3 + 3) and the general set (3), by each judge.
    // Each judge calls the first tip of a unit wrong; judge b calls the second not checkable.
    const [a, b] = report.judges;
    expect(a).toMatchObject({
      model: "judge-a",
      tips: 9,
      wrong: 2,
      notCheckable: 0,
    });
    expect(b).toMatchObject({
      model: "judge-b",
      tips: 9,
      wrong: 2,
      notCheckable: 2,
    });
    expect(report.agreement).toMatchObject({
      judges: ["judge-a", "judge-b"],
      tips: 9,
      bothWrong: 2,
      correctnessAgree: 7,
    });
    expect(report.agreement.correctnessAgreeRate).toBeCloseTo(0.7778, 3);
    expect(report.agreement.kappa).toBeGreaterThan(0.5);
    expect(report.judgeToolCallsPerUnit).toBeCloseTo(2 / 3, 1);
    expect(a?.costUsd).toBeCloseTo(0.02);
    expect(report.cases[0]?.judgeCostUsd).toBeCloseTo(0.02);
  });

  test("a judge that returns the wrong number of verdicts fails the eval", async () => {
    const broken = fakeTipModel(() => ({ verdicts: [] }), "judge-a");
    const good = fakeTipModel(judgeAnswer(false), "judge-b");
    const model = fakeTipModel(() => ({
      tips: withBasis(AHRI_MID_GENERAL_TIPS),
      glossary: [CHARMED_DRAFT],
    }));
    await expect(
      runEval({
        model,
        judges: [
          { model: broken, maxOutputTokens: 1000 },
          { model: good, maxOutputTokens: 1000 },
        ],
        promptVersion: "tips-test-1",
        run: 1,
        cases: { matchups: [], general: [...cases.general] },
        glossary: new Map<GlossaryId, GlossaryEntry>(),
        maxOutputTokens: 1000,
        concurrency: 1,
        now: NOW,
      }),
    ).rejects.toThrow("one verdict per tip");
    expect(broken.calls).toHaveLength(2);
  });

  test("the judge schema accepts the three correctness values only", () => {
    const verdict = {
      index: 0,
      useful: true,
      plain: true,
      reason: "r",
      sources: ["wiki-notes"],
    };
    expect(
      JudgeDraftSchema.safeParse({
        verdicts: [{ ...verdict, correctness: "not-checkable" }],
      }).success,
    ).toBe(true);
    expect(
      JudgeDraftSchema.safeParse({
        verdicts: [{ ...verdict, correctness: "maybe" }],
      }).success,
    ).toBe(false);
  });
});

const SHAPE: PlanShape = {
  matchupUnits: 1000,
  generalSets: 100,
  unitsPerChampion: 20,
  generalPerChampion: 1.5,
  patchChampions: 10,
};

async function reportFor(model: string, run: number) {
  return runEval({
    model: fakeTipModel(
      () => ({
        tips: withBasis(AHRI_MID_GENERAL_TIPS),
        glossary: [CHARMED_DRAFT],
      }),
      model,
    ),
    judges: [
      {
        model: fakeTipModel(judgeAnswer(false), "judge-a"),
        maxOutputTokens: 1000,
      },
      {
        model: fakeTipModel(judgeAnswer(true), "judge-b"),
        maxOutputTokens: 1000,
      },
    ],
    promptVersion: "tips-test-1",
    run,
    cases: { matchups: [], general: [{ lane: "middle", champion: "Ahri" }] },
    glossary: new Map<GlossaryId, GlossaryEntry>(),
    maxOutputTokens: 1000,
    concurrency: 1,
    now: NOW,
  });
}

describe("the summary", () => {
  test("projects a full run and a patch from the per-case cost", async () => {
    const report = await reportFor("fake-model", 1);
    // One general case at $0.01; no matchup case, so a matchup costs nothing here.
    const projection = projectCost(report, SHAPE);
    expect(projection.fullRunUsd).toBeCloseTo(100 * 0.01);
    expect(projection.patchUsd).toBeCloseTo(10 * 1.5 * 0.01);
  });

  test("shows the mean of each model's runs with every run beside it", async () => {
    const reports = await Promise.all([
      reportFor("model-a", 1),
      reportFor("model-a", 2),
      reportFor("model-b", 1),
    ]);
    const summary = renderSummary(reports, SHAPE);
    expect(summary).toContain("| | model-a | model-b |");
    expect(summary).toContain(
      "| First-attempt pass rate | 100.0% (100.0% / 100.0%) | 100.0% (100.0%) |",
    );
    expect(summary).toContain("Judges agree on correctness");
    expect(summary).toContain("Generator tool calls per unit");
    expect(summary).toContain("Wiki pages used per unit");
  });
});

describe("the committed summary", () => {
  test("the summary table names every compared model", async () => {
    const summary = await Bun.file(EVAL_SUMMARY_PATH).text();
    for (const model of EVAL_MODELS) {
      expect(summary).toContain(model);
    }
  });
});
