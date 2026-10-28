import { once } from "node:events";
import type { Bot } from "mineflayer";
import type { Vec3 } from "vec3";
import { waitUntil } from "#e2e/harness/bot.ts";
import type { RconClient } from "#e2e/harness/rcon.ts";

type SignWood = "birch" | "oak";

export async function placeStargateControls(
  rcon: RconClient,
  left: string,
  right: string,
  wood: SignWood,
) {
  await rcon.command(
    `setblock ${left} 72 1 minecraft:stone_button[face=wall,facing=south]`,
  );
  await rcon.command(
    `setblock ${right} 72 1 minecraft:${wood}_wall_sign[facing=south]`,
  );
}

export async function buildClassicStargateFrame(
  rcon: RconClient,
  x: number,
  wood: SignWood,
) {
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
  await placeStargateControls(rcon, left, right, wood);
  return { left, right };
}

export async function openStargateSign(
  bot: Bot,
  position: Vec3,
  wood: SignWood,
): Promise<NonNullable<ReturnType<Bot["blockAt"]>>> {
  await waitUntil(
    "Stargate sign loaded",
    () => bot.blockAt(position)?.name === `${wood}_wall_sign`,
  );
  const sign = bot.blockAt(position);
  if (sign === null) throw new Error("Stargate sign missing");
  const editor = once(bot._client, "open_sign_entity", {
    signal: AbortSignal.timeout(5000),
  });
  await bot.activateBlock(sign);
  await editor;
  return sign;
}
