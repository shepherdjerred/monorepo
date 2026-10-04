import { randomBytes } from "node:crypto";
import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import { describe, expect } from "vitest";
import { z } from "zod";
import { test } from "./fixtures.ts";
import {
  connectBot,
  disconnectBot,
  waitForMessage,
  waitUntil,
} from "./harness/bot.ts";
import { rwfTestSettings } from "./harness/rwf-settings.ts";
import type { ServerInfo } from "./harness/server.ts";
import {
  eventually,
  type MatchRow,
  settledMatch,
  sorted,
  status,
  transcript,
  type Transcript,
  waitForLobby,
} from "./harness/rwf-match.ts";
import { stormDataFile } from "./harness/storm-data.ts";
import type { RconClient } from "#e2e/harness/rcon.ts";

/**
 * Red Warfare Search and Destroy on the real server, humans only (rwfbots is
 * off): two mineflayer players join, the countdown fires, the match goes live
 * with kits and the attack-speed modifier, the rules' damage and hit window
 * replace the server's, hunger never drops, a fuse arms the enemy bomb, the
 * owners either die to it or defuse it, the winner is paid through the outbox,
 * a pseudonymous recording is written and everyone's belongings come back.
 *
 * The pinned rules run as shipped: arming alone takes nine seconds of clicks
 * and the fuse burns for sixty, so the detonation case waits the real minute.
 */

const dimension = `minecraft:${rwfTestSettings.world}`;

type Team = "Red" | "Blue";

/** The training yard's bombs, one in each base, and a clear spot for a duel. */
const yard = {
  bombs: {
    Red: new Vec3(8, 65, 31),
    Blue: new Vec3(55, 65, 31),
  },
  /** Beside each bomb, inside its base, where a fuse reaches it. */
  beside: {
    Red: { attacker: new Vec3(9.5, 65, 31.5), owner: new Vec3(6.5, 65, 31.5) },
    Blue: {
      attacker: new Vec3(53.5, 65, 31.5),
      owner: new Vec3(57.5, 65, 31.5),
    },
  },
  duel: [new Vec3(24.5, 65, 30.5), new Vec3(25.5, 65, 30.5)],
  /** The glass platform under the open ceiling. */
  lobby: new Vec3(31.5, 78, 31.5),
  /** Where the dead and watchers look down from. */
  spectator: new Vec3(31.5, 76, 31.5),
} as const;

// Trooper's Sharpness I iron sword on full iron: (6 + 1.25) x (1 - 15/25).
const trooperHit = 2.9;
// CombatRules.ATTACK_SPEED_MODIFIER: added so the 1.9 cooldown never applies.
const attackSpeedModifierValue = 200;
const startingBalance = 500;

/** A player and their transcript. */
type Human = { bot: Bot; log: Transcript };

function human(bot: Bot): Human {
  return { bot, log: transcript(bot) };
}

function count(bot: Bot, item: string): number {
  return bot.inventory
    .items()
    .filter((stack) => stack.name === item)
    .reduce((total, stack) => total + stack.count, 0);
}

function hotbar(bot: Bot, slot: number): string | undefined {
  // Hotbar slots are 36-44 in the player inventory window.
  return bot.inventory.slots[36 + slot]?.name;
}

function armor(bot: Bot): (string | undefined)[] {
  return [5, 6, 7, 8].map((slot) => bot.inventory.slots[slot]?.name);
}

function coords(at: Vec3): string {
  return `${at.x.toString()} ${at.y.toString()} ${at.z.toString()}`;
}

// ---- RCON ----------------------------------------------------------------

/** Runs `command` with the rwf world as the executing dimension. */
async function inRwf(rcon: RconClient, command: string): Promise<string> {
  return rcon.command(`execute in ${dimension} run ${command}`);
}

async function teleport(rcon: RconClient, bot: Bot, to: Vec3): Promise<void> {
  await inRwf(rcon, `tp ${bot.username} ${coords(to)}`);
  await waitUntil(
    `${bot.username} arrives at ${coords(to)}`,
    () => bot.entity.position.distanceTo(to) < 0.5,
  );
}

function numberAfter(pattern: RegExp, what: string) {
  return z.string().transform((text, context) => {
    const match = pattern.exec(text.trim());
    if (match?.groups?.["value"] === undefined) {
      context.addIssue({ code: "custom", message: `no ${what} in ${text}` });
      return z.NEVER;
    }
    return Number(match.groups["value"]);
  });
}

