import { describe, expect } from "vitest";
import { test } from "#e2e/fixtures.ts";
import { waitUntil } from "#e2e/harness/bot.ts";
import { e2eProfile } from "#e2e/gameplay-fixtures.ts";
import type { RconClient } from "#e2e/harness/rcon.ts";
import { serverLogs } from "#e2e/harness/external/files.ts";

async function passes(rcon: RconClient, condition: string) {
  const reply = await rcon.command(`execute ${condition}`);
  return reply.includes("Test passed");
}

async function block(rcon: RconClient, x: number, state: string) {
  await waitUntil(`unsigned IC ${x.toString()} produces ${state}`, () =>
    passes(rcon, `if block ${x.toString()} -39 -1 minecraft:${state}`),
  );
}

async function stock(rcon: RconClient, x: number, item: string, count: number) {
  await waitUntil(
    `inventory at ${x.toString()} contains ${count.toString()} ${item}`,
    () =>
      passes(
        rcon,
        `if data block ${x.toString()} -39 1 Items[{id:"minecraft:${item}",count:${count.toString()}}]`,
      ),
  );
}

const worldSignsEnabled =
  e2eProfile() === "e2e" &&
  Bun.env["STORM_E2E_WORLD_SIGNS"] === "1" &&
  Bun.env["STORM_E2E_HISTORICAL_MECHANICS"] !== "1";

describe.skipIf(!worldSignsEnabled)(
  "CraftBook circuits discovered from the world on real Paper",
  () => {
    test("recovers Stargates, owners and public networks from native sign metadata with an empty or failed index", async ({
      server,
      rcon,
    }) => {
      await rcon.command("stormworldsignproof");
      await waitUntil(
        "native Stargate recovery proof",
        async () => {
          const logs = await serverLogs(server);
          if (logs.includes("WORLD_STARGATE_PAPER_FAILED"))
            throw new Error(logs.slice(-12_000));
          return logs.includes("WORLD_STARGATE_PAPER_PASS");
        },
        50_000,
      );
    });
    test("discovers unsigned logic and wireless signs without an import catalog", async ({
      rcon,
      server,
    }) => {
      await rcon.command("forceload add 510 -32 639 15");
      const missingLeverWarnings = async () => {
        const logs = await serverLogs(server);
        return logs
          .split("\n")
          .filter(
            (line) =>
              line.includes("x=528, y=-40, z=0") &&
              line.includes("missing output lever"),
          ).length;
      };
      await waitUntil(
        "missing clock lever is diagnosed",
        async () => (await missingLeverWarnings()) > 0,
      );
      const warningsBefore = await missingLeverWarnings();
      for (const x of [512, 520, 524]) {
        await waitUntil(`logic IC ${x.toString()} output`, () =>
          passes(
            rcon,
            `if block ${x.toString()} -40 2 minecraft:lever[powered=true]`,
          ),
        );
      }
      for (const powered of [true, false]) {
        await waitUntil(`clock output ${String(powered)}`, () =>
          passes(
            rcon,
            `if block 516 -40 2 minecraft:lever[powered=${String(powered)}]`,
          ),
        );
      }
      expect(await missingLeverWarnings()).toBe(warningsBefore);
      expect(
        await passes(rcon, "if block 536 -40 2 minecraft:lever[powered=true]"),
      ).toBe(true);
      expect(
        await passes(rcon, "if block 532 -40 2 minecraft:lever[powered=false]"),
      ).toBe(true);
    });

    test("plants numeric legacy seeds, fertilizes, harvests and cultivates with real stock", async ({
      rcon,
    }) => {
      await rcon.command("forceload add 510 -32 639 15");
      await block(rcon, 544, "wheat");
      await stock(rcon, 544, "wheat_seeds", 7);
      await block(rcon, 548, "wheat[age=7]");
      await stock(rcon, 548, "bone_meal", 9);
      await block(rcon, 552, "air");
      expect(
        await passes(
          rcon,
          'if data block 552 -39 1 Items[{id:"minecraft:wheat"}]',
        ),
      ).toBe(true);
      await waitUntil("cultivator tills soil", () =>
        passes(rcon, "if block 556 -40 -1 minecraft:farmland"),
      );
      expect(
        await passes(
          rcon,
          'if data block 556 -39 1 Items[{id:"minecraft:iron_hoe",components:{"minecraft:damage":1}}]',
        ),
      ).toBe(true);
    });

    test("breakers retain drops and container contents, and crafters retain the recipe sample", async ({
      rcon,
    }) => {
      await rcon.command("forceload add 510 -32 639 15");
      await waitUntil("block breaker removes its target", () =>
        passes(rcon, "if block 560 -39 1 minecraft:air"),
      );
      expect(
        await passes(
          rcon,
          'positioned 560 -40 0 if entity @e[type=item,nbt={Item:{id:"minecraft:cobblestone",count:1}},distance=..3]',
        ),
      ).toBe(true);
      await waitUntil("container breaker removes its target", () =>
        passes(rcon, "if block 564 -39 1 minecraft:air"),
      );
      expect(
        await passes(
          rcon,
          'positioned 564 -40 0 if entity @e[type=item,nbt={Item:{id:"minecraft:gold_ingot",count:3}},distance=..3]',
        ),
      ).toBe(true);
      await stock(rcon, 568, "oak_planks", 1);
      expect(
        await passes(
          rcon,
          'if data block 569 -39 1 Items[{id:"minecraft:oak_button",count:1}]',
        ),
      ).toBe(true);
    });

    test("sorters route matching and unmatched stacks while keeping the sample", async ({
      rcon,
    }) => {
      await rcon.command("forceload add 510 -32 639 15");
      await stock(rcon, 572, "diamond", 1);
      expect(
        await passes(
          rcon,
          'if data block 571 -40 1 Items[{id:"minecraft:diamond",count:3}]',
        ),
      ).toBe(true);
      expect(
        await passes(
          rcon,
          'if data block 573 -40 1 Items[{id:"minecraft:oak_planks",count:4}]',
        ),
      ).toBe(true);
    });

    test("animal machines use buckets and food and produce wool, milk and a baby", async ({
      rcon,
    }) => {
      await rcon.command("forceload add 510 -32 639 15");
      await stock(rcon, 580, "milk_bucket", 1);
      await stock(rcon, 580, "blue_wool", 3);
      expect(
        await passes(
          rcon,
          'unless data block 586 -39 1 Items[{id:"minecraft:wheat"}]',
        ),
      ).toBe(true);
      await rcon.command("scoreboard objectives add circuitAge dummy");
      await rcon.command(
        "execute positioned 586 -40 -2 as @e[type=cow,distance=..3] store result score @s circuitAge run data get entity @s Age",
      );
      expect(
        await passes(
          rcon,
          "positioned 586 -40 -2 if entity @e[type=cow,scores={circuitAge=..-1},distance=..3]",
        ),
      ).toBe(true);
      expect(
        await passes(
          rcon,
          "positioned 586 -40 -2 if entity @e[type=cow,scores={circuitAge=1..},distance=..3]",
        ),
      ).toBe(true);
    });

    test("checks protected crop cells before consuming stock and stages full tree growth", async ({
      rcon,
    }) => {
      await rcon.command("forceload add 510 -32 639 15");
      await block(rcon, 600, "oak_log");
      expect(
        await passes(
          rcon,
          'unless data block 600 -39 1 Items[{id:"minecraft:bone_meal"}]',
        ),
      ).toBe(true);
      await block(rcon, 592, "wheat[age=0]");
      await stock(rcon, 592, "bone_meal", 16);
      await block(rcon, 608, "oak_sapling");
      await stock(rcon, 608, "bone_meal", 1);
      expect(await passes(rcon, "if block 608 -38 -1 minecraft:air")).toBe(
        true,
      );
    });
  },
);

