import type { Bot } from "mineflayer";
import type { Vec3 } from "vec3";
import { waitForMessage, waitUntil } from "#e2e/harness/bot.ts";
import { serverLogs } from "#e2e/harness/external/files.ts";
import type { RconClient } from "#e2e/harness/rcon.ts";
import type { ServerInfo } from "#e2e/harness/server.ts";

export async function shopMessages(bot: Bot, server: ServerInfo) {
  const messages: string[] = [];
  bot.on("messagestr", (message) => {
    messages.push(message);
  });
  await waitUntil(
    "shop registry ready",
    async () => /Indexed \d+ world shops/.test(await serverLogs(server)),
    60_000,
  );
  return messages;
}

export async function waitForShopCommand(bot: Bot) {
  await waitUntil(
    "shop registry ready",
    async () => {
      const reply = waitForMessage(bot, /You own|Shops are still loading/);
      bot.chat("/shop");
      const match = await reply;
      return match.includes("You own");
    },
    30_000,
  );
}

export async function waitForHistoricalShop(
  rcon: RconClient,
  x: number,
  y: number,
  z: number,
) {
  await waitUntil(
    "historical sign registered",
    async () => {
      const identity = await rcon.command(
        `data get block ${x.toString()} ${y.toString()} ${z.toString()} PublicBukkitValues."thestorm:shop_id"`,
      );
      return /data: [1-9]\d*L\b/u.test(identity);
    },
    30_000,
  );
}

export async function visitIronListing(bot: Bot, rcon: RconClient) {
  await rcon.command(`op ${bot.username}`);
  await waitForShopCommand(bot);
  await rcon.command("forceload add 138 -97");
  await rcon.command(`minecraft:tp ${bot.username} 138.5 69 -94.5`);
  await waitUntil(
    "player at shop",
    () => Math.abs(bot.entity.position.x - 138.5) < 2,
  );
}

export async function closeRestorationChest(
  bot: Bot,
  position: Vec3,
  beforeClose?: () => Promise<unknown>,
) {
  await waitUntil(
    "shop chest loaded",
    () => bot.blockAt(position)?.name === "chest",
  );
  const chest = bot.blockAt(position);
  if (chest === null) throw new Error("Missing fixture chest");
  const opened = new Promise<void>((resolve) =>
    bot.once("windowOpen", () => {
      resolve();
    }),
  );
  await bot.activateBlock(chest);
  await opened;
  await beforeClose?.();
  if (bot.currentWindow === null) throw new Error("Chest did not open");
  await bot.closeWindow(bot.currentWindow);
}