const HealthSchema = numberAfter(/: (?<value>-?[\d.]+)f$/u, "health");

const EntityPosSchema = z.string().transform((text, context) => {
  const match = /\[(?<x>-?[\d.]+)d, (?<y>-?[\d.]+)d, (?<z>-?[\d.]+)d\]$/u.exec(
    text.trim(),
  );
  if (match?.groups === undefined) {
    context.addIssue({ code: "custom", message: `no position in ${text}` });
    return z.NEVER;
  }
  return new Vec3(
    Number(match.groups["x"]),
    Number(match.groups["y"]),
    Number(match.groups["z"]),
  );
});

/**
 * The armed bomb is primed TNT floating on its site: one entity, within a
 * block of the TNT block's centre, and still there a moment later.
 */
async function expectPrimedOnSite(rcon: RconClient, site: Vec3): Promise<void> {
  const center = site.offset(0.5, 0.5, 0.5);
  expect(
    await inRwf(rcon, "execute if entity @e[type=minecraft:tnt]"),
  ).toContain("Count: 1");
  expect(
    await inRwf(rcon, `execute if block ${coords(site)} minecraft:air`),
  ).toContain("Test passed");
  for (const _ of [0, 1]) {
    await Bun.sleep(1000);
    const at = EntityPosSchema.parse(
      await inRwf(rcon, "data get entity @e[type=minecraft:tnt,limit=1] Pos"),
    );
    expect(at.distanceTo(center)).toBeLessThan(1);
  }
}

async function health(rcon: RconClient, bot: Bot): Promise<number> {
  return HealthSchema.parse(
    await rcon.command(`data get entity ${bot.username} Health`),
  );
}

/**
 * The value of the match's attack-speed modifier on the player, or undefined
 * when they do not carry it. The attribute's total also moves with the held
 * weapon, so the modifier itself is what is read.
 */
async function attackSpeedModifier(
  rcon: RconClient,
  bot: Bot,
): Promise<number | undefined> {
  const reply = await rcon.command(
    `attribute ${bot.username} minecraft:attack_speed modifier value get thestorm:rwf_attack_speed`,
  );
  const value = /is (?<value>-?[\d.]+)$/u.exec(reply.trim())?.groups?.["value"];
  if (value !== undefined) {
    return Number(value);
  }
  if (!reply.includes("thestorm:rwf_attack_speed")) {
    throw new Error(`unexpected attribute reply: ${reply}`);
  }
  return undefined;
}

// ---- players --------------------------------------------------------------

/** Something to come back to: three diamonds the match must snapshot and restore. */
async function giveDiamonds(rcon: RconClient, bot: Bot): Promise<void> {
  await rcon.command(`give ${bot.username} minecraft:diamond 3`);
  await waitUntil(
    `${bot.username} holds diamonds`,
    () => count(bot, "diamond") === 3,
  );
}

async function join({ bot, log }: Human): Promise<void> {
  bot.chat("/rwf join");
  await log.until(new RegExp(`${bot.username} joined the match`, "u"));
}

/** Both join and the match goes live; returns their teams, which differ. */
async function startMatch(
  rcon: RconClient,
  a: Human,
  b: Human,
): Promise<[Team, Team]> {
  await giveDiamonds(rcon, a.bot);
  await giveDiamonds(rcon, b.bot);
  await join(a);
  await join(b);
  await a.log.until(/The game has begun!/u, 30_000);
  await b.log.until(/The game has begun!/u, 30_000);
  const teams = await Promise.all([teamOf(a.log), teamOf(b.log)]);
  expect(teams[0]).not.toBe(teams[1]);
  return teams;
}

async function teamOf(log: Transcript): Promise<Team> {
  const seen = await log.until(/You are in (?<team>Red|Blue) Team\./u, 30_000);
  return z.enum(["Red", "Blue"]).parse(seen.groups?.["team"]);
}

function enemy(team: Team): Team {
  return team === "Red" ? "Blue" : "Red";
}

