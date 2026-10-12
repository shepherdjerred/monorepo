import { randomBytes } from "node:crypto";
import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import { describe, expect } from "vitest";
import { z } from "zod";
import { test } from "./fixtures.ts";
import { waitUntil } from "./harness/bot.ts";
import { setRwfKits } from "./harness/fake-brain.ts";
import {
  connectAll,
  count,
  disconnectAll,
  health,
  hotbar,
  type Human,
  human,
  inRwf,
  inView,
  join,
  playTogether,
  teleport,
  yard,
} from "./harness/rwf-humans.ts";
import {
  eventually,
  matchDatabase,
  status,
  waitForLobby,
} from "./harness/rwf-match.ts";
import { querySqlite } from "./harness/storm-data.ts";
import type { RconClient } from "#e2e/harness/rcon.ts";

/**
 * Red Warfare's kits on the real server, with the kit list, shop and
 * killstreak flags open for the suite's players: this week's free kits, the
 * Red Warfare credits that buy a kit for good, and one kit ability from each
 * batch working in a live match (Explosive's RPG, the Teleporter's creator,
 * the Ninja's speed and the Engineer's barricade), and earned killstreaks
 * delivered by falling blocks as a supply crate and three attack dogs.
 */

/** Opens the kit list, shop and killstreaks for `humans`, before they join. */
async function openKits(port: number, humans: Human[]): Promise<void> {
  await setRwfKits(
    port,
    humans.map(({ bot }) => z.uuid().parse(bot.player.uuid)),
  );
}

/** Gives `bot` Red Warfare credits, as an operator does. */
async function giveCredits(
  rcon: RconClient,
  bot: Bot,
  amount: number,
): Promise<void> {
  const answer = await rcon.command(
    `eco give ${bot.username} ${amount.toString()} rwf_credits`,
  );
  expect(answer).not.toMatch(/unknown|error/iu);
}

/** Asks `/rwf credits`; a fresh transcript so only the new answer counts. */
async function creditsOf(one: Human): Promise<number> {
  one.log.lines.length = 0;
  one.bot.chat("/rwf credits");
  const seen = await one.log.until(/You have (?<credits>\d+) credits?\./u);
  return Number(seen.groups?.["credits"]);
}

/** Buys `kit` by command and waits for the shop's answer. */
async function buy(one: Human, kit: string, price: number): Promise<void> {
  one.log.lines.length = 0;
  one.bot.chat(`/rwf buy ${kit}`);
  await one.log.until(
    new RegExp(
      String.raw`Purchased kit \w+ for ${price.toString()} credits!`,
      "u",
    ),
  );
}

/** Picks `kit` and waits until `item` is in hotbar `slot`. */
async function pick(
  one: Human,
  kit: string,
  slot: number,
  item: string,
): Promise<void> {
  one.bot.chat(`/rwf kit ${kit}`);
  await waitUntil(
    `${kit} in slot ${slot.toString()}`,
    () => hotbar(one.bot, slot) === item,
  );
}

/** `a` joins with `kits[0]` and `b` with `kits[1]`; returns once the match is live. */
async function playWith(
  a: Human,
  b: Human,
  kits: readonly [Pick, Pick],
): Promise<void> {
  for (const one of [a, b]) {
    one.log.lines.length = 0;
  }
  for (const [index, one] of [a, b].entries()) {
    const kit = kits[index];
    if (kit === undefined) {
      throw new Error("a kit for each player");
    }
    await join(one);
    await pick(one, kit.id, kit.slot, kit.item);
  }
  for (const { log } of [a, b]) {
    await log.until(/The game has begun!/u, 60_000);
  }
}

type Pick = { id: string; slot: number; item: string };

/** Ends the match: `a` leaves and the lobby opens again. */
async function endMatch(rcon: RconClient, a: Human): Promise<void> {
  a.bot.chat("/rwf leave");
  await waitForLobby(rcon);
}

async function blockIs(
  rcon: RconClient,
  at: Vec3,
  block: string,
): Promise<boolean> {
  const answer = await inRwf(
    rcon,
    `execute if block ${at.x.toString()} ${at.y.toString()} ${at.z.toString()} minecraft:${block}`,
  );
  return answer.includes("Test passed");
}

/** Right-clicks the block at `at` with the item in hotbar `slot`. */
async function useOn(bot: Bot, slot: number, at: Vec3): Promise<void> {
  bot.setQuickBarSlot(slot);
  // The map's chunks reach the client a little after the move into it.
  await waitUntil(
    `the block at ${at.toString()} loaded`,
    () => bot.blockAt(at)?.boundingBox === "block",
  );
  const block = bot.blockAt(at);
  if (block === null) {
    throw new Error(`no block loaded at ${at.toString()}`);
  }
  await bot.activateBlock(block);
}

