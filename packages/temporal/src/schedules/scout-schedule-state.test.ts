import { describe, expect, test } from "vitest";
import { SCOUT_SCHEDULES } from "./scout-schedule-definitions.ts";
import { buildScheduleState } from "./schedule-state.ts";

const retiredNotes = [
  "Paused until the matching Scout Temporal feature family is enabled and legacy work is drained",
  "Paused until the matching Scout Temporal feature family is enabled",
] as const;

describe("declared beta Scout schedule activation", () => {
  for (const schedule of SCOUT_SCHEDULES.filter(
    (candidate) =>
      candidate.namespace === "beta" &&
      candidate.initialPauseNote === undefined,
  )) {
    test(`${schedule.id} activates only recognized migration pauses`, () => {
      expect(buildScheduleState(schedule, {})).toEqual({ paused: false });
      for (const note of retiredNotes) {
        const active = buildScheduleState(schedule, {}, { paused: true, note });
        expect(active).toEqual({ paused: false });
        expect(buildScheduleState(schedule, {}, active)).toEqual(active);
      }
      for (const previous of [
        { paused: true },
        { paused: true, note: "operator pause" },
        { paused: true, note: `${retiredNotes[0]} (operator hold)` },
        {
          paused: true,
          note: "Paused automatically until required Glitter corpus credentials are configured: TOKEN",
        },
      ]) {
        expect(buildScheduleState(schedule, {}, previous)).toEqual(previous);
      }
      expect(
        buildScheduleState(
          { ...schedule, requiredEnvironment: ["TOKEN"] },
          {},
          { paused: true, note: retiredNotes[0] },
        ).paused,
      ).toBe(true);
    });
  }

  test("production and unrelated declarations preserve migration pauses", () => {
    for (const schedule of [
      {},
      ...SCOUT_SCHEDULES.filter((candidate) => candidate.namespace === "prod"),
    ]) {
      for (const note of retiredNotes) {
        const previous = { paused: true, note };
        expect(buildScheduleState(schedule, {}, previous)).toEqual(previous);
      }
    }
  });
});

function crawl(stage: "beta" | "prod") {
  const schedule = SCOUT_SCHEDULES.find(
    (candidate) => candidate.id === `scout-${stage}-participant-crawl`,
  );
  if (schedule === undefined) throw new Error(`no ${stage} crawl schedule`);
  return schedule;
}

describe("participant crawl schedule activation", () => {
  test.each(["beta", "prod"] as const)(
    "reconciliation clears the created pause on %s",
    (stage) => {
      const schedule = crawl(stage);
      const created = buildScheduleState(schedule, {});
      expect(created.paused).toBe(true);
      expect(buildScheduleState(schedule, {}, created)).toEqual({
        paused: false,
      });
    },
  );

  test("production keeps an operator pause and any other note", () => {
    const schedule = crawl("prod");
    for (const previous of [
      { paused: true },
      { paused: true, note: "operator pause" },
      { paused: true, note: retiredNotes[0] },
    ]) {
      expect(buildScheduleState(schedule, {}, previous)).toEqual(previous);
    }
  });

  test("another production schedule keeps the crawl's pause", () => {
    const created = buildScheduleState(crawl("prod"), {});
    const other = SCOUT_SCHEDULES.find(
      (candidate) => candidate.id === "scout-prod-postmatch-discovery",
    );
    if (other === undefined) throw new Error("no postmatch schedule");
    expect(buildScheduleState(other, {}, created)).toEqual(created);
  });
});
