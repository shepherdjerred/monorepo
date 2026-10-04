import { randomUUID } from "node:crypto";
import { describe, expect } from "vitest";
import { Vec3 } from "vec3";
import type { RconClient } from "@shepherdjerred/the-storm-brain/rcon";
import type { Bot } from "mineflayer";
import { test } from "#e2e/fixtures.ts";
import { waitForMessage, waitUntil } from "#e2e/harness/bot.ts";

async function reconcile(rcon: RconClient): Promise<void> {
  const operation = randomUUID();
  expect(await rcon.command(`plot admin reconcile ${operation}`)).toContain(
    operation,
  );
  for (let attempt = 0; attempt < 100; attempt++) {
    const response = await rcon.command(`plot admin status ${operation}`);
    if (response.includes("FAILED")) throw new Error(response);
    if (response.includes("COMPLETE")) return;
    await Bun.sleep(100);
  }
  throw new Error(`Recovery ${operation} never completed`);
}

async function recoverMaterials(
  bot: Bot,
  rcon: RconClient,
  previousId: string,
): Promise<void> {
  await rcon.command("setblock 65 69 -183 chest");
  await rcon.command(
    'data merge block 65 69 -183 {Items:[{Slot:0b,id:"minecraft:diamond",count:3,components:{"minecraft:custom_name":"Recovery diamond"}}]}',
  );
  await rcon.command("setblock 66 69 -183 oak_planks");
  await rcon.command("setblock 65 69 -182 oak_wall_sign[facing=south]");
  const ready = waitForMessage(bot, /PLOT_FIXTURE READY/u);
  await rcon.command(`plotfixture materials ${bot.username}`);
  await ready;
  await reconcile(rcon);
  const listing = waitForMessage(
    bot,
    /Recovered shop: market-01.*[\da-f-]{36}/u,
  );
  bot.chat("/mail");
  const [message] = await listing;
  const id = /[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}/u.exec(message)?.[0];
  if (id === undefined || id === previousId)
    throw new Error(`New recovery missing: ${message}`);
  bot.chat(`/mail claim ${id} materials`);
  await waitUntil("native stock metadata delivered", () =>
    bot.inventory
      .items()
      .some(
        (item) =>
          item.name === "diamond" &&
          item.count === 3 &&
          JSON.stringify(item).includes("Recovery diamond"),
      ),
  );
  await waitUntil("wall sign returned as a sign item", () =>
    bot.inventory.items().some((item) => item.name === "oak_sign"),
  );
  expect(bot.inventory.items().some((item) => item.name === "oak_planks")).toBe(
    true,
  );
  expect(
    bot.inventory
      .items()
      .some(
        (item) =>
          item.name === "chest" &&
          !JSON.stringify(item).includes("Packed shop:"),
      ),
  ).toBe(true);
  const exclusive = waitForMessage(bot, /You already chose materials/u);
  bot.chat(`/mail claim ${id} packed`);
  await exclusive;
}

