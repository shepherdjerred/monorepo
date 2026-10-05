import { describe, expect } from "vitest";
import { z } from "zod";
import { test } from "./fixtures.ts";
import { collectMessages, waitForMessage, waitUntil } from "./harness/bot.ts";

describe("Essentials expansion", () => {
  test("nicknames cannot impersonate real usernames and realname preserves identity", async ({
    bot,
    secondBot,
  }) => {
    let response = waitForMessage(bot, /another player's username/);
    bot.chat(`/nick ${secondBot.username}`);
    await response;
    response = waitForMessage(bot, /Saved\./);
    bot.chat("/nick StormReader");
    await response;
    response = waitForMessage(
      secondBot,
      new RegExp(`StormReader is ${bot.username}`, "u"),
    );
    secondBot.chat("/realname StormReader");
    await response;
    response = waitForMessage(bot, /Saved\./);
    bot.chat("/nick off");
    await response;
  });

  test("inventory editing requires its own permission and transfers actual items without duplication", async ({
    bot,
    secondBot,
    rcon,
  }) => {
    await rcon.command(`op ${bot.username}`);
    await rcon.command(
      `lp user ${bot.username} permission set thestorm.essentials.invsee.edit false`,
    );
    const response = waitForMessage(bot, /do not have permission/);
    bot.chat(`/invsee ${secondBot.username} edit`);
    await response;
    expect(bot.currentWindow).toBeNull();
    await rcon.command(
      `lp user ${bot.username} permission set thestorm.essentials.invsee.edit true`,
    );
    await rcon.command(
      `item replace entity ${secondBot.username} hotbar.0 with minecraft:diamond 7`,
    );
    await waitUntil("diamonds delivered", () =>
      secondBot.inventory
        .items()
        .some((item) => item.name === "diamond" && item.count === 7),
    );
    bot.chat(`/invsee ${secondBot.username} edit`);
    await waitUntil("edit window open", () => bot.currentWindow !== null);
    const slot =
      bot.currentWindow?.slots.findIndex((item) => item?.name === "diamond") ??
      -1;
    expect(slot).toBeGreaterThanOrEqual(0);
    await bot.clickWindow(slot, 0, 0);
    await waitUntil(
      "diamonds removed from target",
      () =>
        !secondBot.inventory.items().some((item) => item.name === "diamond"),
    );
    await waitUntil(
      "actual diamonds held on staff cursor",
      () =>
        bot.currentWindow?.selectedItem?.name === "diamond" &&
        bot.currentWindow.selectedItem.count === 7,
    );
    await bot.clickWindow(slot, 0, 0);
    await waitUntil("diamonds returned to target", () =>
      secondBot.inventory
        .items()
        .some((item) => item.name === "diamond" && item.count === 7),
    );
    await waitUntil(
      "cursor cleared after return",
      () => bot.currentWindow?.selectedItem === null,
    );
    if (bot.currentWindow !== null) await bot.closeWindow(bot.currentWindow);
    expect(
      bot.inventory.items().filter((item) => item.name === "diamond"),
    ).toHaveLength(0);
  });

  test("jail blocks travel while communication remains available, then expires", async ({
    bot,
    secondBot,
    rcon,
  }) => {
    await rcon.command(`op ${bot.username}`);
    await rcon.command(`tp ${bot.username} 68.5 69 66.5`);
    let response = waitForMessage(bot, /Jail set/);
    bot.chat("/setjail expansioncell");
    await response;
    await rcon.command("fill 98 68 98 102 68 102 minecraft:stone");
    await rcon.command(`tp ${secondBot.username} 100.5 69 100.5`);
    await waitUntil(
      "target moved outside cell",
      () => secondBot.entity.position.x > 90,
    );
    response = waitForMessage(bot, /Jailed/);
    bot.chat(`/jail ${secondBot.username} expansioncell 5s`);
    await response;
    await waitUntil(
      "prisoner enters cell",
      () => secondBot.entity.position.x < 80,
    );
    response = waitForMessage(secondBot, /unavailable while jailed/);
    secondBot.chat("/spawn");
    await response;
    response = waitForMessage(bot, /a jailed message/);
    secondBot.chat(`/msg ${bot.username} a jailed message`);
    await response;
    await waitUntil(
      "timed sentence returns prisoner",
      () => secondBot.entity.position.x > 90,
      15_000,
    );
  });
});

describe("Essentials permissions and communication", () => {
  test("ordinary players can browse warps and help but cannot create warps or use staff tools", async ({
    bot,
  }) => {
    let response = waitForMessage(bot, /Warps:|no warps/);
    bot.chat("/warp");
    await response;
    response = waitForMessage(bot, /Commands: .+/);
    bot.chat("/help");
    const matchedGuide = await response;
    const guide = matchedGuide[0];
    expect(guide).toContain("/warp");
    expect(guide).not.toMatch(/\/kit\b|\/setwarp\b|\/fly\b|\/invsee\b/);
    for (const command of [
      "kit",
      "setwarp unauthorized",
      "delwarp unauthorized",
      "fly",
      "tpall",
      "banip 8.8.8.8 test",
    ]) {
      response = waitForMessage(
        bot,
        /Unknown|incomplete|permission|not.*command/i,
      );
      bot.chat(`/${command}`);
      await response;
    }
  });
  test("letters commit before notification, belong to their recipient and respect message preferences", async ({
    bot,
    secondBot,
  }) => {
    const sent = waitForMessage(bot, /Letter sent\./);
    const arrived = waitForMessage(secondBot, /A letter from/);
    bot.chat(
      `/mail send ${secondBot.username} Literal <red>words</red> and 😀`,
    );
    await sent;
    await arrived;
    const listing = waitForMessage(secondBot, /\[Unread letter\]/);
    const packets: string[] = [];
    const observe = (message: object) => {
      packets.push(JSON.stringify(message));
    };
    secondBot.on("message", observe);
    secondBot.chat("/mail");
    await listing;
    secondBot.off("message", observe);
    const match = /\/mail read ([0-9a-f-]{36})/u.exec(packets.join("\n"));
    expect(match).not.toBeNull();
    const id = z.uuid().parse(match?.[1]);
    let response = waitForMessage(bot, /not in your inbox/);
    bot.chat(`/mail delete ${id}`);
    await response;
    response = waitForMessage(secondBot, /Saved\. Messages: false/);
    secondBot.chat("/msgtoggle");
    await response;
    response = waitForMessage(bot, /cannot receive this letter/);
    bot.chat(`/mail send ${secondBot.username} Another letter`);
    await response;
    response = waitForMessage(secondBot, /Letter deleted\./);
    secondBot.chat(`/mail delete ${id}`);
    await response;
    response = waitForMessage(secondBot, /no letters/);
    secondBot.chat("/mail");
    await response;
  });
  test("staff vanish hides tab entries and inspection cannot transfer items", async ({
    bot,
    secondBot,
    rcon,
  }) => {
    await rcon.command(`op ${bot.username}`);
    let response = waitForMessage(bot, /Vanish: true/);
    bot.chat("/vanish");
    await response;
    await waitUntil(
      "hidden staff removed from tab",
      () => secondBot.players[bot.username] === undefined,
    );
    response = waitForMessage(secondBot, /not online|No player|No entity/i);
    secondBot.chat(`/msg ${bot.username} test`);
    await response;
    bot.chat(`/invsee ${secondBot.username}`);
    await waitUntil("inspection window open", () => bot.currentWindow !== null);
    const before = secondBot.inventory
      .items()
      .map((item) => `${item.name}:${item.count.toString()}`)
      .toSorted();
    const slot =
      bot.currentWindow?.slots.findIndex((item) => item !== null) ?? -1;
    expect(slot).toBeGreaterThanOrEqual(0);
    await bot.clickWindow(slot, 0, 0);
    await bot.waitForTicks(5);
    expect(
      secondBot.inventory
        .items()
        .map((item) => `${item.name}:${item.count.toString()}`)
        .toSorted(),
    ).toEqual(before);
    if (bot.currentWindow !== null) await bot.closeWindow(bot.currentWindow);
    response = waitForMessage(bot, /Vanish: false/);
    bot.chat("/vanish");
    await response;
    await waitUntil(
      "staff restored in tab",
      () => secondBot.players[bot.username] !== undefined,
    );
    const lines = await collectMessages(secondBot, 500);
    expect(lines.some((line) => /\/kit\b|received.*kit/i.test(line))).toBe(
      false,
    );
  });
  test("staff controls and matching mass-operation confirmation", async ({
    bot,
    secondBot,
    rcon,
  }) => {
    await rcon.command(`op ${bot.username}`);
    let response = waitForMessage(bot, /Flight: true/);
    bot.chat("/fly");
    await response;
    await rcon.command("fill 98 68 98 102 68 102 minecraft:stone");
    await rcon.command(`tp ${secondBot.username} 100.5 69 100.5`);
    await waitUntil(
      "teleport target is distant",
      () => secondBot.entity.position.x > 90,
    );
    response = waitForMessage(bot, /Repeat \/tpall/);
    bot.chat("/tpall");
    await response;
    expect(secondBot.entity.position.x).toBeGreaterThan(90);
    response = waitForMessage(bot, /Teleported/);
    bot.chat("/tpall");
    await response;
    await waitUntil(
      "confirmed operation moved target to staff",
      () => secondBot.entity.position.distanceTo(bot.entity.position) < 5,
    );
  });
});
