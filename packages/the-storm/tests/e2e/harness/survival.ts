import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import { waitForMessage, waitUntil } from "./bot.ts";
import type { RconClient } from "./rcon.ts";

export async function startSettlementRound(
  bot: Bot,
  rcon: RconClient,
  round: number,
) {
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

export async function visitOffshoreRuneforge(bot: Bot, rcon: RconClient) {
  await rcon.command(`tp ${bot.username} 1853.5 105 2158.5`);
  await waitUntil(
    "airstrip loaded",
    () => bot.blockAt(new Vec3(1852, 105, 2157)) !== null,
  );
  const airstrip = bot.blockAt(new Vec3(1852, 105, 2157));
  if (airstrip === null) throw new Error("Airstrip missing");
  const landed = waitForMessage(bot, /Offshore Runeforge/u, 15_000);
  await bot.activateBlock(airstrip);
  await landed;
}