/** Back where they stood, with what they held, and nothing of the match. */
function expectRestored(bot: Bot, home: Vec3): void {
  expect(count(bot, "diamond")).toBe(3);
  expect(count(bot, "blaze_powder")).toBe(0);
  expect(count(bot, "iron_sword")).toBe(0);
  expect(armor(bot)).toEqual([undefined, undefined, undefined, undefined]);
  expect(bot.entity.position.distanceTo(home)).toBeLessThan(1);
}

async function waitRestored(bot: Bot, home: Vec3): Promise<void> {
  await waitUntil(
    `${bot.username} gets their belongings back`,
    () =>
      count(bot, "diamond") === 3 &&
      count(bot, "blaze_powder") === 0 &&
      bot.entity.position.distanceTo(home) < 1,
    20_000,
  );
  expectRestored(bot, home);
}

async function balance(bot: Bot): Promise<number> {
  const reply = waitForMessage(bot, /Balance: (?<amount>\d+) crystals?/u);
  bot.chat("/balance");
  const seen = await reply;
  return Number(seen.groups?.["amount"]);
}

/** Trooper by default: the fuse locked in slot 0, the sword next to it, golden apples, full iron. */
async function expectKitted(rcon: RconClient, bot: Bot): Promise<void> {
  await waitUntil(
    `${bot.username} is kitted`,
    () => hotbar(bot, 0) === "blaze_powder",
  );
  expect(hotbar(bot, 1)).toBe("iron_sword");
  expect(hotbar(bot, 2)).toBe("golden_apple");
  expect(armor(bot)).toEqual([
    "iron_helmet",
    "iron_chestplate",
    "iron_leggings",
    "iron_boots",
  ]);
  expect(await attackSpeedModifier(rcon, bot)).toBe(attackSpeedModifierValue);
}

/**
 * The rules' damage and hit window replace the server's: a sword swing lands
 * exactly 2.9, an immediate second swing is blocked, a third after half the
 * no-damage window lands in full. Regeneration is paused to read exact values.
 */
async function duel(
  rcon: RconClient,
  attacker: Bot,
  victim: Bot,
): Promise<void> {
  await inRwf(rcon, "gamerule minecraft:natural_health_regeneration false");
  try {
    await teleport(rcon, attacker, yard.duel[0]);
    await teleport(rcon, victim, yard.duel[1]);
    await waitUntil(
      "the attacker sees the victim",
      () => attacker.players[victim.username]?.entity !== undefined,
    );
    attacker.setQuickBarSlot(1);
    await waitUntil(
      "the sword is in hand",
      () => attacker.heldItem?.name === "iron_sword",
    );
    const target = attacker.players[victim.username]?.entity;
    if (target === undefined) {
      throw new Error("the victim entity vanished");
    }
    expect(await health(rcon, victim)).toBe(20);
    attacker.attack(target);
    await Bun.sleep(100);
    attacker.attack(target);
    await Bun.sleep(300);
    expect(await health(rcon, victim)).toBeCloseTo(20 - trooperHit, 1);
    await Bun.sleep(400);
    attacker.attack(target);
    await Bun.sleep(300);
    expect(await health(rcon, victim)).toBeCloseTo(20 - 2 * trooperHit, 1);
  } finally {
    await inRwf(rcon, "gamerule minecraft:natural_health_regeneration true");
  }
}

/**
 * Hunger never drops, even under the Hunger effect: saturation drains as in
 * vanilla, the food level change is refused.
 */
async function expectHungerHeld(rcon: RconClient, bot: Bot): Promise<void> {
  await rcon.command(
    `effect give ${bot.username} minecraft:hunger 15 255 true`,
  );
  await waitUntil("saturation drains", () => bot.foodSaturation <= 0, 12_000);
  await Bun.sleep(1500);
  expect(bot.food).toBe(20);
  await rcon.command(`effect clear ${bot.username} minecraft:hunger`);
}

/** Repeats `act` every 300 ms (inside the 750 ms click gap) until `pattern` is announced. */
async function clickUntil(
  log: Transcript,
  pattern: RegExp,
  act: () => Promise<void>,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!log.has(pattern)) {
    if (Date.now() > deadline) {
      throw new Error(
        `never saw ${pattern.toString()} after clicking; saw:\n${log.lines.join("\n")}`,
      );
    }
    await act();
    await Bun.sleep(300);
  }
}

async function holdFuse(bot: Bot, lookAt: Vec3): Promise<void> {
  bot.setQuickBarSlot(0);
  await waitUntil(
    "the fuse is in hand",
    () => bot.heldItem?.name === "blaze_powder",
  );
  await bot.lookAt(lookAt, true);
}

