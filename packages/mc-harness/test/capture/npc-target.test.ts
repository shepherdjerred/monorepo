import { expect, it } from "vitest";
import { isLocalEntityUse } from "#daemon/painting-target.ts";
const box = {
  world: "world",
  min: { x: 0, y: 64, z: 0 },
  max: { x: 8, y: 72, z: 8 },
};
const npc = {
  kind: "entity",
  type: "minecraft:player",
  bounds: { min: [2, 65, 2], max: [2.6, 66.8, 2.6] },
};
it("permits local conversation inside the declared world-space bounds", () => {
  expect(isLocalEntityUse("sbx-owned", "use", npc, box)).toBe(true);
  expect(
    isLocalEntityUse(
      "sbx-owned",
      "use",
      { ...npc, type: "minecraft:tnt" },
      box,
    ),
  ).toBe(true);
});
it("refuses live, attack, other entity types and malformed or escaping bounds", () => {
  expect(isLocalEntityUse("live", "use", npc, box)).toBe(false);
  expect(isLocalEntityUse("sbx-owned", "attack", npc, box)).toBe(false);
  expect(
    isLocalEntityUse(
      "sbx-owned",
      "use",
      { ...npc, type: "minecraft:zombie" },
      box,
    ),
  ).toBe(false);
  for (const bounds of [
    { min: [-1, 65, 2], max: [2, 67, 3] },
    { min: [2, 65, 2], max: [10, 67, 3] },
    { min: [2, 65, 2], max: [1, 67, 3] },
    { min: [2, 65], max: [3, 67, 3] },
  ])
    expect(isLocalEntityUse("sbx-owned", "use", { ...npc, bounds }, box)).toBe(
      false,
    );
});
