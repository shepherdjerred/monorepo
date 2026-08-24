import { describe, expect, test } from "vitest";
import { scoutMarkPaths, scoutMarkSvg, scoutTileSvg } from "./geometry.ts";

describe("scout mark geometry", () => {
  test("svg uses the shared hexagon and star paths", () => {
    const svg = scoutMarkSvg({
      stroke: "currentColor",
      fill: "currentColor",
      strokeWidth: 1.5,
    });
    expect(svg).toContain(scoutMarkPaths.hexagon);
    expect(svg).toContain(scoutMarkPaths.star);
  });

  test("tile wraps the same mark on a canvas", () => {
    const svg = scoutTileSvg({
      size: 180,
      radius: 40,
      canvas: "#F0E6D2",
      stroke: "#005A82",
      fill: "#005A82",
      strokeWidth: 2,
    });
    expect(svg).toContain('fill="#F0E6D2"');
    expect(svg).toContain(scoutMarkPaths.hexagon);
  });
});