describe("protected shop recovery", () => {
  test("archives stock and decoration, resets the rental and unpacks one owner-bound shop", async ({
    bot,
    secondBot,
    rcon,
  }) => {
    await rcon.command("forceload add 64 -184 75 -173");
    await rcon.command("fill 64 68 -186 75 68 -173 stone");
    await rcon.command("fill 64 69 -184 75 96 -173 air");
    await rcon.command(`op ${bot.username}`);
    const baseline = waitForMessage(bot, /Recovery baseline saved/u);
    bot.chat("/plot admin baseline market-01");
    await baseline;
    await rcon.command(`deop ${bot.username}`);
    const active = waitForMessage(bot, /PLOT_FIXTURE READY/u);
    await rcon.command(`plotfixture active ${bot.username}`);
    await active;
    await rcon.command("setblock 65 69 -183 chest");
    await rcon.command(
      'data merge block 65 69 -183 {Items:[{Slot:0b,id:"minecraft:diamond",count:7}]}',
    );
    await rcon.command("setblock 66 69 -183 oak_planks");
    await rcon.command("setblock 66 69 -184 barrel");
    await rcon.command(
      `lp user ${bot.username} permission set thestorm.towns.bypass true`,
    );
    await rcon.command(
      `lp user ${bot.username} permission set thestorm.track.shopkeeper.1 true`,
    );
    await rcon.command(`tp ${bot.username} 65.5 69 -181.5`);
    await waitUntil(
      "source chunk received",
      () => bot.blockAt(new Vec3(65, 69, -183))?.name === "chest",
    );
    await bot.lookAt(new Vec3(65.5, 69.5, -182.5), true);
    await bot.waitForTicks(2);
    const locked = waitForMessage(bot, /Locked\. You can grant/u);
    bot.chat("/lock");
    await locked;
    await rcon.command(
      `lp user ${bot.username} permission unset thestorm.towns.bypass`,
    );
    await rcon.command(`tp ${bot.username} 65.5 69 -185.5`);
    await waitUntil(
      "owner leaves the shop volume",
      () => bot.entity.position.distanceTo(new Vec3(65.5, 69, -185.5)) < 0.3,
    );
    await rcon.command(
      'summon armor_stand 67.5 69 -182.5 {NoGravity:1b,CustomName:"Recovery decoration"}',
    );
    const ready = waitForMessage(bot, /PLOT_FIXTURE READY/u);
    await rcon.command(`plotfixture ${bot.username}`);
    await ready;
    await rcon.command(
      `lp user ${bot.username} permission set thestorm.towns.bypass true`,
    );
    await bot.lookAt(new Vec3(66.5, 69.5, -183.5), true);
    await bot.waitForTicks(2);
    expect(bot.blockAtCursor(5)?.name).toBe("barrel");
    const frozenLock = waitForMessage(bot, /This holding is frozen/u);
    bot.chat("/lock");
    await frozenLock;
    await rcon.command(
      `lp user ${bot.username} permission unset thestorm.towns.bypass`,
    );
    await reconcile(rcon);
    expect(await rcon.command("execute if block 65 69 -183 air")).toContain(
      "Test passed",
    );
    const listing = waitForMessage(
      bot,
      /Recovered shop: market-01.*[\da-f-]{36}/u,
    );
    bot.chat("/mail");
    const [message] = await listing;
    const id = /[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}/u.exec(message)?.[0];
    if (id === undefined) throw new Error(`Recovery id missing: ${message}`);
    bot.chat(`/mail claim ${id} packed`);
    await waitUntil("packed chest delivered", () =>
      bot.inventory
        .items()
        .some(
          (item) =>
            item.name === "chest" &&
            JSON.stringify(item).includes("Packed shop:"),
        ),
    );
    const exclusive = waitForMessage(bot, /You already chose packed/u);
    bot.chat(`/mail claim ${id} materials`);
    await exclusive;
    const token = bot.inventory
      .items()
      .find(
        (item) =>
          item.name === "chest" &&
          JSON.stringify(item).includes("Packed shop:"),
      );
    if (token === undefined) throw new Error("Packed chest missing");
    await bot.equip(token, "hand");
    await rcon.command("forceload add 296 296 315 315");
    await rcon.command("fill 296 119 296 315 119 315 stone");
    await rcon.command("fill 300 120 300 311 147 311 air");
    await rcon.command(`tp ${bot.username} 300.5 120 298.5`);
    await waitUntil(
      "placement arrival",
      () => bot.entity.position.distanceTo(new Vec3(300.5, 120, 298.5)) < 0.3,
    );
    await waitUntil(
      "destination chunk received",
      () => bot.blockAt(new Vec3(300, 119, 300))?.name === "stone",
    );
    const anchor = bot.blockAt(new Vec3(300, 119, 300));
    if (anchor === null) throw new Error("Destination anchor missing");
    const preview = waitForMessage(bot, /Preview ready/u);
    await bot.activateBlock(anchor, new Vec3(0, 1, 0));
    await preview;
    const placed = waitForMessage(bot, /Your shop has been unpacked/u);
    bot.chat("/plot confirm");
    await placed;
    const stock = await rcon.command("data get block 301 120 301 Items");
    expect(stock).toContain("minecraft:diamond");
    expect(stock).toContain("7");
    expect(
      await rcon.command("execute if block 302 120 301 oak_planks"),
    ).toContain("Test passed");
    expect(
      await rcon.command(
        "execute if entity @e[type=armor_stand,x=303,y=120,z=302,distance=..2]",
      ),
    ).toContain("Test passed");
    expect(await rcon.command(`plotfixture check ${bot.username}`)).toContain(
      "PLOT_FIXTURE CHECKED",
    );
    await rcon.command(`tp ${secondBot.username} 301.5 120 304.5`);
    await waitUntil(
      "customer sees recovered shop",
      () =>
        secondBot.blockAt(new Vec3(301, 120, 302))?.name === "oak_wall_sign",
    );
    const sign = secondBot.blockAt(new Vec3(301, 120, 302));
    if (sign === null) throw new Error("Restored shop sign missing");
    await secondBot.activateBlock(sign);
    await waitUntil("recovered shop trades its original stock", () =>
      secondBot.inventory
        .items()
        .some((item) => item.name === "diamond" && item.count === 2),
    );
    const rejected = waitForMessage(bot, /already used|archive is retained/u);
    await bot.activateBlock(anchor, new Vec3(0, 1, 0));
    await rejected;
    await recoverMaterials(bot, rcon, id);
  });
});
