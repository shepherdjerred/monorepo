import { expect } from "vitest";
import { Vec3 } from "vec3";
import { once } from "node:events";
import { test } from "./fixtures.ts";
import { collectMessages, waitForMessage, waitUntil } from "./harness/bot.ts";
import { waitForDecision } from "./harness/decisions.ts";

// 26.1 creative packets use length-delimited component bytes (UntrustedSlot),
// unlike the decoded Slot components returned by Mineflayer's inventory API.
function creativePaper(itemId: number, name: string) {
  const text = Buffer.from(name, "utf8");
  const nbt = Buffer.alloc(3 + text.length);
  nbt.writeUInt8(8, 0);
  nbt.writeUInt16BE(text.length, 1);
  text.copy(nbt, 3);
  return {
    itemCount: 1,
    itemId,
    addedComponentCount: 1,
    removedComponentCount: 0,
    components: [{ type: "custom_name", data: nbt }],
    removeComponents: [],
  };
}

test("anvil names are held while typing and preserve the native XP charge", async ({
  bot,
  rcon,
}) => {
  await rcon.command(`op ${bot.username}`);
  await rcon.command(`tp ${bot.username} 640 -60 640`);
  await waitUntil(
    "anvil teleport acknowledged",
    () =>
      Math.abs(bot.entity.position.x - 640.5) < 2 &&
      Math.abs(bot.entity.position.z - 640.5) < 2,
  );
  await waitUntil(
    "anvil chunk received",
    () => bot.blockAt(new Vec3(641, -60, 640)) !== null,
  );
  await rcon.command("setblock 641 -60 640 anvil");
  await rcon.command(`clear ${bot.username} iron_sword`);
  await waitUntil(
    "isolated anvil inventory",
    () => !bot.inventory.items().some((item) => item.name === "iron_sword"),
  );
  await rcon.command(`give ${bot.username} iron_sword`);
  await rcon.command(`experience set ${bot.username} 5 levels`);
  await waitUntil(
    "anvil loaded",
    () => bot.blockAt(new Vec3(641, -60, 640))?.name === "anvil",
  );
  const block = bot.blockAt(new Vec3(641, -60, 640));
  if (block === null) throw new Error("Anvil missing");
  await bot.openAnvil(block);
  const anvil = bot.currentWindow;
  if (anvil === null) throw new Error("Anvil window missing");
  try {
    const source = anvil.slots.find(
      (item, index) =>
        index >= anvil.inventoryStart && item?.name === "iron_sword",
    );
    if (source === undefined || source === null)
      throw new Error("Anvil source sword missing");
    await bot.clickWindow(source.slot, 0, 0);
    await bot.clickWindow(0, 0, 0);
    const rejected = waitForMessage(bot, /not published \(threat\)/);
    bot._client.write("name_item", { name: "[fixture-threat]" });
    await rejected;
    expect(anvil.slots[2]).toBeNull();
    const before = bot.experience.level;
    for (const name of ["H", "He", "Hello sword"])
      bot._client.write("name_item", { name });
    await waitUntil("approved anvil result", () =>
      (JSON.stringify(anvil.slots[2]) ?? "").includes("Hello sword"),
    );
    await bot.putAway(2);
    await waitUntil(
      "native anvil XP charge",
      () => bot.experience.level === before - 1,
    );
    expect(anvil.slots[0]).toBeNull();
  } finally {
    await bot.closeWindow(anvil);
  }
  expect(
    bot.inventory.items().filter((item) => item.name === "iron_sword"),
  ).toHaveLength(1);
});

