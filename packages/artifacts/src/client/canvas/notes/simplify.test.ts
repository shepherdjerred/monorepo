import { describe, expect, test } from "vitest";
import { MAX_PEN_POINTS } from "#shared/notes.ts";
import { fitStroke, MAX_STROKE_POINTS, simplify } from "./simplify.ts";

describe("simplify", () => {
  test("a straight run collapses to its ends", () => {
    const line = Array.from({ length: 50 }, (_, at) => ({ x: at, y: at * 2 }));
    expect(simplify(line, 0.5)).toEqual([line[0], line.at(-1)]);
  });

  test("keeps the corner of an L", () => {
    const corner = [
      ...Array.from({ length: 20 }, (_, at) => ({ x: at, y: 0 })),
      ...Array.from({ length: 20 }, (_, at) => ({ x: 19, y: at + 1 })),
    ];
    const out = simplify(corner, 0.5);
    expect(out).toHaveLength(3);
    expect(out[1]).toEqual({ x: 19, y: 0 });
  });

  test("never moves a kept point and keeps their order", () => {
    const wiggle = Array.from({ length: 200 }, (_, at) => ({
      x: at,
      y: Math.sin(at / 6) * 30,
    }));
    const out = simplify(wiggle, 1);
    expect(out.length).toBeLessThan(wiggle.length);
    let last = -1;
    for (const point of out) {
      const at = wiggle.indexOf(point);
      expect(at).toBeGreaterThan(last);
      last = at;
    }
    expect(out[0]).toBe(wiggle[0]);
    expect(out.at(-1)).toBe(wiggle.at(-1));
  });

  test("every dropped point is within the tolerance of the result", () => {
    const wiggle = Array.from({ length: 300 }, (_, at) => ({
      x: at * 2,
      y: Math.sin(at / 9) * 40 + Math.cos(at / 3) * 3,
    }));
    const tolerance = 2;
    const out = simplify(wiggle, tolerance);
    for (const point of wiggle) {
      const nearest = Math.min(
        ...out.slice(1).map((end, at) => {
          const start = out[at];
          if (start === undefined) return Number.POSITIVE_INFINITY;
          const dx = end.x - start.x;
          const dy = end.y - start.y;
          const length = dx * dx + dy * dy;
          const along = Math.max(
            0,
            Math.min(
              1,
              ((point.x - start.x) * dx + (point.y - start.y) * dy) / length,
            ),
          );
          return Math.hypot(
            point.x - (start.x + along * dx),
            point.y - (start.y + along * dy),
          );
        }),
      );
      expect(nearest).toBeLessThanOrEqual(tolerance + 1e-9);
    }
  });

  test("short input is returned as is", () => {
    expect(simplify([], 1)).toEqual([]);
    expect(simplify([{ x: 1, y: 1 }], 1)).toEqual([{ x: 1, y: 1 }]);
  });
});

describe("fitStroke", () => {
  test("agrees with the contract's cap", () => {
    expect(MAX_STROKE_POINTS).toBe(MAX_PEN_POINTS);
  });

  test("a noisy long stroke fits the cap and keeps its ends", () => {
    const raw = Array.from({ length: 5000 }, (_, at) => ({
      x: at,
      y: Math.sin(at / 3) * 20 + ((at * 7919) % 11) / 5,
    }));
    const fitted = fitStroke(raw);
    expect(fitted?.length).toBeLessThanOrEqual(MAX_STROKE_POINTS);
    expect(fitted?.[0]).toEqual({
      x: 0,
      y: raw[0] === undefined ? 0 : Math.round(raw[0].y * 10) / 10,
    });
  });

  test("rounds to a tenth and drops repeats", () => {
    expect(
      fitStroke([
        { x: 0.04, y: 0.04 },
        { x: 0.01, y: 0.02 },
        { x: 10.26, y: 5.04 },
      ]),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 10.3, y: 5 },
    ]);
  });

  test("a dot is not a stroke", () => {
    expect(fitStroke([{ x: 3, y: 3 }])).toBeNull();
    expect(
      fitStroke([
        { x: 3, y: 3 },
        { x: 3.01, y: 3.02 },
      ]),
    ).toBeNull();
  });
});