/** The attacker stands beside the enemy bomb and clicks it with the fuse until it arms. */
async function armBomb(
  rcon: RconClient,
  { bot, log }: Human,
  owner: Team,
): Promise<void> {
  const site = yard.bombs[owner];
  await teleport(rcon, bot, yard.beside[owner].attacker);
  await waitUntil(
    "the TNT block is in view",
    () => bot.blockAt(site)?.name === "tnt",
  );
  await holdFuse(bot, site.offset(0.5, 0.5, 0.5));
  await clickUntil(
    log,
    new RegExp(`${enemy(owner)} Team just armed ${owner} Team's bomb!`, "u"),
    async () => {
      const block = bot.blockAt(site);
      if (block !== null && block.name === "tnt") {
        await bot.activateBlock(block);
      }
    },
    20_000,
  );
}

/** An owner clicks the primed TNT with the fuse until the bomb is defused. */
async function defuseBomb(
  rcon: RconClient,
  { bot, log }: Human,
  team: Team,
): Promise<void> {
  const center = yard.bombs[team].offset(0.5, 0.5, 0.5);
  await teleport(rcon, bot, yard.beside[team].owner);
  const primed = () =>
    Object.values(bot.entities).find(
      (entity) =>
        entity.name === "tnt" && entity.position.distanceTo(center) < 1.5,
    );
  await waitUntil("the primed TNT is in view", () => primed() !== undefined);
  await holdFuse(bot, center);
  await clickUntil(
    log,
    new RegExp(`${team} Team has just defused their bomb!`, "u"),
    async () => {
      const entity = primed();
      if (entity !== undefined) {
        await bot.activateEntity(entity);
      }
    },
    20_000,
  );
}

// ---- the database and recordings --------------------------------------------

/** The recording is a non-empty gzip whose rows name the match and nobody else. */
async function expectRecording(
  server: ServerInfo,
  outDir: string,
  match: MatchRow,
  names: string[],
): Promise<void> {
  if (match.recording_file === null) {
    throw new Error("the match has no recording file");
  }
  expect(match.recording_file).toMatch(
    new RegExp(
      String.raw`^rwf-recordings/\d{4}/\d{2}/\d{2}/${match.id}\.rwfrec\.gz$`,
      "u",
    ),
  );
  const file = await stormDataFile(server, match.recording_file, outDir);
  if (file === undefined) {
    throw new Error(`${match.recording_file} is missing on the server`);
  }
  const bytes = new Uint8Array(await Bun.file(file).arrayBuffer());
  expect(bytes.length).toBeGreaterThan(0);
  expect(bytes.length).toBe(match.recording_bytes);
  expect([bytes[0], bytes[1]]).toEqual([0x1f, 0x8b]);
  const text = new TextDecoder().decode(Bun.gunzipSync(bytes));
  expect(text).toContain(match.id);
  for (const name of names) {
    expect(text).not.toContain(name);
  }
  expect(match.dropped_frames).toBe(0);
}

/** The outbox paid the win and the loss, and the recording was written. */
async function expectPaidWin(
  server: ServerInfo,
  matchId: string,
  { winner, loser, names }: { winner: Team; loser: Team; names: string[] },
): Promise<void> {
  const settled = await settledMatch(server, matchId);
  expect(settled.match.winner).toBe(winner.toUpperCase());
  expect(settled.match.humans).toBe(2);
  expect(settled.match.bots).toBe(0);
  expect(settled.match.map).toBe("training-yard");
  expect(settled.players).toHaveLength(2);
  expect(
    sorted(
      settled.players.map((row) => [
        row.team,
        row.kit,
        row.result,
        row.credits_owed,
        row.payout_status,
        row.credits_paid,
      ]),
    ),
  ).toEqual(
    sorted([
      [winner.toUpperCase(), "trooper", "WIN", 3, "PAID", 3],
      [loser.toUpperCase(), "trooper", "LOSE", 1, "PAID", 1],
    ]),
  );
  expect(
    settled.players.find((row) => row.team === loser.toUpperCase())?.deaths,
  ).toBe(1);
  await expectRecording(server, settled.outDir, settled.match, names);
}

