import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { FAKE_WIKI_PAGES, fakeWiki } from "#src/tips/fake-wiki.fixture.ts";
import { isTipSetStaleAgainstCurrentFacts } from "#src/tips/input-hash.ts";
import type { WikiClient } from "#src/tips/wiki.ts";
import {
  FAKE_CALL_COST_USD,
  type FakeCall,
  CHARMED_DRAFT,
  fakeTipModel,
  withBasis,
} from "#src/tips/fake-model.fixture.ts";
import { type GenerationReport, runGeneration } from "#src/tips/generate.ts";
import { loadChampionGrounding } from "#src/tips/grounding.ts";
import { createTipReader } from "#src/tips/load.ts";
import {
  GenerationBudget,
  type TipModel,
  meteredModel,
} from "#src/tips/model.ts";
import type { SelectedWork } from "#src/tips/select.ts";
import { createTipStore } from "#src/tips/store.ts";
import {
  AHRI,
  AHRI_INTO_SYNDRA_TIPS,
  AHRI_MID_GENERAL_TIPS,
  CHARMED,
  SYNDRA,
  SYNDRA_INTO_AHRI_TIPS,
} from "#src/tips/tips.fixture.ts";

const PROMPT_VERSION = "tips-test-1";

const WORK: SelectedWork = {
  general: [
    { championId: AHRI, lane: "middle", games: 10, opponents: [], coverage: 0 },
  ],
  matchups: [{ lane: "middle", championIds: [AHRI, SYNDRA], games: 10 }],
};

const MATCHUP_ANSWER = {
  forward: withBasis(AHRI_INTO_SYNDRA_TIPS),
  reverse: withBasis(SYNDRA_INTO_AHRI_TIPS),
  glossary: [],
};
/** A reverse side whose first tip states a statistic. */
const WITH_STATISTIC = [
  { text: "Win rate is 51% here.", cites: [], basis: [] },
  ...withBasis(SYNDRA_INTO_AHRI_TIPS).slice(1),
];
const GENERAL_ANSWER = {
  tips: withBasis(AHRI_MID_GENERAL_TIPS),
  glossary: [CHARMED_DRAFT],
};

/** Answer matchup and general requests with the approved example tips. */
function respond(call: FakeCall): unknown {
  return call.schemaName === "scout_matchup_tips"
    ? MATCHUP_ANSWER
    : GENERAL_ANSWER;
}

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(`${tmpdir()}/scout-tips-generate-`);
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function run(
  model: TipModel,
  overrides: {
    promptVersion?: string;
    work?: SelectedWork;
    wiki?: WikiClient;
  } = {},
): Promise<GenerationReport> {
  return runGeneration({
    store: createTipStore({ directory }),
    model,
    promptVersion: overrides.promptVersion ?? PROMPT_VERSION,
    work: overrides.work ?? WORK,
    wiki: overrides.wiki,
    concurrency: 2,
    maxOutputTokens: 1000,
  });
}