test("creative item metadata is withheld and requires a native retry after approval", async ({
  bot,
  rcon,
}) => {
  await rcon.command(`gamemode creative ${bot.username}`);
  await waitUntil(
    "creative mode acknowledged",
    () => bot.game.gameMode === "creative",
  );
  await bot.waitForTicks(10);
  await rcon.command(
    `item replace entity ${bot.username} hotbar.0 with paper[custom_name='"[fixture-threat]"']`,
  );
  await waitUntil(
    "named creative source item",
    () => bot.inventory.slots[36]?.name === "paper",
  );
  const source = bot.inventory.slots[36];
  if (source === null || source === undefined)
    throw new Error("Source paper missing");
  const rejected = waitForMessage(bot, /not published \(threat\)/);
  bot._client.write("set_creative_slot", {
    slot: 37,
    item: creativePaper(source.type, "[fixture-threat]"),
  });
  await rejected;
  expect(
    await rcon.command(
      `data get entity ${bot.username} Inventory[{Slot:1b}].components."minecraft:custom_name"`,
    ),
  ).not.toContain("fixture-threat");
  await rcon.command(
    `item replace entity ${bot.username} hotbar.0 with paper[custom_name='"A friendly item"']`,
  );
  await waitUntil("ordinary creative source item", () =>
    (JSON.stringify(bot.inventory.slots[36]) ?? "").includes("A friendly item"),
  );
  const approved = waitForMessage(bot, /Item content approved/);
  bot._client.write("set_creative_slot", {
    slot: 38,
    item: creativePaper(source.type, "A friendly item"),
  });
  await approved;
  expect(
    await rcon.command(
      `data get entity ${bot.username} Inventory[{Slot:2b}].components."minecraft:custom_name"`,
    ),
  ).not.toContain("A friendly item");
  bot._client.write("set_creative_slot", {
    slot: 38,
    item: creativePaper(source.type, "A friendly item"),
  });
  await expect
    .poll(() =>
      rcon.command(
        `data get entity ${bot.username} Inventory[{Slot:2b}].components."minecraft:custom_name"`,
      ),
    )
    .toContain("A friendly item");
  expect(
    await rcon.command(
      `data get entity ${bot.username} Inventory[{Slot:2b}].components."minecraft:custom_name"`,
    ),
  ).toContain("A friendly item");
});

test("name tags cannot publish a rejected entity name", async ({
  bot,
  rcon,
}) => {
  bot.physicsEnabled = false;
  await rcon.command(`tp ${bot.username} 620 -60 620`);
  await waitUntil(
    "cow teleport acknowledged",
    () =>
      Math.abs(bot.entity.position.x - 620.5) < 2 &&
      Math.abs(bot.entity.position.z - 620.5) < 2,
  );
  await waitUntil(
    "cow chunk received",
    () => bot.blockAt(new Vec3(622, -61, 620)) !== null,
  );
  await bot.waitForChunksToLoad();
  bot.physicsEnabled = true;
  await rcon.command(
    'summon cow 622 -60 620 {NoAI:1b,Tags:["safety_name_tag"]}',
  );
  try {
    await waitUntil("cow loaded", () =>
      Object.values(bot.entities).some(
        (entity) =>
          entity.name === "cow" &&
          entity.position.distanceTo(bot.entity.position) < 6,
      ),
    );
    const cow = Object.values(bot.entities).find(
      (entity) =>
        entity.name === "cow" &&
        entity.position.distanceTo(bot.entity.position) < 6,
    );
    if (cow === undefined) throw new Error("Cow missing");
    await rcon.command(
      `item replace entity ${bot.username} hotbar.0 with name_tag[custom_name='"[fixture-threat]"']`,
    );
    await waitUntil(
      "forbidden name tag",
      () => bot.inventory.slots[36]?.name === "name_tag",
    );
    await bot.setQuickBarSlot(0);
    const rejected = waitForMessage(bot, /not published \(threat\)/);
    await bot.activateEntity(cow);
    await rejected;
    expect(
      await rcon.command(
        "data get entity @e[tag=safety_name_tag,limit=1] CustomName",
      ),
    ).not.toContain("fixture-threat");
    await rcon.command(
      `item replace entity ${bot.username} hotbar.0 with name_tag[custom_name='"Friendly cow"']`,
    );
    await waitUntil("friendly name tag", () =>
      (JSON.stringify(bot.inventory.slots[36]) ?? "").includes("Friendly cow"),
    );
    const approved = waitForMessage(bot, /Name approved/);
    await bot.activateEntity(cow);
    await approved;
    expect(
      await rcon.command(
        "data get entity @e[tag=safety_name_tag,limit=1] CustomName",
      ),
    ).toContain("Friendly cow");
    expect(
      await rcon.command(`data get entity ${bot.username} SelectedItem`),
    ).not.toContain("name_tag");
  } finally {
    await rcon.command("kill @e[tag=safety_name_tag]");
  }
});

test("friendly invitations and occasional 2000-character command messages reach their audience", async ({
  bot,
  secondBot,
}) => {
  const invitation = waitForMessage(secondBot, /link you asked for/);
  bot.chat(
    `/msg ${secondBot.username} Here is the link you asked for: https://example.com`,
  );
  await invitation;
  const body = "normal long message ".repeat(110).slice(0, 1999) + "x";
  const responses: string[] = [];
  const capture = (message: string) => {
    responses.push(message);
  };
  bot.on("messagestr", capture);
  const received = waitForMessage(
    secondBot,
    new RegExp(`.*${body.slice(-80)}.*`),
  );
  bot.chat(`/g ${body}`);
  try {
    const delivered = await received;
    expect(delivered[0]).toContain(body);
  } catch (error) {
    throw new Error(
      `Long command failed; sender saw ${JSON.stringify(responses)}`,
      { cause: error },
    );
  } finally {
    bot.off("messagestr", capture);
  }
});