/**
 * The fuse burns down with its warnings, the bomb goes off, its owners die,
 * the other team wins and both are told their credits. Returns whether the
 * owner was seen spectating during the end screen; the window is short, so it
 * is observed here and asserted once the rest of the match has been checked.
 */
async function awaitDetonation(
  rcon: RconClient,
  { attacker, owner }: { attacker: Human; owner: Human },
  teamA: Team,
  teamB: Team,
): Promise<{ spectated: boolean }> {
  let died = false;
  owner.bot.once("death", () => {
    died = true;
  });
  await attacker.log.until(
    new RegExp(`30 seconds left until ${teamB} Team's bomb goes off!`, "u"),
    45_000,
  );
  await attacker.log.until(
    new RegExp(`${teamB} Team's bomb exploded!`, "u"),
    45_000,
  );
  // The explosion killed the owner, who should respawn at once as a spectator
  // (the client only learns game modes from respawns, so the server is asked).
  await waitUntil("the owner dies", () => died, 5000);
  let spectated = false;
  const deadline = Date.now() + 2500;
  while (!spectated && Date.now() < deadline) {
    const spectating = await rcon.command(
      `execute if entity @a[name=${owner.bot.username},gamemode=spectator]`,
    );
    spectated = spectating.includes("Test passed");
    await Bun.sleep(100);
  }
  await attacker.log.until(new RegExp(`${teamB} Team was defeated!`, "u"));
  await attacker.log.until(new RegExp(`${teamA} Team wins!`, "u"));
  await owner.log.until(new RegExp(`${teamA} Team wins!`, "u"));
  await attacker.log.until(/You earned 3 credits\./u);
  await owner.log.until(/You earned 1 credits\./u);
  return { spectated };
}

async function connect(server: ServerInfo, username: string): Promise<Bot> {
  return connectBot({ host: server.host, port: server.gamePort, username });
}

// ---- the matches ---------------------------------------------------------------