describe("The kit shop and the weekly rotation", () => {
  test(
    "this week's four free kits are listed, and credits buy a kit for good",
    { timeout: 120_000 },
    async ({ bot, rcon, brain, server }) => {
      await waitForLobby(rcon);
      const a = human(bot);
      await openKits(brain.port, [a]);

      bot.chat("/rwf rotation");
      const rotation = await a.log.until(
        /Free this week: (?<kits>.+)\. Changes in /u,
      );
      expect(rotation.groups?.["kits"]?.split(", ")).toHaveLength(4);

      expect(await creditsOf(a)).toBe(0);
      await giveCredits(rcon, bot, 400);
      expect(await creditsOf(a)).toBe(400);
      await buy(a, "explosive", 150);
      expect(await creditsOf(a)).toBe(250);

      const { database } = await matchDatabase(server, `kits-${bot.username}`);
      const player = z.uuid().parse(bot.player.uuid);
      const owned = z
        .array(z.strictObject({ kit: z.string(), source: z.string() }))
        .parse(
          await querySqlite(
            database,
            `SELECT kit, source FROM rwf_kit_owned WHERE player = '${player}'`,
          ),
        );
      expect(owned).toEqual([{ kit: "explosive", source: "PURCHASE" }]);

      // Owned, it is picked like a free kit.
      await join(a);
      await pick(a, "explosive", 2, "egg");
      expect(hotbar(bot, 3)).toBe("firework_star");
      bot.chat("/rwf leave");
      await waitForLobby(rcon);
    },
  );
});

describe("Kit abilities in a live match", () => {
  test(
    "an RPG flies, a teleporter is placed, a Ninja runs fast and a barricade goes up",
    { timeout: 300_000 },
    async ({ bot, secondBot, rcon, brain }) => {
      await waitForLobby(rcon);
      const a = human(bot);
      const b = human(secondBot);
      await openKits(brain.port, [a, b]);
      await giveCredits(rcon, bot, 400);
      await giveCredits(rcon, secondBot, 400);
      await buy(a, "explosive", 150);
      await buy(a, "ninja", 200);
      await buy(b, "engineer", 400);

      // Batches C and B: the Explosive's RPG and the Teleporter's creator.
      await playWith(a, b, [
        { id: "explosive", slot: 2, item: "egg" },
        { id: "teleporter", slot: 2, item: "quartz" },
      ]);
      bot.setQuickBarSlot(2);
      await waitUntil("the RPG in hand", () => bot.heldItem?.name === "egg");
      bot.activateItem();
      await waitUntil("one RPG gone", () => count(bot, "egg") === 4);
      const ground = secondBot.entity.position.offset(0, -1, 0).floored();
      await useOn(secondBot, 2, ground);
      await eventually("the teleporter in the ground", async () =>
        blockIs(rcon, ground, "infested_chiseled_stone_bricks"),
      );
      await endMatch(rcon, a);

      // Batches A and D: the Ninja's Speed II and the Engineer's barricade.
      await playWith(a, b, [
        { id: "ninja", slot: 1, item: "iron_sword" },
        { id: "engineer", slot: 2, item: "bricks" },
      ]);
      // The full effect list is cut short in an RCON reply; ask for Speed II alone.
      await eventually("the Ninja's Speed II", async () => {
        const answer = await rcon.command(
          `execute if entity @a[name=${bot.username},nbt={active_effects:[{id:"minecraft:speed",amplifier:1b}]}]`,
        );
        return answer.includes("Test passed");
      });
      // Barricades stay four blocks clear of a bomb: build in the open middle.
      await inRwf(
        rcon,
        `minecraft:tp ${secondBot.username} 24.5 65 20.5 -90 0`,
      );
      await waitUntil(
        "the Engineer in the open",
        () =>
          secondBot.entity.position.distanceTo(new Vec3(24.5, 65, 20.5)) < 0.5,
      );
      const base = new Vec3(26, 64, 20);
      await useOn(secondBot, 2, base);
      await eventually("bricks across the way", async () =>
        blockIs(rcon, base.offset(0, 1, 0), "bricks"),
      ).catch((error: unknown) => {
        throw new Error(
          `no barricade at ${base.offset(0, 1, 0).toString()}; the Engineer saw:\n${b.log.lines.join("\n")}`,
          { cause: error },
        );
      });
      await endMatch(rcon, a);
    },
  );
});

/** `killer` hits `victim` with its sword in the yard until the victim dies. */
async function kill(
  rcon: RconClient,
  victim: Human,
  killer: Human,
): Promise<void> {
  await teleport(rcon, victim.bot, yard.duel[1]);
  await teleport(rcon, killer.bot, yard.duel[0]);
  killer.bot.setQuickBarSlot(1);
  await waitUntil(
    `${killer.bot.username} sees ${victim.bot.username}`,
    () => inView(killer.bot, victim.bot) !== undefined,
  );
  for (let swing = 0; swing < 30; swing++) {
    const target = inView(killer.bot, victim.bot);
    if (
      target === undefined ||
      victim.bot.game.gameMode === "spectator" ||
      (await health(rcon, victim.bot)) <= 0
    ) {
      return;
    }
    killer.bot.attack(target);
    // Past the hit window, so every swing lands in full.
    await Bun.sleep(600);
  }
}