describe("generating tips", () => {
  test("writes the on-disk layout that the reader accepts", async () => {
    const model = fakeTipModel(respond);
    const report = await run(model);

    expect(report).toMatchObject({
      generated: 2,
      passedFirstAttempt: 2,
      current: 0,
      restamped: 0,
      dropped: [],
    });
    expect(model.calls).toHaveLength(2);

    const reader = createTipReader(directory);
    const forward = await reader.getMatchupTips({
      championId: AHRI,
      opponentId: SYNDRA,
      lane: "middle",
    });
    const reverse = await reader.getMatchupTips({
      championId: SYNDRA,
      opponentId: AHRI,
      lane: "middle",
    });
    expect(forward?.tips.map((tip) => tip.text)).toEqual(
      AHRI_INTO_SYNDRA_TIPS.map((tip) => tip.text),
    );
    expect(reverse?.tips.map((tip) => tip.text)).toEqual(
      SYNDRA_INTO_AHRI_TIPS.map((tip) => tip.text),
    );
    const general = await reader.getChampionLaneTips({
      championId: AHRI,
      lane: "middle",
    });
    expect(general?.tips).toHaveLength(AHRI_MID_GENERAL_TIPS.length);
    const glossary = await createTipStore({ directory }).glossary();
    expect([...glossary.keys()]).toEqual([CHARMED.id]);
  });

  test("skips sets that are current without calling the model", async () => {
    await run(fakeTipModel(respond));
    const second = fakeTipModel(respond);
    const report = await run(second);

    expect(report).toMatchObject({ current: 2, generated: 0, restamped: 0 });
    expect(second.calls).toHaveLength(0);
  });

  test("regenerates when the prompt version changes", async () => {
    await run(fakeTipModel(respond));
    const second = fakeTipModel(respond);
    const report = await run(second, { promptVersion: "tips-test-2" });

    expect(report.generated).toBe(2);
    expect(second.calls).toHaveLength(2);
  });

  test("re-stamps a set whose facts hash changed but whose text still validates", async () => {
    await run(fakeTipModel(respond));
    // Simulate changed facts: every stored hash no longer matches the facts.
    const editing = createTipStore({ directory });
    const stale = "c".repeat(64);
    for (const [champion, opponent] of [
      [AHRI, SYNDRA],
      [SYNDRA, AHRI],
    ] as const) {
      const set = await editing.matchupSet("middle", champion, opponent);
      if (set === undefined) {
        throw new Error("the first run should have written both directions");
      }
      await editing.putMatchupSet({ ...set, inputHash: stale });
    }
    const general = await editing.generalSet("middle", AHRI);
    if (general === undefined) {
      throw new Error("the first run should have written the general set");
    }
    await editing.putGeneralSet({ ...general, inputHash: stale });
    await editing.flush();
    const reader = createTipReader(directory);
    expect(
      await reader.getMatchupTips({
        championId: AHRI,
        opponentId: SYNDRA,
        lane: "middle",
      }),
    ).toBeNull();

    const second = fakeTipModel(respond);
    const report = await run(second);

    expect(report).toMatchObject({ restamped: 2, generated: 0, current: 0 });
    expect(second.calls).toHaveLength(0);
    expect(
      await createTipReader(directory).getMatchupTips({
        championId: AHRI,
        opponentId: SYNDRA,
        lane: "middle",
      }),
    ).not.toBeNull();
  });

  test("regenerates when the facts changed and the text no longer validates", async () => {
    await run(fakeTipModel(respond));
    const editing = createTipStore({ directory });
    const general = await editing.generalSet("middle", AHRI);
    if (general === undefined) {
      throw new Error("the first run should have written the general set");
    }
    await editing.putGeneralSet({
      ...general,
      inputHash: "c".repeat(64),
      // Spirit Rush is named but no longer cited: invalid against the facts.
      tips: general.tips.map((tip) => ({ ...tip, cites: [] })),
    });
    await editing.flush();

    const second = fakeTipModel(respond);
    const report = await run(second, {
      work: { general: WORK.general, matchups: [] },
    });

    expect(report.generated).toBe(1);
    expect(second.calls).toHaveLength(1);
  });

  test("retries a failed unit once with the validator's errors fed back", async () => {
    const model = fakeTipModel((call, index) =>
      index === 0
        ? {
            ...MATCHUP_ANSWER,
            forward: [
              {
                text: "Give up a minion rather than take a free Dark Sphere.",
                cites: [],
                basis: [],
              },
              ...withBasis(AHRI_INTO_SYNDRA_TIPS).slice(1),
            ],
          }
        : respond(call),
    );
    const report = await run(model, {
      work: { general: [], matchups: WORK.matchups },
    });

    expect(model.calls).toHaveLength(2);
    expect(report).toMatchObject({
      generated: 1,
      passedFirstAttempt: 0,
      dropped: [],
    });
    const retry = model.calls[1];
    expect(retry?.prompt).toContain("Your previous answer was rejected");
    expect(retry?.prompt).toContain("Dark Sphere is named but not cited");
    expect(retry?.prompt).toContain(model.calls[0]?.prompt);
    expect(report.usage.costUsd).toBeCloseTo(2 * FAKE_CALL_COST_USD);
  });

  test("retries an answer that is not in the requested shape", async () => {
    const model = fakeTipModel((call, index) =>
      index === 0 ? { nonsense: true } : respond(call),
    );
    const report = await run(model, {
      work: { general: [], matchups: WORK.matchups },
    });

    expect(model.calls).toHaveLength(2);
    expect(report).toMatchObject({ generated: 1, passedFirstAttempt: 0 });
  });

  test("a failed model call (credentials, transport) fails the run visibly, never as a drop", async () => {
    const model: TipModel = {
      name: "broken-model",
      pricing: { inputPerMTok: 1, outputPerMTok: 5 },
      generate: () =>
        Promise.reject(new Error("Anthropic credentials are missing")),
    };
    await expect(run(model)).rejects.toThrow("credentials are missing");
  });

  test("drops a unit that still fails after the retry, and writes nothing for it", async () => {
    const model = fakeTipModel(() => ({
      ...MATCHUP_ANSWER,
      reverse: WITH_STATISTIC,
    }));
    const report = await run(model, {
      work: { general: [], matchups: WORK.matchups },
    });

    expect(model.calls).toHaveLength(2);
    expect(report.generated).toBe(0);
    expect(report.dropped).toHaveLength(1);
    expect(report.dropped[0]).toMatchObject({
      kind: "matchup",
      lane: "middle",
      championIds: [AHRI, SYNDRA],
    });
    expect(report.dropped[0]?.issues.map((issue) => issue.code)).toContain(
      "statistic",
    );
    expect(
      await createTipStore({ directory }).matchupSet("middle", AHRI, SYNDRA),
    ).toBeUndefined();
  });

  test("a set is never written without both directions agreeing on one hash", async () => {
    await run(fakeTipModel(respond));
    const reopened = createTipStore({ directory });
    const [forward, reverse] = await Promise.all([
      reopened.matchupSet("middle", AHRI, SYNDRA),
      reopened.matchupSet("middle", SYNDRA, AHRI),
    ]);
    const [ahri, syndra] = await Promise.all([
      loadChampionGrounding(AHRI),
      loadChampionGrounding(SYNDRA),
    ]);
    expect(forward?.inputHash).toBe(reverse?.inputHash);
    expect(ahri.name).toBe("Ahri");
    expect(syndra.name).toBe("Syndra");
  });
});