describe("Search and Destroy with humans only", () => {
  test(
    "a bomb armed with the fuse detonates, eliminates its owners and pays the winners",
    { timeout: 200_000 },
    async ({ bot, secondBot, rcon, server }) => {
      await waitForLobby(rcon);
      const a = human(bot);
      const b = human(secondBot);
      await giveDiamonds(rcon, bot);
      await giveDiamonds(rcon, secondBot);
      const home = bot.entity.position.clone();
      const homeB = secondBot.entity.position.clone();

      await join(a);
      await a.log.until(/Matches are recorded/u);
      // Emptied onto the lobby platform: nothing but what the match gives.
      expect(count(bot, "diamond")).toBe(0);
      await waitUntil(
        "the lobby platform",
        () => bot.entity.position.distanceTo(yard.lobby) < 1.5,
      );
      await a.log.until(/The game will begin in \d+ seconds\./u);
      await join(b);
      await a.log.until(/The game has begun!/u, 30_000);
      await b.log.until(/The game has begun!/u, 30_000);
      const [teamA, teamB] = await Promise.all([teamOf(a.log), teamOf(b.log)]);
      expect(teamA).not.toBe(teamB);

      const live = await status(rcon);
      expect(live.phase).toBe("Live");
      expect(live.map).toBe("training-yard");
      expect(live.humans).toBe(2);
      expect(live.bots).toBe(0);
      expect(live.roster).toBe("absent");
      await expectKitted(rcon, bot);
      await expectKitted(rcon, secondBot);

      await duel(rcon, bot, secondBot);

      // Nine seconds of fuse clicks arm the enemy bomb.
      await armBomb(rcon, a, teamB);
      await b.log.until(
        new RegExp(`${teamA} Team just armed ${teamB} Team's bomb!`, "u"),
      );
      await expectPrimedOnSite(rcon, yard.bombs[teamB]);

      await expectHungerHeld(rcon, secondBot);
      const { spectated } = await awaitDetonation(
        rcon,
        { attacker: a, owner: b },
        teamA,
        teamB,
      );

      // After the end screen everyone is restored and the modifier is gone.
      await waitRestored(bot, home);
      await waitRestored(secondBot, homeB);
      expect(await attackSpeedModifier(rcon, bot)).toBeUndefined();
      expect(await attackSpeedModifier(rcon, secondBot)).toBeUndefined();
      expect(
        await rcon.command(
          `execute if entity @a[name=${secondBot.username},gamemode=survival]`,
        ),
      ).toContain("Test passed");

      // The payout outbox paid through the economy: 3 for the win, 1 for the loss.
      await eventually(
        "the winner's payout",
        async () => (await balance(bot)) === startingBalance + 3,
        20_000,
      );
      expect(await balance(secondBot)).toBe(startingBalance + 1);
      await expectPaidWin(server, live.matchId, {
        winner: teamA,
        loser: teamB,
        names: [bot.username, secondBot.username],
      });
      // The bomb's victim watched the end screen from spectator mode.
      expect(spectated).toBe(true);
      await waitForLobby(rcon);
    },
  );

  test(
    "owners defuse their armed bomb, and leaving restores a player at once",
    { timeout: 120_000 },
    async ({ bot, secondBot, rcon, server }) => {
      await waitForLobby(rcon);
      const a = human(bot);
      const b = human(secondBot);
      const home = bot.entity.position.clone();
      const homeB = secondBot.entity.position.clone();
      const [teamA, teamB] = await startMatch(rcon, a, b);
      const live = await status(rcon);
      expect(live.phase).toBe("Live");

      await armBomb(rcon, a, teamB);
      await b.log.until(
        new RegExp(`${teamA} Team just armed ${teamB} Team's bomb!`, "u"),
      );
      await expectPrimedOnSite(rcon, yard.bombs[teamB]);
      await defuseBomb(rcon, b, teamB);
      await a.log.until(
        new RegExp(`${teamB} Team has just defused their bomb!`, "u"),
      );
      // The TNT block is back and the primed entity gone.
      await eventually("the TNT block returns", async () => {
        const result = await inRwf(
          rcon,
          `execute if block ${coords(yard.bombs[teamB])} minecraft:tnt`,
        );
        return result.includes("Test passed");
      });
      expect(
        await inRwf(rcon, "execute if entity @e[type=minecraft:tnt]"),
      ).toContain("Test failed");

      // Leaving a live match restores the leaver at once and hands the win to
      // the other team; a match this short pays nobody.
      bot.chat("/rwf leave");
      await b.log.until(
        new RegExp(String.raw`${bot.username} left the match\.`, "u"),
      );
      await waitRestored(bot, home);
      expect(await attackSpeedModifier(rcon, bot)).toBeUndefined();
      await b.log.until(new RegExp(`${teamA} Team was defeated!`, "u"));
      await b.log.until(new RegExp(`${teamB} Team wins!`, "u"));
      await waitRestored(secondBot, homeB);
      expect(await attackSpeedModifier(rcon, secondBot)).toBeUndefined();
      expect(a.log.has(/You earned/u)).toBe(false);
      expect(b.log.has(/You earned/u)).toBe(false);
      expect(await balance(bot)).toBe(startingBalance);
      expect(await balance(secondBot)).toBe(startingBalance);

      const settled = await settledMatch(server, live.matchId);
      expect(settled.match.winner).toBe(teamB.toUpperCase());
      expect(settled.match.humans).toBe(2);
      expect(
        sorted(
          settled.players.map((row) => [
            row.team,
            row.result,
            row.credits_owed,
            row.payout_status,
            row.credits_paid,
          ]),
        ),
      ).toEqual(
        sorted([
          [teamA.toUpperCase(), "LEFT", 0, "NONE", 0],
          [teamB.toUpperCase(), "WIN", 0, "NONE", 0],
        ]),
      );
      await expectRecording(server, settled.outDir, settled.match, [
        bot.username,
        secondBot.username,
      ]);
      await waitForLobby(rcon);
    },
  );
});

