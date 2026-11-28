import { describe, expect, test } from "vitest";
import type { WorldRect } from "./camera.ts";
import {
  adaptPreviewCap,
  DEFAULT_PREVIEW_CAP,
  FIREFOX_PREVIEW_CAP,
  initialPreviewCap,
  MIN_PREVIEW_CAP,
  percentile,
  selectPreviews,
  type TierFrame,
  type TierInput,
} from "./tiers.ts";

function frame(
  id: string,
  column: number,
  row = 0,
  kind: TierFrame["kind"] = "html",
): TierFrame {
  return { id, kind, rect: { x: column * 700, y: row * 500, w: 640, h: 420 } };
}

const view: WorldRect = { x: 0, y: 0, w: 1500, h: 900 };

function input(overrides: Partial<TierInput>): TierInput {
  return {
    frames: [],
    view,
    mounted: new Set(),
    requested: [],
    liveId: null,
    cap: DEFAULT_PREVIEW_CAP,
    evictFar: true,
    ...overrides,
  };
}

describe("selecting previews", () => {
  test("mounts what is on screen, nearest the centre first, up to the cap", () => {
    const frames = [0, 1, 2, 3, 4, 5].map((column) =>
      frame(`f${String(column)}`, column % 3, Math.floor(column / 3)),
    );
    const next = selectPreviews(input({ frames, cap: 4 }));
    expect(next.size).toBe(4);
    // The middle column is nearest the centre of the view.
    expect(next.has("f1")).toBe(true);
    expect(next.has("f4")).toBe(true);
  });

  test("files never render a preview and the live frame is not counted", () => {
    const frames = [frame("a", 0), frame("b", 1, 0, "file"), frame("live", 2)];
    const next = selectPreviews(input({ frames, liveId: "live", cap: 8 }));
    expect([...next].sort()).toEqual(["a"]);
  });

  test("frames far outside the view do not mount", () => {
    const frames = [frame("near", 0), frame("far", 40)];
    expect([...selectPreviews(input({ frames }))]).toEqual(["near"]);
  });
});

describe("hysteresis", () => {
  const frames = [
    frame("a", 0),
    frame("b", 1),
    frame("c", 2),
    frame("gone", 3, 3),
  ];

  test("a mounted preview that is off screen but near stays mounted", () => {
    const next = selectPreviews(
      input({
        frames,
        view: { ...view, x: 2000 },
        mounted: new Set(["a"]),
        cap: 8,
      }),
    );
    expect(next.has("a")).toBe(true);
  });

  test("and goes once it is a whole view away", () => {
    const next = selectPreviews(
      input({
        frames,
        view: { ...view, x: 6000 },
        mounted: new Set(["a"]),
        cap: 8,
      }),
    );
    expect(next.has("a")).toBe(false);
  });

  test("a preview far outside the view is released after a pan", () => {
    const next = selectPreviews(
      input({
        frames: [frame("a", 0), frame("far", 30)],
        mounted: new Set(["far"]),
        evictFar: true,
      }),
    );
    expect(next.has("far")).toBe(false);
  });

  test("a settle that only zooms evicts nothing for being off screen", () => {
    const next = selectPreviews(
      input({
        frames: [frame("a", 0), frame("far", 30)],
        mounted: new Set(["a", "far"]),
        evictFar: false,
      }),
    );
    expect(next.has("far")).toBe(true);
  });

  test("visible frames never evict each other to make room", () => {
    const visible = [frame("a", 0), frame("b", 1), frame("c", 2)];
    const first = selectPreviews(input({ frames: visible, cap: 2 }));
    expect(first.size).toBe(2);
    const second = selectPreviews(
      input({ frames: visible, cap: 2, mounted: first }),
    );
    expect([...second].sort()).toEqual([...first].sort());
  });

  test("evaluating twice with the same inputs is stable", () => {
    const base = input({ frames: [frame("a", 0), frame("b", 1)] });
    const once = selectPreviews(base);
    expect([...selectPreviews({ ...base, mounted: once })].sort()).toEqual(
      [...once].sort(),
    );
  });
});

describe("the cap", () => {
  test("a lowered cap drops the farthest, off-screen ones first", () => {
    const frames = [frame("a", 0), frame("b", 1), frame("c", 2), frame("d", 3)];
    const next = selectPreviews(
      input({
        frames,
        view: { x: 0, y: 0, w: 1400, h: 900 },
        mounted: new Set(["a", "b", "c", "d"]),
        cap: 2,
      }),
    );
    expect(next.size).toBe(2);
    expect(next.has("d")).toBe(false);
  });

  test("a requested frame takes a slot ahead of the others", () => {
    const frames = [frame("a", 0), frame("b", 1), frame("c", 2)];
    const next = selectPreviews(
      input({ frames, cap: 1, requested: ["c"], mounted: new Set(["a"]) }),
    );
    expect([...next]).toEqual(["c"]);
  });

  test("Firefox starts lower than the rest", () => {
    expect(initialPreviewCap("Mozilla/5.0 Gecko/20100101 Firefox/130.0")).toBe(
      FIREFOX_PREVIEW_CAP,
    );
    expect(initialPreviewCap("Mozilla/5.0 Chrome/130 Safari/537.36")).toBe(
      DEFAULT_PREVIEW_CAP,
    );
  });
});

describe("the adaptive cap", () => {
  const smooth = Array.from({ length: 120 }, (_, at) => at * 16.7);
  const slow = Array.from({ length: 120 }, (_, at) => at * 40);

  test("keeps the cap when frames are on time", () => {
    expect(adaptPreviewCap(8, smooth)).toBe(8);
  });

  test("drops it by two when the p95 interval is over 25 ms", () => {
    expect(adaptPreviewCap(8, slow)).toBe(6);
    expect(adaptPreviewCap(6, slow)).toBe(4);
  });

  test("never goes below three", () => {
    expect(adaptPreviewCap(4, slow)).toBe(MIN_PREVIEW_CAP);
    expect(adaptPreviewCap(3, slow)).toBe(MIN_PREVIEW_CAP);
  });

  test("only the last two seconds count", () => {
    const early = Array.from({ length: 60 }, (_, at) => at * 80);
    const late = Array.from({ length: 150 }, (_, at) => 6000 + at * 16);
    expect(adaptPreviewCap(8, [...early, ...late])).toBe(8);
  });

  test("a burst too short to judge leaves the cap alone", () => {
    expect(adaptPreviewCap(8, [0, 80, 160, 240])).toBe(8);
    expect(adaptPreviewCap(8, [])).toBe(8);
  });

  test("percentile picks the right element", () => {
    expect(percentile([5, 1, 3, 2, 4], 0.5)).toBe(3);
    expect(percentile([], 0.95)).toBe(0);
  });
});