describe("the budget and the request cache", () => {
  test("stops before the call that could exceed the budget", async () => {
    const inner = fakeTipModel(respond);
    // The worst case of any call here is far above this limit.
    const budget = new GenerationBudget(1e-6);
    const report = await run(meteredModel({ model: inner, budget }));

    expect(inner.calls).toHaveLength(0);
    expect(report.stoppedByBudget).toContain("budget exhausted");
    expect(report.notStarted).toBeGreaterThan(0);
    expect(report.generated).toBe(0);
  });

  test("charges real usage and stops once the limit is spent", async () => {
    const inner = fakeTipModel(respond);
    // Room for the first call's worst case; once it has spent its real cost,
    // the next call's worst case no longer fits.
    const budget = new GenerationBudget(0.02);
    const report = await runGeneration({
      store: createTipStore({ directory }),
      model: meteredModel({ model: inner, budget }),
      promptVersion: PROMPT_VERSION,
      work: WORK,
      concurrency: 1,
      maxOutputTokens: 1000,
    });

    expect(inner.calls).toHaveLength(1);
    expect(budget.summary().spentUsd).toBeCloseTo(FAKE_CALL_COST_USD);
    expect(report.generated).toBe(1);
    expect(report.stoppedByBudget).toContain("budget exhausted");
    expect(report.notStarted).toBe(1);
  });

  test("an identical request is answered from the cache and costs nothing", async () => {
    const inner = fakeTipModel(respond);
    const budget = new GenerationBudget(1);
    const model = meteredModel({
      model: inner,
      budget,
      cacheDirectory: `${directory}/cache`,
    });
    await run(model);
    // A new store and an emptied output directory, so everything regenerates.
    const secondBudget = new GenerationBudget(1);
    const again = meteredModel({
      model: inner,
      budget: secondBudget,
      cacheDirectory: `${directory}/cache`,
    });
    await rm(`${directory}/matchup`, { recursive: true });
    await rm(`${directory}/general`, { recursive: true });
    await rm(`${directory}/glossary.json`);
    const report = await run(again);

    expect(inner.calls).toHaveLength(2);
    expect(report.generated).toBe(2);
    expect(secondBudget.summary()).toMatchObject({
      spentUsd: 0,
      calls: 0,
      cacheHits: 2,
    });
  });
});

