import { randomBytes } from "node:crypto";
import { Vec3 } from "vec3";
import { describe, expect } from "vitest";
import { test } from "./fixtures.ts";
import { waitUntil } from "./harness/bot.ts";
import {
  type RwfFeature,
  rwfFeatureFlags,
  setRwfFeatures,
} from "./harness/fake-brain.ts";
import {
  arrives,
  connectAll,
  dimension,
  disconnectAll,
  health,
  type Human,
  human,
  inRwf,
  inView,
  join,
  lobby,
  lobbyDimension,
  playTogether,
  teamOf,
  teleport,
  yard,
} from "./harness/rwf-humans.ts";
import { eventually, status, waitForLobby } from "./harness/rwf-match.ts";
import type { RconClient } from "#e2e/harness/rcon.ts";

/**
 * Red Warfare's match experience on the real server, each case under the
 * managed flags it needs: the map preview and the freeze before the start,
 * team chat, the death feed with assists, and the humans carried from one
 * match into the next without joining again. Voting needs a second staged
 * map, so the vote itself is covered by the domain and MockBukkit suites.
 */

/**
 * Runs `body` with the rwf feature flags `enabled`. Flags are read as each
 * match opens, so an operator's stop opens a fresh lobby under them; the
 * flags go off and the lobby opens afresh again afterwards.
 */
async function withFeatures(
  rcon: RconClient,
  port: number,
  enabled: readonly RwfFeature[],
  body: () => Promise<void>,
): Promise<void> {
  await setRwfFeatures(port, [...enabled]);
  try {
    await rcon.command("rwf admin stop");
    await waitForLobby(rcon);
    expect(await rcon.command("rwf admin status")).toContain(
      `matchFlow=${enabled.includes("the-storm-rwf-match-flow-enabled").toString()}`,
    );
    await body();
  } finally {
    await setRwfFeatures(port, []);
    await rcon.command("rwf admin stop");
    await waitForLobby(rcon);
  }
}

/**
 * `killers` take turns hitting `victim` with their swords in the yard until
 * the victim dies; the first hits `helperHits` times before the rest join in.
 */
async function kill(
  rcon: RconClient,
  victim: Human,
  killers: Human[],
  helperHits = 0,
): Promise<void> {
  const spots = [yard.duel[0], new Vec3(26.5, 65, 30.5)];
  await inRwf(rcon, "gamerule minecraft:natural_health_regeneration false");
  try {
    await teleport(rcon, victim.bot, yard.duel[1]);
    for (const [index, one] of killers.entries()) {
      const spot = spots[index];
      if (spot === undefined) {
        throw new Error("more killers than spots beside the victim");
      }
      await teleport(rcon, one.bot, spot);
      one.bot.setQuickBarSlot(1);
      await waitUntil(
        `${one.bot.username} sees ${victim.bot.username}`,
        () => inView(one.bot, victim.bot) !== undefined,
      );
    }
    const order = [
      ...Array.from({ length: helperHits }, () => killers[0]),
      ...Array.from({ length: 30 }, () => killers.at(-1)),
    ];
    for (const one of order) {
      if (one === undefined || (await health(rcon, victim.bot)) <= 0) {
        break;
      }
      const target = inView(one.bot, victim.bot);
      if (target === undefined) {
        break;
      }
      one.bot.attack(target);
      // Past the hit window, so every swing lands in full.
      await Bun.sleep(600);
    }
  } finally {
    await inRwf(rcon, "gamerule minecraft:natural_health_regeneration true");
  }
}

