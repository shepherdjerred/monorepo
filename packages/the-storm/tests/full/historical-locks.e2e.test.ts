import { expect } from "vitest";
import { Vec3 } from "vec3";
import type { Bot } from "mineflayer";
import { test } from "#e2e/fixtures.ts";
import {
  connectBot,
  disconnectBot,
  waitForMessage,
  waitUntil,
} from "#e2e/harness/bot.ts";
import type { RconClient } from "#e2e/harness/rcon.ts";

async function target(bot: Bot, rcon: RconClient, x: number): Promise<void> {
  await rcon.command(`minecraft:tp ${bot.username} ${x.toString()}.5 201 32.5`);
  await waitUntil(
    "historical chest in reach",
    () =>
      bot.entity.position.distanceTo(new Vec3(x + 0.5, 201, 32.5)) < 0.3 &&
      bot.blockAt(new Vec3(x, 201, 35))?.name === "chest",
  );
  await bot.lookAt(new Vec3(x + 0.5, 201.5, 35.5), true);
  await bot.waitForTicks(2);
}

async function open(bot: Bot, x: number): Promise<void> {
  const block = bot.blockAt(new Vec3(x, 201, 35));
  if (block === null) throw new Error("Historical chest missing");
  const chest = await bot.openContainer(block);
  expect(chest.slots.length).toBeGreaterThan(54);
  await chest.close();
}

test("imported double chests load, grant both owners management, block outsiders and protect hopper stock without using the quota", async ({
  server,
  bot: outsider,
  rcon,
}) => {
  const alpha = await connectBot({
    host: server.host,
    port: server.gamePort,
    username: "historyalpha",
  });
  const beta = await connectBot({
    host: server.host,
    port: server.gamePort,
    username: "historybeta",
  });
  try {
    for (const [owner, x] of [
      [alpha, 340],
      [beta, 341],
    ] as const) {
      await target(owner, rcon, x);
      await open(owner, x);
      const info = waitForMessage(
        owner,
        /Locked by historyalpha, historybeta \(both halves\)/u,
      );
      owner.chat("/lock info");
      await info;
    }
    await target(outsider, rcon, 340);
    const denied = waitForMessage(outsider, /locked/u);
    const block = outsider.blockAt(new Vec3(340, 201, 35));
    if (block === null) throw new Error("Historical chest missing");
    await outsider.activateBlock(block);
    await denied;
    expect(outsider.currentWindow).toBeNull();

    // A co-owner manages sharing, rather than merely having trusted container access.
    await target(beta, rcon, 341);
    const trusted = waitForMessage(beta, /can now open it/u);
    beta.chat(`/lock trust ${outsider.username}`);
    await trusted;
    await open(outsider, 340);
    const untrusted = waitForMessage(beta, /can no longer open it/u);
    beta.chat(`/lock untrust ${outsider.username}`);
    await untrusted;

    await rcon.command("setblock 340 200 35 minecraft:hopper[enabled=true]");
    let stock = "";
    for (let attempt = 0; attempt < 40; attempt++) {
      stock = await rcon.command("data get block 340 200 35 Items");
      if (stock.includes("minecraft:diamond")) break;
      await Bun.sleep(100);
    }
    expect(stock).toContain("minecraft:diamond");
    expect(await rcon.command("data get block 340 199 35 Items")).toContain(
      "[]",
    );

    // Seventy imported locks exceed the ordinary limit of 64, but do not spend that quota.
    await target(alpha, rcon, 344);
    const locked = waitForMessage(alpha, /Locked\. You can grant/u);
    alpha.chat("/lock");
    await locked;
    await target(beta, rcon, 341);
    const unlocked = waitForMessage(beta, /Unlocked\. Anyone can open/u);
    beta.chat("/unlock");
    await unlocked;
    await open(outsider, 340);
  } finally {
    await disconnectBot(beta);
    await disconnectBot(alpha);
  }
}, 60_000);