describe("with the League of Legends Wiki", () => {
  test("puts both champions' notes in the prompt and records the pages on the sets", async () => {
    const wiki = fakeWiki(FAKE_WIKI_PAGES);
    const model = fakeTipModel(respond);
    const report = await run(model, { wiki });

    expect(report.generated).toBe(2);
    const matchup = model.calls.find(
      (call) => call.schemaName === "scout_matchup_tips",
    );
    expect(matchup?.hasLookup).toBe(true);
    expect(matchup?.prompt).toContain(
      "Orb of Deception passes through minions",
    );
    expect(matchup?.prompt).toContain("Scatter the Weak knocks back");
    const forward = await createTipStore({ directory }).matchupSet(
      "middle",
      AHRI,
      SYNDRA,
    );
    expect(forward?.wiki).toEqual({
      Ahri: 1000,
      "Ahri/Patch history": 1001,
      Syndra: 1002,
      "Syndra/Patch history": 1003,
    });
    // The offline reader still sees the set as current: no network, same facts.
    if (forward === undefined) {
      throw new Error("the run should have written the forward set");
    }
    expect(await isTipSetStaleAgainstCurrentFacts(forward)).toBe(false);
    expect(report.wikiPages).toBe(4);
    expect(report.toolCalls).toBe(0);
  });

  test("a page the model looked up joins the set's wiki record and the tool calls are counted", async () => {
    const wiki = fakeWiki(FAKE_WIKI_PAGES);
    const model = fakeTipModel(async (call, _index, lookup) => {
      if (lookup !== undefined && call.schemaName === "scout_matchup_tips") {
        const result = await lookup("Slow");
        expect(result.text).toContain("A slow reduces movement speed.");
      }
      return respond(call);
    });
    const report = await run(model, {
      wiki,
      work: { general: [], matchups: WORK.matchups },
    });

    expect(report.toolCalls).toBe(1);
    const forward = await createTipStore({ directory }).matchupSet(
      "middle",
      AHRI,
      SYNDRA,
    );
    expect(forward?.wiki?.["Slow"]).toBeDefined();
    expect(report.wikiPages).toBe(5);
  });

  test("a wiki edit regenerates only the sets that used the edited page", async () => {
    const wiki = fakeWiki(FAKE_WIKI_PAGES);
    await run(fakeTipModel(respond), { wiki });

    const untouched = fakeTipModel(respond);
    const same = await run(untouched, { wiki });
    expect(same).toMatchObject({ current: 2, generated: 0 });
    expect(untouched.calls).toHaveLength(0);

    // Syndra's page is not on Ahri's general set, so only the pair regenerates.
    wiki.edit("Syndra/Patch history", "V26.08: Dark Sphere changed again.");
    const second = fakeTipModel(respond);
    const report = await run(second, { wiki });
    expect(report).toMatchObject({ current: 1, generated: 1 });
    expect(second.calls.map((call) => call.schemaName)).toEqual([
      "scout_matchup_tips",
    ]);
    const forward = await createTipStore({ directory }).matchupSet(
      "middle",
      AHRI,
      SYNDRA,
    );
    expect(forward?.wiki?.["Syndra/Patch history"]).toBe(1004);
  });

  test("a wiki page without notes fails the unit's prefetch loudly", async () => {
    const wiki = fakeWiki({ Ahri: "notes" });
    await expect(run(fakeTipModel(respond), { wiki })).rejects.toThrow(
      "no page for Syndra",
    );
  });
});
