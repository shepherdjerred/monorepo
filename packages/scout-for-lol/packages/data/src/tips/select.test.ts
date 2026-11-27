import { describe, expect, test } from "vitest";
import { currentLanePriors } from "#src/lane-priors/current.ts";
import { type TipPlan, planTips } from "#src/tips/plan.ts";
import { lanePriorTipPlanSource } from "#src/tips/plan-sources.ts";
import {
  ALL_TIPS,
  type TipKind,
  parseTipSelector,
  selectWork,
} from "#src/tips/select.ts";
import { AHRI, SYNDRA } from "#src/tips/tips.fixture.ts";

const source = lanePriorTipPlanSource(currentLanePriors);
const plan: TipPlan = planTips(source);

describe("parseTipSelector", () => {
  test("reads a champion in a lane, with an optional opponent", () => {
    expect(parseTipSelector("middle/Ahri")).toEqual({
      lane: "middle",
      champion: AHRI,
    });
    expect(parseTipSelector("middle/Ahri,Syndra")).toEqual({
      lane: "middle",
      champion: AHRI,
      opponent: SYNDRA,
    });
  });

  test("accepts display names and Riot's lane names", () => {
    expect(parseTipSelector("bottom/Twisted Fate").lane).toBe("adc");
    expect(parseTipSelector("middle/ahri , syndra").opponent).toBe(SYNDRA);
  });

  test("rejects a bad lane, an unknown champion and a self matchup", () => {
    expect(() => parseTipSelector("mid/Ahri")).toThrow("unknown lane");
    expect(() => parseTipSelector("middle/Nobody")).toThrow("unknown champion");
    expect(() => parseTipSelector("middle/Ahri,Ahri")).toThrow(
      "same champion twice",
    );
    expect(() => parseTipSelector("Ahri")).toThrow("lane/Champion");
  });
});

describe("selectWork", () => {
  test("selects the whole plan by default", () => {
    const work = selectWork(plan, source, ALL_TIPS);
    expect(work.general).toHaveLength(plan.counts.championLanes);
    expect(work.matchups).toHaveLength(plan.counts.units);
  });

  test("keeps the most-played units of one lane, most played first", () => {
    const work = selectWork(plan, source, {
      ...ALL_TIPS,
      lane: "middle",
      limit: 20,
      kinds: new Set<TipKind>(["matchup"]),
    });
    expect(work.general).toEqual([]);
    expect(work.matchups).toHaveLength(20);
    expect(work.matchups.every((unit) => unit.lane === "middle")).toBe(true);
    const games = work.matchups.map((unit) => unit.games);
    expect(games).toEqual(games.toSorted((left, right) => right - left));
    const everyMiddle = selectWork(plan, source, {
      ...ALL_TIPS,
      lane: "middle",
      kinds: new Set<TipKind>(["matchup"]),
    }).matchups;
    expect(everyMiddle.slice(0, 20)).toEqual(work.matchups);
  });

  test("a champion selector takes its general set and every planned pair it is in", () => {
    const work = selectWork(plan, source, {
      ...ALL_TIPS,
      selectors: [parseTipSelector("middle/Ahri")],
    });
    expect(work.general.map((entry) => entry.championId)).toEqual([AHRI]);
    expect(work.matchups.length).toBeGreaterThan(0);
    expect(work.matchups.every((unit) => unit.championIds.includes(AHRI))).toBe(
      true,
    );
  });

  test("an explicit pair is generated even when the plan pruned it", () => {
    const work = selectWork(plan, source, {
      ...ALL_TIPS,
      selectors: [parseTipSelector("support/Ahri,Syndra")],
    });
    expect(work.general).toEqual([]);
    expect(work.matchups).toEqual([
      expect.objectContaining({ lane: "support", championIds: [AHRI, SYNDRA] }),
    ]);
  });

  test("the pair is one unit whichever side is named first", () => {
    const forward = selectWork(plan, source, {
      ...ALL_TIPS,
      selectors: [parseTipSelector("middle/Ahri,Syndra")],
    });
    const reverse = selectWork(plan, source, {
      ...ALL_TIPS,
      selectors: [parseTipSelector("middle/Syndra,Ahri")],
    });
    expect(forward.matchups.map((unit) => unit.championIds)).toEqual(
      reverse.matchups.map((unit) => unit.championIds),
    );
    expect(forward.matchups).toHaveLength(1);
  });
});
