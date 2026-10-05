import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import { waitForMessage, waitUntil } from "#e2e/harness/bot.ts";
import type { RconClient } from "#e2e/harness/rcon.ts";

/** Start the selected Settlement round, observing each native transition. */
export async function startSettlementRound(
  bot: Bot,
  rcon: RconClient,
  round: number,
): Promise<void> {
  await rcon.command(`op ${bot.username}`);
  const joined = waitForMessage(bot, /Survival: Fighter/u);
  bot.chat(`/arena join settlement ${round.toString()}`);
  await joined;
  await rcon.command("difficulty normal");
  const started = waitForMessage(
    bot,
    new RegExp(`Round ${round.toString()}:`, "u"),
  );
  await rcon.command("arena start settlement");
  await started;
}

export async function startProtectedSettlementRound(
  bot: Bot,
  rcon: RconClient,
  round: number,
): Promise<void> {
  await startSettlementRound(bot, rcon, round);
  await rcon.command(
    `effect give ${bot.username} minecraft:resistance infinite 255 true`,
  );
}

/** Use the native airstrip interaction and wait for the Runeforge arrival. */
export async function travelToRuneforge(
  bot: Bot,
  rcon: RconClient,
): Promise<void> {
  await rcon.command(
    `execute in settlement run tp ${bot.username} 61.5 105 -49.5`,
  );
  await waitUntil(
    "airstrip loaded",
    () => bot.blockAt(new Vec3(60, 105, -51)) !== null,
  );
  const airstrip = bot.blockAt(new Vec3(60, 105, -51));
  if (airstrip === null) throw new Error("Airstrip missing");
  const landed = waitForMessage(bot, /Offshore Runeforge/u, 15_000);
  await bot.activateBlock(airstrip);
  await landed;
}
