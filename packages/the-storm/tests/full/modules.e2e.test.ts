import path from "node:path";
import { describe, expect } from "vitest";
import { z } from "zod";
import { Vec3 } from "vec3";
import { test } from "#e2e/fixtures.ts";
import { serverLogs } from "#e2e/harness/server.ts";
import { waitForMessage, waitUntil } from "#e2e/harness/bot.ts";

/** The 23 modules the shipped config enables, of the 25 it registers. */
const modules = [
  "agent",
  "arena",
  "chat",
  "companions",
  "discord",
  "economy",
  "essentials",
  "mechanics",
  "messages",
  "mail",
  "mobs",
  "npcs",
  "qol",
  "quests",
  "seasonal",
  "shards",
  "shops",
  "skills",
  "spells",
  "tickets",
  "towns",
  "tracks",
  "world",
].toSorted();

const registeredModules = 25;

const OwnedConfigSchema = z
  .object({ modules: z.record(z.string(), z.boolean()) })
  .strict();

const ownedConfig = path.join(
  import.meta.dir,
  "../../server/owned/plugins/TheStorm/config.yml",
);

describe("all modules together", () => {
  test("boots the 23 shipped modules plus rwf and rwfbots with the shipped content", async ({
    server,
    rcon,
  }) => {
    // The shipped config is the contract: every registered module listed, the
    // same 23 switched on, and only rwf and rwfbots off. The full lane stages
    // it with those two switched on as well, so Search and Destroy and its
    // bots run beside everything else.
    const owned = OwnedConfigSchema.parse(
      Bun.YAML.parse(await Bun.file(ownedConfig).text()),
    );
    expect(Object.keys(owned.modules)).toHaveLength(registeredModules);
    expect(
      Object.entries(owned.modules)
        .filter(([, on]) => on)
        .map(([module]) => module)
        .toSorted(),
    ).toEqual(modules);
    expect(
      Object.entries(owned.modules)
        .filter(([, on]) => !on)
        .map(([module]) => module)
        .toSorted(),
    ).toEqual(["rwf", "rwfbots"]);
    const logs = await serverLogs(server);
    const enabled = /\[TheStorm\] Enabled modules: \[(.*?)\]/u.exec(logs);
    expect(enabled?.[1]?.split(", ").toSorted()).toEqual(
      [...modules, "rwf", "rwfbots"].toSorted(),
    );
    expect(logs).toContain(
      "Prepared synthetic fixtures for Storm modules [world, essentials, npcs, arena, shards, seasonal, rwf]",
    );
    expect(logs).not.toContain("The Storm failed to enable");
    expect(logs).not.toContain("Could not validate shard altars");
    expect(logs).not.toContain("Could not prepare arenas");
    const roster = await rcon.command("stormnpc list");
    expect(roster).toContain("36 NPCs");
    expect(roster).not.toMatch(/missing|unloaded/u);
    expect(await rcon.command("worldborder get")).toContain("40000");
    expect(
      await rcon.command("execute in minecraft:the_nether run worldborder get"),
    ).toContain("10000");
    expect(
      await rcon.command("execute in minecraft:the_end run worldborder get"),
    ).toContain("5000");
    // This suite exercises module wiring with a deliberately malformed token;
    // external Discord login remains a separate production acceptance check.
    expect(logs).toContain("Discord login failed; the bridge is offline");
  });

  test("new progression, skills and spawn work together", async ({ bot }) => {
    const balance = waitForMessage(bot, /500.*crystals/iu);
    bot.chat("/balance");
    await balance;
    const skills = waitForMessage(bot, /Power level: 0/u);
    bot.chat("/skills");
    await skills;
    bot.chat("/spawn");
    await waitUntil(
      "windmill spawn",
      () =>
        Math.abs(bot.entity.position.x - 68.5) < 1 &&
        Math.abs(bot.entity.position.z - 66.5) < 1,
    );
    expect(bot.entity.position.y).toBeCloseTo(69, 0);
    const bulletin = waitForMessage(
      bot,
      /Town Crier|weather|skies|rain|clear/iu,
    );
    bot.chat("/crier");
    await bulletin;
  });

  test("protected spawn keeps builds intact and quest givers remain interactive", async ({
    bot,
    rcon,
  }) => {
    await rcon.command("setblock 72 63 61 minecraft:stone");
    await rcon.command(`tp ${bot.username} 72.5 64 61.5`);
    await waitUntil(
      "farm arrival",
      () => bot.entity.position.distanceTo(new Vec3(72.5, 64, 61.5)) < 0.5,
    );
    await waitUntil("Martha player body", () =>
      Object.values(bot.entities).some(
        (entity) =>
          entity.type === "player" &&
          entity.position.distanceTo(new Vec3(72.5, 64, 59.5)) < 0.5,
      ),
    );
    const martha = Object.values(bot.entities).find(
      (entity) =>
        entity.type === "player" &&
        entity.position.distanceTo(new Vec3(72.5, 64, 59.5)) < 0.5,
    );
    if (martha === undefined)
      throw new Error("Martha disappeared before interaction");
    const dialogs: unknown[] = [];
    bot._client.on("packet", (data: unknown, meta: { name: string }) => {
      if (meta.name === "show_dialog") dialogs.push(data);
    });
    await bot.activateEntityAt(martha, martha.position.offset(0, 1, 0));
    await bot.activateEntity(martha);
    await waitUntil("Martha dialogue", () =>
      dialogs.some((dialog) => JSON.stringify(dialog).includes("Martha")),
    );
    bot.chat("/quests");
    await waitUntil("quest journal", () =>
      dialogs.some((dialog) =>
        JSON.stringify(dialog).includes("Quest Journal"),
      ),
    );

    const protectedBlock = new Vec3(72, 64, 57);
    await rcon.command("setblock 72 64 57 minecraft:dirt");
    await waitUntil(
      "protected dirt arrives",
      () => bot.blockAt(protectedBlock)?.name === "dirt",
    );
    const block = bot.blockAt(protectedBlock);
    if (block === null) throw new Error("protected block is not loaded");
    const refused = waitForMessage(
      bot,
      /Spawn Town|not allowed|cannot|can't/iu,
    );
    await bot.dig(block, true);
    await refused;
    expect(
      await rcon.command("execute if block 72 64 57 minecraft:dirt"),
    ).toContain("Test passed");
    await rcon.command("setblock 72 64 57 minecraft:air");
  });

  test("arena restores belongings when a player leaves", async ({
    bot,
    rcon,
  }) => {
    await rcon.command(`give ${bot.username} diamond 3`);
    await waitUntil("original diamonds arrive", () =>
      bot.inventory
        .items()
        .some((item) => item.name === "diamond" && item.count === 3),
    );
    const joined = waitForMessage(bot, /entered The Colosseum/u);
    bot.chat("/arena join colosseum");
    await joined;
    await waitUntil(
      "arena lobby",
      () => Math.abs(bot.entity.position.x - 224.5) < 1,
    );
    const left = waitForMessage(bot, /left the arena/u);
    bot.chat("/arena leave");
    await left;
    await waitUntil("restored diamonds", () =>
      bot.inventory
        .items()
        .some((item) => item.name === "diamond" && item.count === 3),
    );
  });
});
