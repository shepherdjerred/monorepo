import { describe, expect, it } from "vitest";
import { playbackAdvance, playbackCompleted } from "./playback.ts";

const previousAt = new Date("2026-11-14T00:00:00Z");
const sample = {
  previousAt,
  observedAt: new Date("2026-11-14T00:01:00Z"),
  previousProgressMs: 100_000,
  progressMs: 160_000,
  previousState: "playing",
  state: "playing",
};
describe("observed playback accounting", () => {
  it("counts elapsed forward playback once", () => {
    expect(playbackAdvance(sample)).toBe(60_000);
  });
  it.each(["paused", "buffering", "stopped"])(
    "does not count a %s sample",
    (state) => {
      expect(playbackAdvance({ ...sample, state })).toBe(0);
      expect(playbackAdvance({ ...sample, previousState: state })).toBe(0);
    },
  );
  it("does not count seeks, stale gaps, reverse progress or repeated observations", () => {
    expect(playbackAdvance({ ...sample, progressMs: 1_000_000 })).toBe(0);
    expect(playbackAdvance({ ...sample, progressMs: 90_000 })).toBe(0);
    expect(playbackAdvance({ ...sample, observedAt: previousAt })).toBe(0);
    expect(
      playbackAdvance({
        ...sample,
        observedAt: new Date("2026-11-14T00:05:00Z"),
      }),
    ).toBe(0);
  });
  it("keeps reporting completion separate from elapsed watching", () => {
    expect(playbackCompleted(850, 1000)).toBe(true);
    expect(playbackCompleted(849, 1000)).toBe(false);
    expect(playbackCompleted(1, 0)).toBe(false);
  });
});
