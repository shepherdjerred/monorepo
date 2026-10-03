import { describe, expect, test } from "vitest";
import { SCOUT_SCHEDULES } from "./scout-schedule-definitions.ts";
import { buildScheduleState } from "./schedule-state.ts";

const retiredNotes = [
  "Paused until the matching Scout Temporal feature family is enabled and legacy work is drained",
  "Paused until the matching Scout Temporal feature family is enabled",
] as const;

describe("declared beta Scout schedule activation", () => {
  for (const schedule of SCOUT_SCHEDULES.filter(
    (candidate) => candidate.namespace === "beta",
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