describe.skipIf(!worldSignsEnabled)(
  "CraftBook item conservation on real Paper",
  () => {
    test("breakers preserve filled shulker boxes without loose duplicate contents", async ({
      rcon,
    }) => {
      await rcon.command("forceload add 510 -32 639 15");
      await waitUntil("shulker breaker removes its target", () =>
        passes(rcon, "if block 624 -39 1 minecraft:air"),
      );
      const contents = await rcon.command(
        'execute positioned 624 -40 0 run data get entity @e[type=item,nbt={Item:{id:"minecraft:shulker_box"}},distance=..3,limit=1] Item.components."minecraft:container"',
      );
      expect(contents).toContain("minecraft:diamond");
      expect(contents).toMatch(/count: 3/u);
      expect(
        await passes(
          rcon,
          'positioned 624 -40 0 unless entity @e[type=item,nbt={Item:{id:"minecraft:diamond"}},distance=..3]',
        ),
      ).toBe(true);
    });

    test("crafters retain sample ingredients and emit all container remainders", async ({
      rcon,
    }) => {
      await rcon.command("forceload add 510 -32 639 15");
      await stock(rcon, 621, "honey_block", 1);
      await stock(rcon, 621, "glass_bottle", 4);
      for (const slot of [0, 1, 3, 4])
        expect(
          await passes(
            rcon,
            `if data block 620 -39 1 Items[{Slot:${slot.toString()}b,id:"minecraft:honey_bottle",count:1}]`,
          ),
        ).toBe(true);
    });
  },
);
