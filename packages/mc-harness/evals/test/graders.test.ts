import { describe, expect, it } from "vitest";
import { gradeFurnace, parseItems } from "#evals/grade/mechanics.ts";
import { makeMutants } from "#evals/grade/mutants.ts";

const SCENARIO = `
  async setup({ command }) {
    await command("setblock 20 -60 20 minecraft:redstone_lamp");
    await command("setblock 20 -60 21 minecraft:lever[face=wall,facing=north]");
  },
  async run({ actors: { alice }, step, expect }) {
    await step("use", async () => {
      await alice.use(lever);
      await expect.block(lamp).eventually("minecraft:redstone_lamp[lit=true]", { within: 3000 });
    });
    await step("break", async () => {
      await alice.break(lever);
      await expect.block(lamp).eventually("minecraft:redstone_lamp[lit=false]", { within: 3000 });
    });
  },
`;

describe("makeMutants", () => {
  it("applies each mutation without touching lit expectations", () => {
    const [noLamp, noUse, noBreak] = makeMutants(SCENARIO);
    expect(noLamp?.applied).toBe(true);
    expect(noLamp?.source).toContain("setblock 20 -60 20 minecraft:stone");
    expect(noLamp?.source).toContain('"minecraft:redstone_lamp[lit=true]"');
    expect(noUse?.applied).toBe(true);
    expect(noUse?.source).not.toContain("alice.use(");
    expect(noBreak?.applied).toBe(true);
    expect(noBreak?.source).toContain("alice.look(lever)");
  });

  it("reports mutations that do not apply", () => {
    const mutants = makeMutants("export default {};");
    expect(mutants.map((mutant) => mutant.applied)).toEqual([
      false,
      false,
      false,
    ]);
  });
});

describe("parseItems", () => {
  it("parses container contents and empty containers", () => {
    expect(
      parseItems(
        '0, 64, 0 has the following block data: [{Slot: 0b, id: "minecraft:raw_iron", count: 5}, {Slot: 2b, id: "minecraft:iron_ingot", count: 1}]',
      ),
    ).toEqual([
      { slot: 0, id: "minecraft:raw_iron", count: 5 },
      { slot: 2, id: "minecraft:iron_ingot", count: 1 },
    ]);
    expect(parseItems("0, 64, 0 has the following block data: []")).toEqual([]);
    expect(parseItems("The target block is not a block entity")).toBeNull();
  });
});

describe("gradeFurnace", () => {
  const claims = {
    ingotsInChest: 2,
    rawIronRemaining: 5,
    topHopperFillsSlot: "input",
  };
  const truth = {
    chest: [{ slot: 0, id: "minecraft:iron_ingot", count: 2 }],
    hopper: [{ slot: 0, id: "minecraft:iron_ingot", count: 1 }],
    furnace: [{ slot: 0, id: "minecraft:raw_iron", count: 5 }],
    topHopperFurnace: [{ slot: 0, id: "minecraft:raw_iron", count: 1 }],
  };

  it("passes correct claims backed by the world", () => {
    expect(gradeFurnace(claims, truth).every((check) => check.pass)).toBe(true);
  });

  it("fails wrong claims and an unticked experiment", () => {
    const checks = gradeFurnace(
      { ingotsInChest: 0, rawIronRemaining: 8, topHopperFillsSlot: "fuel" },
      {
        ...truth,
        chest: [],
        hopper: [],
        furnace: [{ slot: 0, id: "minecraft:raw_iron", count: 8 }],
      },
    );
    expect(
      checks.filter((check) => !check.pass).map((check) => check.name),
    ).toEqual([
      "claimed ingots in chest (2 or 3)",
      "claimed raw iron remaining (5)",
      "claimed top hopper fills the input slot",
      "world: 3 ingots between furnace output, hopper and chest",
      "world: 5 raw iron left in the furnace input",
    ]);
  });

  it("fails when positions cannot be inspected", () => {
    const checks = gradeFurnace(claims, {
      chest: null,
      hopper: null,
      furnace: null,
      topHopperFurnace: null,
    });
    expect(
      checks.filter((check) => !check.pass).map((check) => check.name),
    ).toEqual([
      "world state inspectable at the reported positions",
      "world: top-hopper furnace has an item in its input slot",
    ]);
  });
});
