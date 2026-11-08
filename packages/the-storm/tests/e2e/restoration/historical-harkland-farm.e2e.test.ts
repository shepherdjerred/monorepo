import { describe, expect } from "vitest";
import { test } from "#e2e/fixtures.ts";
import { waitUntil } from "#e2e/harness/bot.ts";

describe.skipIf(Bun.env["STORM_E2E_HARKLAND_FARM"] !== "1")(
  "copied Harkland bread farm",
  () => {
    test("retains its crop bed, sign blocks, seed chest and bread recipe", async ({
      rcon,
    }) => {
      await rcon.command("forceload add -623 2082");
      for (const [x, y, z, facing] of [
        ["-623", "66", "2082", "west"],
        ["-621", "66", "2082", "east"],
        ["-621", "64", "2081", "east"],
      ] as const) {
        const sign = await rcon.command(
          `execute if block ${x} ${y} ${z} minecraft:oak_wall_sign[facing=${facing}]`,
        );
        expect(sign).toContain("Test passed");
      }
      const seed = await rcon.command(
        "data get block -622 67 2082 Items[{Slot:10b}].id",
      );
      expect(seed).toContain("minecraft:wheat_seeds");
      for (const slot of ["0", "1", "2"]) {
        const item = await rcon.command(
          `data get block -622 65 2081 Items[{Slot:${slot}b}].id`,
        );
        expect(item).toContain("minecraft:wheat");
      }
      const wheat = await rcon.command(
        "execute if block -624 66 2084 minecraft:wheat",
      );
      const farmland = await rcon.command(
        "execute if block -624 65 2084 minecraft:farmland",
      );
      expect(wheat).toContain("Test passed");
      expect(farmland).toContain("Test passed");
      await rcon.command("forceload add -623 2079");
      const bread = await rcon.command(
        "data get block -622 64 2079 Items[{Slot:0b}].id",
      );
      expect(bread).toContain("minecraft:bread");
      const hopperBread = await rcon.command(
        "data get block -622 64 2080 Items[{Slot:0b}].id",
      );
      expect(hopperBread).toContain("minecraft:bread");
      await rcon.command(
        "item replace block -622 64 2079 container.0 with air",
      );
      await waitUntil(
        "bread moves from hopper to chest",
        async () => {
          const item = await rcon.command(
            "data get block -622 64 2079 Items[{Slot:0b}].id",
          );
          return item.includes("minecraft:bread");
        },
        10_000,
      );
    });
  },
);
