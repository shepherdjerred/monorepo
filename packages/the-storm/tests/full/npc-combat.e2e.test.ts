import { describe, expect } from "vitest";
import { Vec3 } from "vec3";
import { test } from "#e2e/fixtures.ts";
import { waitForMessage, waitUntil } from "#e2e/harness/bot.ts";
import { serverLogs } from "#e2e/harness/server.ts";
import type { RconClient } from "@shepherdjerred/the-storm-brain/rcon";

function npc(id: string): string {
  return `@e[type=minecraft:mannequin,nbt={BukkitValues:{"thestorm:npc":"${id}"}},limit=1]`;
}

async function health(rcon: RconClient, entity: string): Promise<number> {
  const response = await rcon.command(`data get entity ${entity} Health`);
  const match = /: ([\d.]+)f$/u.exec(response.trim());
  if (match?.[1] === undefined) throw new Error(`No health: ${response}`);
  return Number(match[1]);
}

async function eventually(
  description: string,
  check: () => Promise<boolean>,
): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (!(await check())) {
    if (Date.now() >= deadline) throw new Error(`Timed out: ${description}`);
    await Bun.sleep(100);
  }
}

async function nextDay(rcon: RconClient): Promise<void> {
  await rcon.command("time add 24000");
  // The ledger observes world clocks every think interval (20 ticks).
  await Bun.sleep(1500);
}

