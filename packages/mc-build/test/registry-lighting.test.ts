import { describe, expect, test } from "vitest";
import {
  registryFileFromBridge,
  type BridgeRegistry,
} from "#src/registry/from-bridge.ts";
import { BlockRegistry } from "#src/registry/registry.ts";

function exported(): BridgeRegistry {
  return {
    minecraftVersion: "26.2",
    dataVersion: 4903,
    blocks: [
      {
        id: "minecraft:redstone_torch",
        defaultState: "minecraft:redstone_torch[lit=true]",
        properties: { lit: ["true", "false"] },
        lighting: {
          states: 2,
          default: { emission: 7, transmits: true },
          overrides: {
            "minecraft:redstone_torch[lit=false]": {
              emission: 0,
              transmits: true,
            },
          },
        },
      },
    ],
  };
}

describe("registry lighting contract", () => {
  test("resolves defaults and partial states through the exported table", () => {
    const registry = new BlockRegistry(registryFileFromBridge(exported()));
    expect(registry.lighting("redstone_torch").emission).toBe(7);
    expect(registry.lighting("redstone_torch[lit=false]").emission).toBe(0);
    expect(() => registry.lighting("redstone_torch[lit=invalid]")).toThrow();
    expect(() => registry.lighting("unknown_block")).toThrow();
  });

  test("rejects an incomplete enumeration", () => {
    const fixture = exported();
    const block = fixture.blocks[0];
    if (block === undefined) throw new Error("missing fixture block");
    expect(() =>
      registryFileFromBridge({
        ...fixture,
        blocks: [
          {
            ...block,
            lighting: { ...block.lighting, states: 1 },
          },
        ],
      }),
    ).toThrow(/expected 2/u);
  });

  test.each([
    "minecraft:stone",
    "minecraft:redstone_torch",
    "minecraft:redstone_torch[lit=invalid]",
  ])("rejects an override outside complete states: %s", (state) => {
    const fixture = exported();
    const block = fixture.blocks[0];
    if (block === undefined) throw new Error("missing fixture block");
    expect(() =>
      registryFileFromBridge({
        ...fixture,
        blocks: [
          {
            ...block,
            lighting: {
              ...block.lighting,
              overrides: {
                [state]: { emission: 0, transmits: true },
              },
            },
          },
        ],
      }),
    ).toThrow();
  });
});
