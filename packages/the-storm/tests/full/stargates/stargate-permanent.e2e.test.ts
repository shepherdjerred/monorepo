import { once } from "node:events";
import { Vec3 } from "vec3";
import { expect } from "vitest";
import { test } from "#e2e/fixtures.ts";
import { waitForMessage, waitUntil } from "#e2e/harness/bot.ts";
import type { RconClient } from "#e2e/harness/rcon.ts";

async function buildFrame(rcon: RconClient, x: number) {
  const origin = String(x),
    bottom = String(x - 1),
    left = String(x === 400 ? x - 2 : x - 3),
    right = String(x === 400 ? x + 1 : x + 3);
  if (x === 400) {
    await rcon.command(`fill ${bottom} 71 0 ${origin} 73 0 minecraft:air`);
    await rcon.command(`fill ${bottom} 70 1 ${origin} 70 3 minecraft:stone`);
    await rcon.command(`fill ${bottom} 70 0 ${origin} 70 0 minecraft:obsidian`);
    await rcon.command(`fill ${bottom} 74 0 ${origin} 74 0 minecraft:obsidian`);
    await rcon.command(`fill ${left} 71 0 ${left} 73 0 minecraft:obsidian`);
    await rcon.command(`fill ${right} 71 0 ${right} 73 0 minecraft:obsidian`);
  } else {
    await rcon.command("fill 407 70 0 413 76 0 minecraft:air");
    await rcon.command("fill 409 70 1 411 70 3 minecraft:stone");
    await rcon.command("fill 409 70 0 411 70 0 minecraft:obsidian");
    await rcon.command("fill 409 76 0 411 76 0 minecraft:obsidian");
    for (const y of ["71", "75"]) {
      await rcon.command(`setblock 408 ${y} 0 minecraft:obsidian`);
      await rcon.command(`setblock 412 ${y} 0 minecraft:obsidian`);
    }
    await rcon.command("fill 407 72 0 407 74 0 minecraft:obsidian");
    await rcon.command("fill 413 72 0 413 74 0 minecraft:obsidian");
  }
  return { left, right };
}

test("sign-created fixed gate opens automatically and closes when its destination is broken", async ({
  bot,
  rcon,
}) => {
  const granted = waitForMessage(bot, /admin set your Mechanic to III/iu);
  await rcon.command(`perks admin set ${bot.username} mechanic 3`);
  await granted;
  await rcon.command("minecraft:forceload add 384 -16 416 0");
  await rcon.command("fill 395 69 0 415 69 5 minecraft:stone");
  for (const x of [400, 410]) {
    const { left, right } = await buildFrame(rcon, x);
    await rcon.command(
      `setblock ${left} 72 1 minecraft:stone_button[face=wall,facing=south]`,
    );
    await rcon.command(
      `setblock ${right} 72 1 minecraft:birch_wall_sign[facing=south]`,
    );
    await rcon.command(`tp ${bot.username} ${right}.5 71 3.5`);
    const signPos = new Vec3(x === 400 ? x + 1 : x + 3, 72, 1);
    await waitUntil(
      "gate sign loaded",
      () => bot.blockAt(signPos)?.name === "birch_wall_sign",
    );
    const sign = bot.blockAt(signPos);
    if (sign === null) throw new Error("Gate sign missing");
    const editor = once(bot._client, "open_sign_entity", {
      signal: AbortSignal.timeout(5000),
    });
    await bot.activateBlock(sign);
    await editor;
    const name = x === 400 ? "First" : "Second";
    if (x === 400) {
      const invalid = waitForMessage(bot, /Leave line four blank or use A/u);
      bot.updateSign(sign, "First\nSecond\n\nB");
      await invalid;
      const retry = once(bot._client, "open_sign_entity", {
        signal: AbortSignal.timeout(5000),
      });
      await bot.activateBlock(sign);
      await retry;
    }
    const saved = waitForMessage(
      bot,
      new RegExp(`Stargate ${name} created`, "u"),
    );
    bot.updateSign(sign, x === 400 ? "First\nSecond\n\nA" : "Second\n\n\n");
    await saved;
  }
  await waitUntil("permanent portal opens", async () => {
    const result = await rcon.command(
      "execute if block 400 71 0 minecraft:nether_portal",
    );
    return result.includes("Test passed");
  });
  await rcon.command(`tp ${bot.username} 400.5 71 2.5`);
  await rcon.command(
    'summon minecraft:oak_boat 400.5 71 2.5 {Tags:["storm_test_boat"]}',
  );
  await rcon.command(
    `ride ${bot.username} mount @e[tag=storm_test_boat,limit=1]`,
  );
  await waitUntil("player mounts boat", async () => {
    const result = await rcon.command(
      `execute as ${bot.username} on vehicle if entity @s[tag=storm_test_boat]`,
    );
    return result.includes("Test passed");
  });
  let boatZ = 2.5;
  await waitUntil(
    "boat and rider arrive at destination",
    async () => {
      const arrived = await rcon.command(
        `execute as ${bot.username} on vehicle if entity @s[tag=storm_test_boat,x=410,y=71,z=2,distance=..4]`,
      );
      if (arrived.includes("Test passed")) return true;
      boatZ = Math.max(0.5, boatZ - 0.2);
      bot._client.write("vehicle_move", {
        x: 400.5,
        y: 71,
        z: boatZ,
        yaw: 180,
        pitch: 0,
        onGround: true,
      });
      return false;
    },
    20_000,
  );
  await rcon.command(`ride ${bot.username} dismount`);
  await rcon.command(`tp ${bot.username} 413.5 71 3.5`);
  await waitUntil(
    "player reaches destination sign",
    () => Math.abs(bot.entity.position.x - 413.5) < 0.3,
  );
  const sign = bot.blockAt(new Vec3(413, 72, 1));
  if (sign === null) throw new Error("Destination sign missing");
  await bot.dig(sign);
  await waitUntil("destination sign broken", async () => {
    const result = await rcon.command(
      "execute if block 413 72 1 minecraft:air",
    );
    return result.includes("Test passed");
  });
  await waitUntil("permanent portal closes", async () => {
    const result = await rcon.command(
      "execute if block 400 71 0 minecraft:air",
    );
    return result.includes("Test passed");
  });
  expect(
    await rcon.command("execute if block 400 70 0 minecraft:obsidian"),
  ).toContain("Test passed");
  await rcon.command(`tp ${bot.username} 401.5 71 3.5`);
  await waitUntil(
    "player reaches source sign",
    () => Math.abs(bot.entity.position.x - 401.5) < 0.3,
  );
  const sourceSign = bot.blockAt(new Vec3(401, 72, 1));
  if (sourceSign === null) throw new Error("Source sign missing");
  await bot.dig(sourceSign);
  await waitUntil("source sign broken", async () => {
    const result = await rcon.command(
      "execute if block 401 72 1 minecraft:air",
    );
    return result.includes("Test passed");
  });
});
