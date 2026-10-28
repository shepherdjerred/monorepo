import { once } from "node:events";
import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import { test } from "#e2e/fixtures.ts";
import { waitForMessage, waitUntil } from "#e2e/harness/bot.ts";
import type { RconClient } from "#e2e/harness/rcon.ts";

async function editGate(
  bot: Bot,
  rcon: RconClient,
  index: number,
  message: RegExp,
) {
  const x = 500 + index * 10;
  const right = String(x + 1);
  await rcon.command(`tp ${bot.username} ${right}.5 71 3.5`);
  await waitUntil(
    "owner reaches gate sign",
    () => Math.abs(bot.entity.position.x - (x + 1.5)) < 0.3,
  );
  const position = new Vec3(x + 1, 72, 1);
  await waitUntil(
    "gate sign loaded",
    () => bot.blockAt(position)?.name === "birch_wall_sign",
  );
  const sign = bot.blockAt(position);
  if (sign === null) throw new Error("Gate sign missing");
  const editor = once(bot._client, "open_sign_entity", {
    signal: AbortSignal.timeout(5000),
  });
  await bot.activateBlock(sign);
  await editor;
  const result = waitForMessage(bot, message);
  bot.updateSign(sign, `Gate${String(index)}\nDestination\n\nA`);
  await result;
}

test("a player can own four always-open gates and create another after removal", async ({
  bot,
  rcon,
}) => {
  const granted = waitForMessage(bot, /admin set your Mechanic to III/iu);
  await rcon.command(`perks admin set ${bot.username} mechanic 3`);
  await granted;
  await rcon.command("forceload add 496 -16 544 0");
  await rcon.command("fill 496 69 0 545 69 5 minecraft:stone");
  for (let i = 0; i < 5; i++) {
    const x = 500 + i * 10;
    const bottom = String(x - 1),
      origin = String(x),
      left = String(x - 2),
      right = String(x + 1);
    await rcon.command(`fill ${bottom} 71 0 ${origin} 73 0 minecraft:air`);
    await rcon.command(`fill ${bottom} 70 1 ${origin} 70 3 minecraft:stone`);
    await rcon.command(`fill ${bottom} 70 0 ${origin} 70 0 minecraft:obsidian`);
    await rcon.command(`fill ${bottom} 74 0 ${origin} 74 0 minecraft:obsidian`);
    await rcon.command(`fill ${left} 71 0 ${left} 73 0 minecraft:obsidian`);
    await rcon.command(`fill ${right} 71 0 ${right} 73 0 minecraft:obsidian`);
    await rcon.command(
      `setblock ${left} 72 1 minecraft:stone_button[face=wall,facing=south]`,
    );
    await rcon.command(
      `setblock ${right} 72 1 minecraft:birch_wall_sign[facing=south]`,
    );
    await editGate(
      bot,
      rcon,
      i,
      i < 4
        ? new RegExp(`Stargate Gate${String(i)} created`, "u")
        : /at most four always-open Stargates/u,
    );
  }
  await rcon.command(`tp ${bot.username} 501.5 71 3.5`);
  await waitUntil(
    "owner returns to first sign",
    () => Math.abs(bot.entity.position.x - 501.5) < 0.3,
  );
  const first = bot.blockAt(new Vec3(501, 72, 1));
  if (first === null) throw new Error("First gate sign missing");
  await bot.dig(first);
  await waitUntil("first gate removed", async () => {
    const result = await rcon.command(
      "execute if block 501 72 1 minecraft:air",
    );
    return result.includes("Test passed");
  });
  await editGate(bot, rcon, 4, /Stargate Gate4 created/u);
});
