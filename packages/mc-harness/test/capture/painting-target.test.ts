import { describe, expect, it } from "vitest";
import { isLocalPaintingUse } from "#src/daemon/painting-target.ts";

const box = {
  world: "world",
  min: { x: 0, y: 0, z: 0 },
  max: { x: 5, y: 5, z: 5 },
};
const hit = {
  kind: "entity",
  type: "minecraft:painting",
  bounds: { min: [2, 2, 2], max: [4, 4, 2.1] },
};

describe("bounded painting interaction", () => {
  it("allows a local painting fully contained in the fixture", () => {
    expect(isLocalPaintingUse("sbx-test", "use", hit, box)).toBe(true);
  });
  it("refuses live entities and attacks", () => {
    expect(isLocalPaintingUse("live", "use", hit, box)).toBe(false);
    expect(isLocalPaintingUse("sbx-test", "attack", hit, box)).toBe(false);
  });
  it("refuses players, incomplete observations and an entity crossing the edge", () => {
    expect(
      isLocalPaintingUse(
        "sbx-test",
        "use",
        { ...hit, type: "minecraft:player" },
        box,
      ),
    ).toBe(false);
    expect(
      isLocalPaintingUse(
        "sbx-test",
        "use",
        { kind: "entity", type: "minecraft:painting" },
        box,
      ),
    ).toBe(false);
    expect(
      isLocalPaintingUse(
        "sbx-test",
        "use",
        { ...hit, bounds: { min: [2, 2, 2], max: [6.1, 4, 2.1] } },
        box,
      ),
    ).toBe(false);
    expect(
      isLocalPaintingUse(
        "sbx-test",
        "use",
        { ...hit, bounds: { min: [2, 2, 2], max: [1, 4, 2.1] } },
        box,
      ),
    ).toBe(false);
  });
});
