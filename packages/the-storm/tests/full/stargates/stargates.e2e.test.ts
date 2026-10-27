import { once } from "node:events";
import { Vec3 } from "vec3";
import { expect } from "vitest";
import { test } from "#e2e/fixtures.ts";
import { waitForMessage, waitUntil } from "#e2e/harness/bot.ts";

test("a private Stargate network admits its invited players and denies others", async ({
  bot,
  secondBot,
  rcon,
}) => {
  const messages: string[] = [];
  bot.on("messagestr", (message) => {
    messages.push(message);
  });
  const help = waitForMessage(
    bot,
    /Sign: gate name on line 1, network name on line 3/u,
  );
  bot.chat("/stargate");
  await help;
  const granted = waitForMessage(bot, /admin set your Mechanic to III/iu);
  await rcon.command(`perks admin set ${bot.username} mechanic 3`);
  await granted;
  const created = waitForMessage(bot, /Created network Testgate/iu);
  bot.chat("/stargate network create private Testgate");
  await created;

  await rcon.command("minecraft:forceload add 384 -16 416 0");
  await rcon.command("fill 395 69 0 415 69 5 minecraft:stone");
  expect(
    await rcon.command("execute if block 401 69 3 minecraft:stone"),
  ).toContain("Test passed");
  for (const x of [400, 410]) {
    const left = String(x - 2),
      right = String(x + 1);
    const bottom = String(x - 1),
      origin = String(x);
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
      `setblock ${right} 72 1 minecraft:oak_wall_sign[facing=south]`,
    );
    await rcon.command(`tp ${bot.username} ${right}.5 71 3.5`);
    const signPos = new Vec3(x + 1, 72, 1);
    await waitUntil(
      "Stargate sign loaded",
      () => bot.blockAt(signPos)?.name === "oak_wall_sign",
    );
    const sign = bot.blockAt(signPos);
    if (sign === null) throw new Error("Stargate sign is missing");
    const editor = once(bot._client, "open_sign_entity", {
      signal: AbortSignal.timeout(5000),
    });
    await bot.activateBlock(sign);
    await editor;
    const named = x === 400 ? "First" : "Second";
    const saved = waitForMessage(
      bot,
      new RegExp(`Stargate ${named} created`, "u"),
    );
    bot.updateSign(sign, `${named}\n\nTestgate\n`);
    try {
      await saved;
    } catch (error) {
      throw new Error(
        `Gate registration failed; messages: ${messages.join(" | ")}`,
        { cause: error },
      );
    }
  }
  await rcon.command(`tp ${secondBot.username} 401.5 71 3.5`);
  await waitUntil(
    "visitor reaches Stargate",
    () => Math.abs(secondBot.entity.position.x - 401.5) < 0.3,
  );
  await waitUntil(
    "visitor sees Stargate sign",
    () => secondBot.blockAt(new Vec3(401, 72, 1))?.name === "oak_wall_sign",
  );
  const visitorSign = secondBot.blockAt(new Vec3(401, 72, 1));
  if (visitorSign === null) throw new Error("Visitor cannot see the gate sign");
  const denied = waitForMessage(secondBot, /You cannot use this Stargate/u);
  await secondBot.activateBlock(visitorSign);
  await denied;
  const invited = waitForMessage(
    bot,
    new RegExp(`Invited ${secondBot.username}`, "u"),
  );
  bot.chat(`/stargate network invite Testgate ${secondBot.username}`);
  await invited;
  const allowed = waitForMessage(secondBot, /Destination: Second/u);
  await secondBot.activateBlock(visitorSign);
  await allowed;
  await rcon.command(`tp ${bot.username} 401.5 71 3.5`);
  await waitUntil(
    "owner reaches Stargate",
    () => Math.abs(bot.entity.position.x - 401.5) < 0.3,
  );
  const firstSign = bot.blockAt(new Vec3(401, 72, 1));
  if (firstSign === null) throw new Error("First gate sign is missing");
  const selected = waitForMessage(bot, /Second/iu);
  await bot.activateBlock(firstSign);
  await selected;
  const button = bot.blockAt(new Vec3(398, 72, 1));
  if (button === null) throw new Error("First gate button is missing");
  await rcon.command(`tp ${bot.username} 399.5 71 2.5`);
  await waitUntil(
    "owner reaches button",
    () => Math.abs(bot.entity.position.x - 399.5) < 0.3,
  );
  await bot.activateBlock(button);
  await waitUntil(
    "portal opens",
    () => bot.blockAt(new Vec3(400, 71, 0))?.name === "nether_portal",
  );
  const removed = waitForMessage(
    bot,
    new RegExp(`Removed ${secondBot.username}`, "u"),
  );
  bot.chat(`/stargate network uninvite Testgate ${secondBot.username}`);
  await removed;
  const deniedAgain = waitForMessage(
    secondBot,
    /You cannot use this Stargate/u,
  );
  await secondBot.activateBlock(visitorSign);
  await deniedAgain;
  await rcon.command(`tp ${secondBot.username} 400.5 71 2.5`);
  await waitUntil(
    "revoked visitor reaches portal",
    () =>
      Math.abs(secondBot.entity.position.x - 400.5) < 0.3 &&
      secondBot.entity.position.z < 3,
  );
  const rejected = waitForMessage(
    secondBot,
    /Stargate destination is unavailable/u,
  );
  await secondBot.lookAt(new Vec3(400.5, 71, 0.5));
  secondBot.setControlState("forward", true);
  try {
    await waitUntil(
      "revoked visitor enters portal",
      () => secondBot.entity.position.z < 1,
    );
  } finally {
    secondBot.setControlState("forward", false);
  }
  await rejected;
  expect(secondBot.entity.position.x).toBeLessThan(405);
  await rcon.command(`tp ${secondBot.username} 401.5 71 3.5`);
  await rcon.command(`tp ${bot.username} 400.5 71 2.5`);
  await waitUntil(
    "gate approach",
    () =>
      Math.abs(bot.entity.position.x - 400.5) < 0.3 &&
      bot.entity.position.z > 2,
  );
  await bot.lookAt(new Vec3(400.5, 71, 0.5));
  bot.setControlState("forward", true);
  try {
    await waitUntil("enter portal", () => bot.entity.position.z < 1);
  } finally {
    bot.setControlState("forward", false);
  }
  try {
    await waitUntil(
      "Stargate arrival",
      () => bot.entity.position.x > 405,
      15_000,
    );
  } catch (error) {
    throw new Error(`Gate travel failed; messages: ${messages.join(" | ")}`, {
      cause: error,
    });
  }
});