test("plain threats in native chat and private commands are withheld without a model-only mute", async ({
  bot,
  secondBot,
  rcon,
}) => {
  await rcon.command(`op ${bot.username}`);
  const observed = collectMessages(secondBot, 2500);
  const native = waitForMessage(bot, /not published \(threat\)/);
  bot.chat("[fixture-threat] native text");
  await native;
  const direct = waitForMessage(bot, /not published \(threat\)/);
  bot.chat(`/msg ${secondBot.username} [fixture-threat] direct text`);
  await direct;
  const observations = await observed;
  expect(observations.some((line) => line.includes("[fixture-threat]"))).toBe(
    false,
  );
  const ordinary = waitForMessage(secondBot, /ordinary speech still works/);
  bot.chat("ordinary speech still works");
  await ordinary;
  await waitForDecision(bot, /harassment escalate .*safety-block evidence/);
});

test("sign edits are checked before publication", async ({ bot, rcon }) => {
  await rcon.command(`op ${bot.username}`);
  await rcon.command(`tp ${bot.username} 604 -60 604`);
  await waitUntil(
    "sign teleport acknowledged",
    () =>
      Math.abs(bot.entity.position.x - 604.5) < 2 &&
      Math.abs(bot.entity.position.z - 604.5) < 2,
  );
  const position = new Vec3(605, -60, 604);
  await rcon.command("setblock 605 -61 604 stone");
  await rcon.command("setblock 605 -60 604 oak_sign[rotation=4]");
  await waitUntil(
    "sign loaded",
    () => bot.blockAt(position)?.name === "oak_sign",
  );
  const sign = bot.blockAt(position);
  if (sign === null) throw new Error("Sign missing");
  const firstEditor = once(bot._client, "open_sign_entity", {
    signal: AbortSignal.timeout(5000),
  });
  await bot.activateBlock(sign);
  await firstEditor;
  const rejected = waitForMessage(bot, /not published \(threat\)/);
  bot.updateSign(sign, "[fixture-threat]");
  await rejected;
  expect(
    await rcon.command("data get block 605 -60 604 front_text"),
  ).not.toContain("fixture-threat");
  const secondEditor = once(bot._client, "open_sign_entity", {
    signal: AbortSignal.timeout(5000),
  });
  await bot.activateBlock(sign);
  await secondEditor;
  bot.updateSign(sign, "Hello from the sign");
  const barrier = waitForMessage(bot, /sign edit barrier/);
  bot.chat("sign edit barrier");
  await barrier;
  expect(await rcon.command("data get block 605 -60 604 front_text")).toContain(
    "Hello from the sign",
  );
});

test("book pages are retained on rejection and applied only after approval", async ({
  bot,
  rcon,
}) => {
  await rcon.command(`op ${bot.username}`);
  await rcon.command(`give ${bot.username} writable_book`);
  await waitUntil("writable book", () =>
    bot.inventory.items().some((item) => item.name === "writable_book"),
  );
  const book = bot.inventory
    .items()
    .find((item) => item.name === "writable_book");
  if (book === undefined) throw new Error("Writable book missing");
  await bot.equip(book, "hand");
  await bot.waitForTicks(25);
  const rejected = waitForMessage(bot, /not published \(threat\)/);
  bot._client.write("edit_book", {
    hand: bot.quickBarSlot,
    pages: ["[fixture-threat]"],
    title: undefined,
  });
  await rejected;
  expect(
    await rcon.command(`data get entity ${bot.username} SelectedItem`),
  ).not.toContain("fixture-threat");
  await bot.waitForTicks(25);
  bot._client.write("edit_book", {
    hand: bot.quickBarSlot,
    pages: ["Allowed book text"],
    title: "My book",
  });
  // An admitted command following the edit is a FIFO barrier for this author.
  const barrier = waitForMessage(bot, /book edit barrier/);
  bot.chat("book edit barrier");
  await barrier;
  expect(
    await rcon.command(
      `data get entity ${bot.username} SelectedItem.components."minecraft:written_book_content".pages[0].raw`,
    ),
  ).toContain("Allowed book text");
});