describe("Killstreaks", () => {
  test(
    "four combat kills deliver an earned supply crate and three attack dogs",
    { timeout: 300_000 },
    async ({ rcon, brain, server }) => {
      await waitForLobby(rcon);
      const names = Array.from(
        { length: 9 },
        (_, index) =>
          `drop${index.toString()}_${randomBytes(4).toString("hex")}`,
      );
      const humans = await connectAll(server, names);
      try {
        await openKits(brain.port, humans);
        await inRwf(
          rcon,
          "gamerule minecraft:natural_health_regeneration false",
        );
        const teams = await playTogether(humans);
        // A member of the smaller team kills four of the five opponents;
        // the last opponent keeps the match live for the reward deliveries.
        const smaller = teams.find(
          (team) => teams.filter((other) => other === team).length === 4,
        );
        const killer = humans.find((_, index) => teams[index] === smaller);
        const opponents = humans.filter((_, index) => teams[index] !== smaller);
        if (killer === undefined || opponents.length !== 5) {
          throw new Error(`no four against five in ${teams.join(", ")}`);
        }
        for (const victim of opponents.slice(0, 4)) {
          await kill(rcon, victim, killer);
          await waitUntil(
            `${victim.bot.username} dies to the sword`,
            () => victim.bot.game.gameMode === "spectator",
          );
        }
        await killer.log.until(/Killstreak of 4! Given supply crate!/u);
        await killer.log.until(/Killstreak of 4! Given attack dogs!/u);
        await waitUntil(
          "both earned delivery items in the killer's inventory",
          () =>
            count(killer.bot, "redstone") === 1 &&
            count(killer.bot, "wolf_spawn_egg") === 1,
        );
        const earnedIn = await status(rcon);
        expect(earnedIn.phase).toBe("Live");

        const crateFloor = new Vec3(24, 64, 20);
        const dogsFloor = new Vec3(28, 64, 20);
        for (const [item, floor, arrived] of [
          ["redstone", crateFloor, /Supply crate has landed!/u],
          ["wolf_spawn_egg", dogsFloor, /Attack dogs have arrived!/u],
        ] as const) {
          await teleport(rcon, killer.bot, floor.offset(0.5, 1, 2.5));
          const slot = Array.from({ length: 9 }, (_, index) => index).find(
            (index) => hotbar(killer.bot, index) === item,
          );
          if (slot === undefined) {
            throw new Error(`${item} was not delivered to the hotbar`);
          }
          await useOn(killer.bot, slot, floor);
          await waitUntil(
            `the earned ${item} is consumed`,
            () => count(killer.bot, item) === 0,
          );
          await eventually(
            "the reward falls through the real world",
            async () => {
              const reply = await inRwf(
                rcon,
                "execute if entity @e[type=minecraft:falling_block]",
              );
              return reply.includes("Test passed");
            },
          );
          await killer.log.until(arrived, 20_000);
          const deliveredIn = await status(rcon);
          expect(deliveredIn.phase).toBe("Live");
        }
        expect(await blockIs(rcon, crateFloor.offset(0, 1, 0), "chest")).toBe(
          true,
        );
        await waitUntil(
          "three landed attack dogs reach the player's client",
          () =>
            Object.values(killer.bot.entities).filter(
              (entity) => entity.name === "wolf",
            ).length === 3,
        );
        const survivor = opponents[4];
        if (survivor === undefined) {
          throw new Error("the opposing survivor disappeared");
        }
        expect(survivor.bot.game.gameMode).toBe("survival");
      } finally {
        await inRwf(
          rcon,
          "gamerule minecraft:natural_health_regeneration true",
        );
        await disconnectAll(humans);
        await waitForLobby(rcon);
      }
    },
  );

  test(
    "two kills in a match earn the tracking compass",
    { timeout: 240_000 },
    async ({ rcon, brain, server }) => {
      await waitForLobby(rcon);
      const names = ["s", "t", "e", "f", "g"].map(
        (prefix) => `${prefix}_${randomBytes(4).toString("hex")}`,
      );
      const humans = await connectAll(server, names);
      try {
        await openKits(brain.port, humans);
        await inRwf(
          rcon,
          "gamerule minecraft:natural_health_regeneration false",
        );
        const teams = await playTogether(humans);
        // Five split three against two. A reward is only handed to a fighter
        // in a live match, so one of the two kills two of the three and the
        // third keeps the match going.
        const pair = teams.find(
          (team) => teams.filter((other) => other === team).length === 2,
        );
        const killer = humans.find((_, index) => teams[index] === pair);
        const victims = humans
          .filter((_, index) => teams[index] !== pair)
          .slice(0, 2);
        if (killer === undefined || victims.length !== 2) {
          throw new Error(`no pair against three in ${teams.join(", ")}`);
        }
        for (const victim of victims) {
          await kill(rcon, victim, killer);
        }
        await killer.log.until(
          /Killstreak of 2! Given a tracking compass!/u,
          30_000,
        );
      } finally {
        await inRwf(
          rcon,
          "gamerule minecraft:natural_health_regeneration true",
        );
        await disconnectAll(humans);
        await waitForLobby(rcon);
      }
    },
  );
});