describe("Search and Destroy without enough humans", () => {
  test(
    "a lone human's match ends at once unpaid with no bots, and a disconnect cancels the countdown",
    { timeout: 120_000 },
    async ({ rcon, server }) => {
      await waitForLobby(rcon);
      const username = `c_${randomBytes(4).toString("hex")}`;
      let online: Bot | undefined = await connect(server, username);
      try {
        const first = human(online);
        await giveDiamonds(rcon, online);
        const home = online.entity.position.clone();
        await join(first);
        await first.log.until(/The game will begin in \d+ seconds\./u);
        // With rwfbots off nobody fills the other team: standings decide the
        // moment the match goes live, so the no-humans abort never gets a turn.
        await first.log.until(/The game has begun!/u, 30_000);
        const team = await teamOf(first.log);
        await first.log.until(
          new RegExp(`${enemy(team)} Team was defeated!`, "u"),
        );
        await first.log.until(new RegExp(`${team} Team wins!`, "u"));
        const ended = await status(rcon);
        expect(ended.phase).toBe("Ended");
        expect(ended.humans).toBe(1);
        expect(ended.bots).toBe(0);
        expect(ended.roster).toBe("absent");
        await waitRestored(online, home);
        expect(first.log.has(/You earned/u)).toBe(false);
        expect(await balance(online)).toBe(startingBalance);
        const settled = await settledMatch(server, ended.matchId);
        expect(settled.match.winner).toBe(team.toUpperCase());
        expect(settled.match.humans).toBe(1);
        expect(settled.match.bots).toBe(0);
        expect(
          settled.players.map((row) => [
            row.result,
            row.credits_owed,
            row.payout_status,
          ]),
        ).toEqual([["WIN", 0, "NONE"]]);
        await waitForLobby(rcon);

        // Reconnecting proves the restored belongings reached player data, and
        // only then may the player join again.
        await disconnectBot(online);
        online = undefined;
        online = await connect(server, username);
        const second = human(online);
        await waitUntil(
          "belongings persisted",
          () => count(second.bot, "diamond") === 3,
        );
        await join(second);
        await second.log.until(/The game will begin in \d+ seconds\./u);
        const counting = await status(rcon);
        expect(counting.phase).toBe("Countdown");
        // A disconnect during the countdown restores the player before the
        // server saves them, and the countdown stops for want of players.
        await disconnectBot(online);
        online = undefined;
        await eventually("the countdown to stop", async () => {
          const now = await status(rcon);
          return now.phase === "Lobby" && now.humans === 0;
        });
        online = await connect(server, username);
        const third = online;
        await waitUntil(
          "belongings restored on quit persisted",
          () => count(third, "diamond") === 3,
        );
        expectRestored(third, home);
        expect(await attackSpeedModifier(rcon, third)).toBeUndefined();
      } finally {
        if (online !== undefined) {
          await disconnectBot(online);
        }
      }
    },
  );
});

describe("Watching Search and Destroy", () => {
  test(
    "a watcher sees a match through every phase without counting, and leaving restores them",
    { timeout: 120_000 },
    async ({ bot, secondBot, rcon }) => {
      await waitForLobby(rcon);
      const watcher = human(bot);
      const player = human(secondBot);
      await giveDiamonds(rcon, bot);
      await giveDiamonds(rcon, secondBot);
      const home = bot.entity.position.clone();
      const homeB = secondBot.entity.position.clone();

      bot.chat("/rwf spectate");
      await watcher.log.until(/You are watching Search and Destroy\./u);
      await waitUntil(
        "the watcher in spectator mode at the spectator point",
        () =>
          bot.game.gameMode === "spectator" &&
          bot.entity.position.distanceTo(yard.spectator) < 1.5,
      );
      expect(count(bot, "diamond")).toBe(0);
      expect(await attackSpeedModifier(rcon, bot)).toBeUndefined();
      expect(await rcon.command("rwf admin status")).toContain("Watchers: 1");

      // A member may not watch; the watcher never counts as a human.
      await join(player);
      secondBot.chat("/rwf spectate");
      await player.log.until(/leave it with \/rwf leave before watching/u);
      await player.log.until(/The game has begun!/u, 30_000);
      const team = await teamOf(player.log);
      await player.log.until(new RegExp(`${team} Team wins!`, "u"));
      const ended = await status(rcon);
      expect(ended.humans).toBe(1);
      await waitRestored(secondBot, homeB);
      await waitForLobby(rcon);

      // The watcher stays through the end and the reset, at the spectator point.
      expect(bot.game.gameMode).toBe("spectator");
      expect(bot.entity.position.distanceTo(yard.spectator)).toBeLessThan(1.5);
      expect(await rcon.command("rwf admin status")).toContain("Watchers: 1");

      bot.chat("/rwf leave");
      await waitRestored(bot, home);
      await waitUntil(
        "the watcher back in survival",
        () => bot.game.gameMode === "survival",
      );
      expect(await rcon.command("rwf admin status")).toContain("Watchers: 0");
    },
  );
});