describe("The match experience behind its flags", () => {
  test(
    "the map previews, everyone freezes, team chat stays on the team, and the next match follows without joining again",
    { timeout: 240_000 },
    async ({ bot, secondBot, rcon, brain }) => {
      await waitForLobby(rcon);
      await withFeatures(rcon, brain.port, rwfFeatureFlags, async () => {
        const a = human(bot);
        const b = human(secondBot);
        await join(a);
        await join(b);

        // The lone map is chosen at once: it previews, then everyone freezes.
        await a.log.until(/Previewing Training Yard by /u, 30_000);
        await arrives(rcon, bot, dimension, yard.region);
        await a.log.until(
          /Get ready: the match starts in \d+ seconds\./u,
          15_000,
        );
        const frozenAt = bot.entity.position.clone();
        bot.setControlState("forward", true);
        await Bun.sleep(800);
        bot.setControlState("forward", false);
        expect(bot.entity.position.distanceTo(frozenAt)).toBeLessThan(0.5);
        await a.log.until(/The game has begun!/u, 15_000);
        const [teamA, teamB] = await Promise.all([
          teamOf(a.log),
          teamOf(b.log),
        ]);
        expect(teamA).not.toBe(teamB);

        // Plain chat goes to the speaker's team; a leading @ speaks to all.
        // (The client shows a player line's text; the channel tag is decoration.)
        bot.chat("hold the bomb");
        await a.log.until(/hold the bomb/u);
        secondBot.chat("@good luck everyone");
        await a.log.until(/good luck everyone/u);
        expect(b.log.has(/hold the bomb/u)).toBe(false);

        // A kill ends it: the feed names both, and the pair are carried over.
        const live = await status(rcon);
        const first = live.matchId;
        await kill(rcon, b, [a]);
        await a.log.until(
          new RegExp(
            `${secondBot.username} was murdered by ${bot.username}`,
            "u",
          ),
          20_000,
        );
        await b.log.until(/Your killer has [\d.]+ ❤ left\./u);
        await eventually(
          "the next match",
          async () => {
            const now = await status(rcon);
            return now.matchId !== first;
          },
          30_000,
        );
        const next = await status(rcon);
        expect(next.humans).toBe(2);
        await arrives(rcon, bot, lobbyDimension, lobby.region);
        a.log.lines.length = 0;
        b.log.lines.length = 0;
        await a.log.until(/The game has begun!/u, 60_000);
        await b.log.until(/The game has begun!/u, 60_000);
        expect(a.log.has(/joined the match/u)).toBe(false);
      });
    },
  );

  test(
    "a death names the killer, and whoever helped is told their assist",
    { timeout: 180_000 },
    async ({ rcon, server, brain }) => {
      await waitForLobby(rcon);
      const names = ["k", "h", "v"].map(
        (prefix) => `${prefix}_${randomBytes(4).toString("hex")}`,
      );
      const humans = await connectAll(server, names);
      try {
        await withFeatures(
          rcon,
          brain.port,
          [
            "the-storm-rwf-death-feed-enabled",
            "the-storm-rwf-match-flow-enabled",
          ],
          async () => {
            const teams = await playTogether(humans);
            // Three humans split two against one: the one is the victim.
            const pairs = humans.map((one, index) => ({
              one,
              team: teams[index],
            }));
            const victim = pairs.find(
              ({ team }) => teams.filter((t) => t === team).length === 1,
            );
            if (victim === undefined) {
              throw new Error(`no lone team in ${teams.join(", ")}`);
            }
            const [helper, killer] = pairs
              .filter((pair) => pair !== victim)
              .map(({ one }) => one);
            if (helper === undefined || killer === undefined) {
              throw new Error("the pair is missing");
            }
            await kill(rcon, victim.one, [helper, killer], 2);

            await killer.log.until(
              new RegExp(
                `${victim.one.bot.username} was murdered by ${killer.bot.username}`,
                "u",
              ),
              20_000,
            );
            await helper.log.until(/Scored a kill assist worth 0\.\d!/u);
          },
        );
      } finally {
        await disconnectAll(humans);
      }
    },
  );

  test(
    "falling off the lobby deck puts a member back at its spawn, unhurt",
    { timeout: 60_000 },
    async ({ bot, rcon }) => {
      await waitForLobby(rcon);
      const a = human(bot);
      await join(a);
      await waitUntil(
        "the lobby's spawn",
        () => bot.entity.position.distanceTo(lobby.spawn) < 1.5,
      );
      await rcon.command(
        `execute in ${lobbyDimension} run minecraft:tp ${bot.username} ${lobby.spawn.x.toString()} 20 ${lobby.spawn.z.toString()}`,
      );
      await waitUntil(
        "back at the lobby's spawn",
        () => bot.entity.position.distanceTo(lobby.spawn) < 1.5,
      );
      expect(bot.health).toBe(20);
      bot.chat("/rwf leave");
      await waitForLobby(rcon);
    },
  );
});
