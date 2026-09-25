import { Vec3 } from "vec3";
import { describe, expect } from "vitest";
import { z } from "zod";
import { test } from "./fixtures.ts";
import {
  waitForMessage,
  waitForTranslation,
  waitUntil,
} from "./harness/bot.ts";
import { botProtocol, botVersion, paper } from "./harness/pins.ts";
import {
  ClearCountOutputSchema,
  DayTimelineOutputSchema,
  EntityPosOutputSchema,
  ExecuteTestOutputSchema,
  ListOutputSchema,
} from "./harness/rcon-output.ts";
import { serverLogs } from "./harness/server.ts";

const TimelineArgsSchema = z.tuple([z.literal("minecraft:day"), z.bigint()]);

function blockArgs(block: Vec3): string {
  return `${block.x.toString()} ${block.y.toString()} ${block.z.toString()}`;
}

describe("disposable Paper 26.2 server", () => {
  test("runs Paper 26.2 behind ViaVersion and answers RCON", async ({
    rcon,
    server,
  }) => {
    const list = ListOutputSchema.parse(await rcon.command("list"));
    expect(list.max).toBe(20);
    expect(await serverLogs(server)).toContain(
      `ViaVersion detected server version: ${paper.version} (${paper.protocol.toString()})`,
    );
  });

  test("an older-protocol bot joins through ViaBackwards", async ({
    bot,
    rcon,
  }) => {
    expect(bot.version).toBe(botVersion);
    expect(bot.protocolVersion).toBe(botProtocol);
    expect(botProtocol).toBeLessThan(paper.protocol);
    expect(bot.game.gameMode).toBe("survival");

    const list = ListOutputSchema.parse(await rcon.command("list"));
    expect(list.names).toContain(bot.username);

    // Server-side and bot-observed position agree.
    const pos = EntityPosOutputSchema.parse(
      await rcon.command(`data get entity ${bot.username} Pos`),
    );
    expect(pos.x).toBeCloseTo(bot.entity.position.x, 1);
    expect(pos.y).toBeCloseTo(bot.entity.position.y, 1);
    expect(pos.z).toBeCloseTo(bot.entity.position.z, 1);
  });

  test("a bot-issued command and RCON agree on the day timeline", async ({
    bot,
    rcon,
  }) => {
    await rcon.command(`op ${bot.username}`);
    await rcon.command("time set 1000");
    const fromRcon = DayTimelineOutputSchema.parse(
      await rcon.command("time query day"),
    );

    const reply = waitForTranslation(bot, "commands.time.query.timeline");
    bot.chat("/time query day");
    const [, ticks] = TimelineArgsSchema.parse(await reply);
    const fromBot = Number(ticks);

    expect(fromRcon.ticks).toBeGreaterThanOrEqual(1000);
    expect(fromBot).toBeGreaterThanOrEqual(fromRcon.ticks);
    expect(fromBot - fromRcon.ticks).toBeLessThan(200);
    // The clock sync packet reaches the bot too.
    await waitUntil("bot clock update", () => bot.time.timeOfDay >= 1000);
  });

  test("an RCON /give lands in the bot inventory", async ({ bot, rcon }) => {
    const diamond = bot.registry.itemsByName["diamond"];
    if (diamond === undefined) {
      throw new Error("minecraft-data has no diamond item");
    }
    await rcon.command(`give ${bot.username} minecraft:diamond 5`);

    await waitUntil(
      "diamonds in inventory",
      () => bot.inventory.count(diamond.id, null) === 5,
    );
    const cleared = ClearCountOutputSchema.parse(
      await rcon.command(`clear ${bot.username} minecraft:diamond 0`),
    );
    expect(cleared).toEqual({ count: 5, player: bot.username });
  });
});

describe("multi-player flows", () => {
  test("two bots see each other's chat and a block break", async ({
    bot,
    secondBot,
    rcon,
  }) => {
    await rcon.command(`tp ${bot.username} 0.5 -60 0.5`);
    await rcon.command(`tp ${secondBot.username} 4.5 -60 0.5`);
    await waitUntil(
      "bots teleported",
      () =>
        bot.entity.position.distanceTo(new Vec3(0.5, -60, 0.5)) < 0.1 &&
        secondBot.entity.position.distanceTo(new Vec3(4.5, -60, 0.5)) < 0.1,
    );
    await waitUntil(
      "bots see each other",
      () =>
        bot.players[secondBot.username]?.entity !== undefined &&
        secondBot.players[bot.username]?.entity !== undefined,
    );

    const heard = waitForMessage(
      secondBot,
      new RegExp(`<${bot.username}> storm incoming`, "u"),
    );
    bot.chat("storm incoming");
    await heard;

    // Grief-style flow: the first bot breaks a block; the second observes it.
    const target = new Vec3(2, -60, 0);
    await rcon.command(`setblock ${blockArgs(target)} minecraft:dirt`);
    await waitUntil(
      "both bots see dirt",
      () =>
        bot.blockAt(target)?.name === "dirt" &&
        secondBot.blockAt(target)?.name === "dirt",
    );
    const block = bot.blockAt(target);
    if (block === null) {
      throw new Error("target block is not loaded for the first bot");
    }
    await bot.lookAt(target.offset(0.5, 0.5, 0.5), true);
    await bot.dig(block, true);

    await waitUntil(
      "second bot sees air",
      () => secondBot.blockAt(target)?.name === "air",
    );
    expect(
      ExecuteTestOutputSchema.parse(
        await rcon.command(
          `execute if block ${blockArgs(target)} minecraft:air`,
        ),
      ),
    ).toBe(true);
  });
});

const summoned = [
  "text_display",
  "block_display",
  "item_display",
  "interaction",
  "mannequin",
] as const;

describe("26.x features through ViaBackwards", () => {
  test("a bot receives display entities, mannequins, dialogs, and 26.2-only mobs and blocks", async ({
    bot,
    rcon,
  }) => {
    const { x, y, z: posZ } = bot.entity.position;
    const at = `${(x + 2).toString()} ${y.toString()} ${posZ.toString()}`;
    const dialogs: unknown[] = [];
    bot._client.on("packet", (data: unknown, meta: { name: string }) => {
      if (meta.name === "show_dialog") {
        dialogs.push(data);
      }
    });

    for (const type of [...summoned, "sulfur_cube"]) {
      await rcon.command(`summon minecraft:${type} ${at}`);
    }
    const seen = () =>
      new Set(Object.values(bot.entities).map((entity) => entity.name));
    await waitUntil("summoned entities", () =>
      summoned.every((name) => seen().has(name)),
    );
    // sulfur_cube is new in 26.2; ViaBackwards maps it to a slime for 26.1 clients.
    await waitUntil("sulfur cube as slime", () => seen().has("slime"));

    await rcon.command(
      `dialog show ${bot.username} {type:"minecraft:notice",title:"The Storm"}`,
    );
    await waitUntil("dialog packet", () => dialogs.length > 0);
    expect(JSON.stringify(dialogs[0])).toContain("The Storm");

    // New 26.2 blocks are substituted with the nearest 26.1 block (sulfur -> sandstone).
    const block = bot.entity.position.floored().offset(-2, 0, 0);
    await rcon.command(`setblock ${blockArgs(block)} minecraft:sulfur`);
    await waitUntil(
      "sulfur as sandstone",
      () => bot.blockAt(block)?.name === "sandstone",
    );

    // Leave the shared world as we found it for later tests.
    await rcon.command("kill @e[type=!minecraft:player]");
    await rcon.command(`setblock ${blockArgs(block)} minecraft:air`);
  });
});