describe("NPC combat on Paper with all modules", () => {
  test("two damaging warnings precede defense, and dawn restores a killed NPC", async ({
    bot,
    rcon,
    server,
  }) => {
    await nextDay(rcon);
    await rcon.command("difficulty normal");
    await rcon.command("gamerule minecraft:spawn_mobs false");
    await rcon.command("fill -60 63 -24 -14 63 24 minecraft:stone");
    await rcon.command("fill 498 63 498 502 63 502 minecraft:stone");
    await rcon.command("gamerule minecraft:advance_time false");
    await rcon.command(`tp ${bot.username} -35.5 64 3.5`);
    await waitUntil(
      "market arrival",
      () => bot.entity.position.distanceTo(new Vec3(-35.5, 64, 3.5)) < 0.3,
    );
    const messages: string[] = [];
    const record = (message: string) => {
      messages.push(message);
    };
    bot.on("messagestr", record);
    try {
      const starting = await health(rcon, npc("stan"));
      for (const pattern of [/Warning 1 of 2/u, /Final warning/u]) {
        const warning = waitForMessage(bot, pattern);
        await rcon.command(
          `damage ${npc("stan")} 1 minecraft:player_attack by ${bot.username}`,
        );
        await warning;
        await Bun.sleep(600);
      }
      expect(await health(rcon, npc("stan"))).toBe(starting - 2);
      expect(bot.health).toBe(20);
      const defending = waitForMessage(bot, /The Watch will defend us/u);
      await rcon.command(
        `damage ${npc("stan")} 1 minecraft:player_attack by ${bot.username}`,
      );
      await defending;
      await waitUntil(
        "guards damage the attacker",
        () => bot.health < 20,
        15_000,
      );
      // Escape stops the current chase; remembered offenses still bypass another NPC's grace.
      await rcon.command(`tp ${bot.username} 500 64 500`);
      const remembered = waitForMessage(bot, /The Watch will defend us/u);
      await rcon.command(
        `damage ${npc("darren")} 1 minecraft:arrow by ${bot.username}`,
      );
      await remembered;
      await rcon.command(`damage ${npc("stan")} 100 minecraft:generic`);
      await eventually("Stan dies", async () => {
        const exists = await rcon.command(`execute if entity ${npc("stan")}`);
        return !exists.includes("Test passed");
      });
      expect(await rcon.command("npc list")).toMatch(
        /stan:.*dead; returns at dawn/u,
      );
      await rcon.command("npc reload");
      await Bun.sleep(1500);
      expect(await rcon.command("npc list")).toMatch(
        /stan:.*dead; returns at dawn/u,
      );
      await nextDay(rcon);
      expect(await health(rcon, npc("stan"))).toBe(20);
      const forgiven = waitForMessage(bot, /Warning 1 of 2/u);
      await rcon.command(
        `damage ${npc("stan")} 1 minecraft:player_attack by ${bot.username}`,
      );
      await forgiven;
      const logs = await serverLogs(server);
      expect(logs).not.toContain("NPC state persistence failed");
      expect(logs).not.toContain("Could not pass event EntityDamage");
      await Bun.write(".cache/e2e/npc-combat.txt", messages.join("\n"));
    } finally {
      bot.off("messagestr", record);
      await nextDay(rcon);
      await rcon.command("gamerule minecraft:advance_time true");
    }
  });

  test("guards take melee damage and lethal first hits summon immediate defense", async ({
    bot,
    rcon,
  }) => {
    await rcon.command(`tp ${npc("market-guard")} -34.5 64 4.5`);
    await rcon.command(`tp ${bot.username} -34.5 64 3`);
    await waitUntil("visible market sentry", () =>
      Object.values(bot.entities).some(
        (entity) =>
          entity.name === "mannequin" &&
          entity.position.distanceTo(new Vec3(-34.5, 64, 4.5)) < 0.8,
      ),
    );
    const sentry = Object.values(bot.entities).find(
      (entity) =>
        entity.name === "mannequin" &&
        entity.position.distanceTo(new Vec3(-34.5, 64, 4.5)) < 0.8,
    );
    if (sentry === undefined) throw new Error("Sentry left before attack");
    const before = await health(rcon, npc("market-guard"));
    const warning = waitForMessage(bot, /Warning 1 of 2/u);
    bot.attack(sentry);
    await warning;
    expect(await health(rcon, npc("market-guard"))).toBeLessThan(before);
    expect(bot.health).toBe(20);
    const defended = waitForMessage(bot, /The Watch will defend us/u);
    await rcon.command(
      `damage ${npc("zavier")} 100 minecraft:player_attack by ${bot.username}`,
    );
    await defended;
    await waitUntil("lethal attack is defended", () => bot.health < 20, 15_000);
    expect(await rcon.command("npc list")).toMatch(
      /zavier:.*dead; returns at dawn/u,
    );
    await rcon.command(`tp ${bot.username} 500 64 500`);
    await rcon.command(`damage ${npc("market-guard")} 100 minecraft:generic`);
    await Bun.sleep(600);
    expect(await rcon.command("npc list")).toMatch(
      /market-guard:.*dead; returns at dawn/u,
    );
    for (const type of ["item", "experience_orb"]) {
      const drops = await rcon.command(
        `execute if entity @e[type=minecraft:${type},x=-35,y=64,z=4,distance=..24]`,
      );
      expect(drops).not.toContain("Test passed");
    }
    await nextDay(rcon);
  });

  test("civilians flee and call guards for hostile mobs while peaceful animals stay safe", async ({
    bot,
    rcon,
  }) => {
    await rcon.command("difficulty normal");
    await rcon.command("time set midnight");
    // Move the guard far from its original home: this reproduces the old home-radius bug.
    await rcon.command(`gamemode spectator ${bot.username}`);
    await rcon.command(`tp ${bot.username} 500 70 500`);
    await rcon.command(`tp ${npc("guard-captain")} -35.5 64 6.5`);
    await rcon.command(`tp ${npc("stan")} -35.5 64 0.5`);
    await rcon.command(
      'summon minecraft:cow -34.5 64 6.5 {Tags:["npc-peaceful"],NoAI:1b,PersistenceRequired:1b}',
    );
    await Bun.sleep(1500);
    expect(await health(rcon, "@e[tag=npc-peaceful,limit=1]")).toBe(10);
    await rcon.command(
      'summon minecraft:zombie -35.5 64 2.5 {Tags:["npc-hostile"],NoAI:1b,PersistenceRequired:1b}',
    );
    const original = await rcon.command(`data get entity ${npc("stan")} Pos`);
    await eventually(
      "Stan flees",
      async () =>
        (await rcon.command(`data get entity ${npc("stan")} Pos`)) !== original,
    );
    await eventually("Watch fights the zombie", async () => {
      const exists = await rcon.command(
        "execute if entity @e[tag=npc-hostile]",
      );
      return (
        !exists.includes("Test passed") ||
        (await health(rcon, "@e[tag=npc-hostile,limit=1]")) < 20
      );
    });
    expect(await health(rcon, "@e[tag=npc-peaceful,limit=1]")).toBe(10);
    await rcon.command("kill @e[tag=npc-hostile]");
    await rcon.command("kill @e[tag=npc-peaceful]");
    await rcon.command(`gamemode survival ${bot.username}`);
    await rcon.command("difficulty peaceful");
  });
});
