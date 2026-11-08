import { describe } from "vitest";
import { Vec3 } from "vec3";
import { test } from "#e2e/fixtures.ts";
import { waitUntil } from "#e2e/harness/bot.ts";

describe.skipIf(Bun.env["STORM_E2E_HISTORICAL_MECHANICS"] !== "1")(
  "historical spawn lift",
  () => {
    test("binds the saved sign and takes a player to the next floor", async ({
      bot,
      rcon,
    }) => {
      await rcon.command("forceload add 59 -34");
      await rcon.command(`minecraft:tp ${bot.username} 59.5 69 -32.5`);
      await waitUntil(
        "player near lift",
        () => Math.abs(bot.entity.position.x - 59.5) < 2,
      );
      await waitUntil(
        "lift sign loaded",
        () =>
          bot.blockAt(new Vec3(59, 69, -34))?.name.includes("sign") === true,
      );
      const sign = bot.blockAt(new Vec3(59, 69, -34));
      if (sign === null) throw new Error("Historical lift sign missing");
      await bot.activateBlock(sign);
      await waitUntil(
        "player reaches next floor",
        () => Math.abs(bot.entity.position.y - 75) < 2,
        15_000,
      );
    });
  },
);
