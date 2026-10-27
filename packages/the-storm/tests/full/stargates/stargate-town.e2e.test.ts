import { once } from "node:events";
import { Vec3 } from "vec3";
import { test } from "#e2e/fixtures.ts";
import { waitForMessage, waitUntil } from "#e2e/harness/bot.ts";

test("town Stargate access follows joining and leaving the town", async ({
  bot,
  secondBot,
  rcon,
}) => {
  const visitorMessages: string[] = [];
  secondBot.on("messagestr", (message) => {
    visitorMessages.push(message);
  });
  const mechanic = waitForMessage(bot, /admin set your Mechanic to III/iu);
  await rcon.command(`perks admin set ${bot.username} mechanic 3`);
  await mechanic;
  const governor = waitForMessage(bot, /admin set your Governor to I/iu);
  await rcon.command(`perks admin set ${bot.username} governor 1`);
  await governor;
  const founded = waitForMessage(bot, /Founded Gatehaven/u);
  bot.chat("/town create Gatehaven");
  await founded;
  const created = waitForMessage(bot, /Created network TownGate/u);
  bot.chat("/stargate network create town TownGate");
  await created;

  await rcon.command("minecraft:forceload add 448 -16 464 0");
  await rcon.command("fill 445 69 0 455 69 5 minecraft:stone");
  await rcon.command("fill 449 71 0 450 73 0 minecraft:air");
  await rcon.command("fill 449 70 1 450 70 3 minecraft:stone");
  await rcon.command("fill 449 70 0 450 70 0 minecraft:obsidian");
  await rcon.command("fill 449 74 0 450 74 0 minecraft:obsidian");
  await rcon.command("fill 448 71 0 448 73 0 minecraft:obsidian");
  await rcon.command("fill 451 71 0 451 73 0 minecraft:obsidian");
  await rcon.command(
    "setblock 448 72 1 minecraft:stone_button[face=wall,facing=south]",
  );
  await rcon.command("setblock 451 72 1 minecraft:oak_wall_sign[facing=south]");
  await rcon.command(`tp ${bot.username} 451.5 71 3.5`);
  const signPos = new Vec3(451, 72, 1);
  await waitUntil(
    "town Stargate sign loaded",
    () => bot.blockAt(signPos)?.name === "oak_wall_sign",
  );
  const sign = bot.blockAt(signPos);
  if (sign === null) throw new Error("Town Stargate sign is missing");
  const editor = once(bot._client, "open_sign_entity", {
    signal: AbortSignal.timeout(5000),
  });
  await bot.activateBlock(sign);
  await editor;
  const saved = waitForMessage(bot, /Stargate TownDoor created/u);
  bot.updateSign(sign, "TownDoor\n\nTownGate\n");
  await saved;

  await rcon.command(`tp ${secondBot.username} 451.5 71 3.5`);
  await waitUntil(
    "visitor reaches town Stargate",
    () => Math.abs(secondBot.entity.position.x - 451.5) < 0.3,
  );
  await waitUntil(
    "visitor sees town Stargate",
    () => secondBot.blockAt(signPos)?.name === "oak_wall_sign",
  );
  const visitorSign = secondBot.blockAt(signPos);
  if (visitorSign === null)
    throw new Error("Visitor cannot see the town Stargate");
  const denied = waitForMessage(secondBot, /You cannot use this Stargate/u);
  await secondBot.activateBlock(visitorSign);
  try {
    await denied;
  } catch (error) {
    throw new Error(
      `Initial town gate access check failed; visitor messages: ${visitorMessages.join(" | ")}`,
      { cause: error },
    );
  }
  const invited = waitForMessage(secondBot, /invited you to Gatehaven/u);
  bot.chat(`/town invite ${secondBot.username}`);
  await invited;
  const joined = waitForMessage(secondBot, /You joined Gatehaven/u);
  secondBot.chat("/town accept Gatehaven");
  await joined;
  const allowed = waitForMessage(
    secondBot,
    /There are no other Stargates on this network yet/u,
  );
  await secondBot.activateBlock(visitorSign);
  await allowed;
  const left = waitForMessage(secondBot, /You left Gatehaven/u);
  secondBot.chat("/town leave");
  await left;
  const deniedAfterLeaving = waitForMessage(
    secondBot,
    /You cannot use this Stargate/u,
  );
  await secondBot.activateBlock(visitorSign);
  try {
    await deniedAfterLeaving;
  } catch (error) {
    throw new Error(
      `Town gate access after leaving failed; visitor messages: ${visitorMessages.join(" | ")}`,
      { cause: error },
    );
  }
});
