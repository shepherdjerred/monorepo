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
import { setRwfDenied } from "./harness/fake-brain.ts";
import { rwfTestSettings } from "./harness/rwf-settings.ts";
import { expectSampleCadence, readRecording } from "./harness/rwfbots.ts";
import { serverLogs } from "@shepherdjerred/mc-harness/providers/docker/docker-cli.ts";
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
  /** The nuke's TNT on its 3x3 gold pedestal, and a spot on the pedestal beside it. */
  nuke: new Vec3(31, 66, 31),
  besideNuke: new Vec3(30.5, 66, 31.5),
  /** A floor block in the red base's corner. */
  floor: new Vec3(2, 64, 2),
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
/** The suite's daily cap: one win's 3 credits. */
const rwfDailyCap = z.number().int().positive().parse(rwfTestSettings.dailyCap);

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

/**
 * Joins once the player's last restore is confirmed: a fresh login retires it
 * a moment after joining the server, and until then `/rwf join` is refused.
 */
async function joinRecovered({ bot, log }: Human): Promise<void> {
  const joined = new RegExp(`${bot.username} joined the match`, "u");
  const pending =
    /Your restored belongings must be saved before another match/u;
  const deadline = Date.now() + 15_000;
  for (;;) {
    const refusals = log.all(pending).length;
    bot.chat("/rwf join");
    await eventually(
      `${bot.username}'s join to be answered`,
      async () => log.has(joined) || log.all(pending).length > refusals,
      10_000,
    );
    if (log.has(joined)) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(`${bot.username}'s restore never finished`);
    }
    await Bun.sleep(500);
  }
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

/**
 * Everyone joins one countdown (inside its six seconds) and the match goes
 * live; returns their teams in order. Transcripts start afresh, so a second
 * match reads only its own lines.
 */
async function playTogether(humans: Human[]): Promise<Team[]> {
  for (const { log } of humans) {
    log.lines.length = 0;
  }
  for (const one of humans) {
    await joinRecovered(one);
  }
  for (const { log } of humans) {
    await log.until(/The game has begun!/u, 30_000);
  }
  return Promise.all(humans.map(async ({ log }) => teamOf(log)));
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

/** A member climbs the gold pedestal and clicks the nuke with the fuse until it arms. */
async function armNuke(
  rcon: RconClient,
  { bot, log }: Human,
  team: Team,
): Promise<void> {
  await teleport(rcon, bot, yard.besideNuke);
  await waitUntil(
    "the nuke is in view",
    () => bot.blockAt(yard.nuke)?.name === "tnt",
  );
  await holdFuse(bot, yard.nuke.offset(0.5, 0.5, 0.5));
  await clickUntil(
    log,
    new RegExp(`${team} Team just armed a nuke!`, "u"),
    async () => {
      const block = bot.blockAt(yard.nuke);
      if (block !== null && block.name === "tnt") {
        await bot.activateBlock(block);
      }
    },
    20_000,
  );
}

const AbsorptionSchema = numberAfter(/: (?<value>-?[\d.]+)f$/u, "absorption");

async function absorption(rcon: RconClient, bot: Bot): Promise<number> {
  return AbsorptionSchema.parse(
    await rcon.command(`data get entity ${bot.username} AbsorptionAmount`),
  );
}

/** The hotbar slot (0-8) holding `item`. */
function hotbarSlotOf(bot: Bot, item: string): number {
  const slot = [0, 1, 2, 3, 4, 5, 6, 7, 8].find(
    (index) => hotbar(bot, index) === item,
  );
  if (slot === undefined) {
    throw new Error(`${bot.username} has no ${item} in the hotbar`);
  }
  return slot;
}

/** Holds `item` from the hotbar. */
async function hold(bot: Bot, item: string): Promise<void> {
  bot.setQuickBarSlot(hotbarSlotOf(bot, item));
  await waitUntil(`${item} in hand`, () => bot.heldItem?.name === item);
}

/** One right click into the air with what is in hand. */
function rightClick(bot: Bot): void {
  bot.activateItem();
  bot.deactivateItem();
}

/** How often the server log says the yard was found damaged and pasted again. */
function pastes(logs: string): number {
  return logs.split("Map training-yard differs from its schematic; pasting it")
    .length;
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
  // Version 2: each human's frames come with an input row every tick.
  const recording = readRecording(
    text.split("\n").filter((line) => line !== ""),
  );
  expect(
    [...recording.roster.values()].filter((entry) => !entry.bot),
  ).toHaveLength(names.length);
  expectSampleCadence(recording);
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

describe("Healing in Search and Destroy", () => {
  test(
    "steak heals eight at once and is refused at full health, and a golden apple eats as vanilla",
    { timeout: 120_000 },
    async ({ bot, secondBot, rcon }) => {
      await waitForLobby(rcon);
      const a = human(bot);
      const b = human(secondBot);
      const home = bot.entity.position.clone();
      const homeB = secondBot.entity.position.clone();
      const [teamA, teamB] = await startMatch(rcon, a, b);
      await expectKitted(rcon, bot);
      // Regeneration is paused so every health change is the food's own.
      await inRwf(rcon, "gamerule minecraft:natural_health_regeneration false");
      try {
        await rcon.command(`give ${bot.username} minecraft:cooked_beef 2`);
        await waitUntil("the steak", () => count(bot, "cooked_beef") === 2);
        await hold(bot, "cooked_beef");
        expect(await health(rcon, bot)).toBe(20);
        rightClick(bot);
        await a.log.until(/You are too healthy to eat that\./u);
        expect(count(bot, "cooked_beef")).toBe(2);

        await rcon.command(`damage ${bot.username} 10 minecraft:out_of_world`);
        await eventually(
          "the damage",
          async () => (await health(rcon, bot)) === 10,
        );
        rightClick(bot);
        await eventually(
          "one steak to heal eight",
          async () => (await health(rcon, bot)) === 18,
          5000,
        );
        await waitUntil(
          "one steak eaten",
          () => count(bot, "cooked_beef") === 1,
        );

        await hold(bot, "golden_apple");
        expect(await absorption(rcon, bot)).toBe(0);
        await bot.consume();
        await waitUntil(
          "one golden apple eaten",
          () => count(bot, "golden_apple") === 2,
        );
        expect(await absorption(rcon, bot)).toBe(4);
      } finally {
        await inRwf(
          rcon,
          "gamerule minecraft:natural_health_regeneration true",
        );
      }

      bot.chat("/rwf leave");
      await waitRestored(bot, home);
      expect(count(bot, "cooked_beef")).toBe(0);
      await b.log.until(new RegExp(`${teamA} Team was defeated!`, "u"));
      await b.log.until(new RegExp(`${teamB} Team wins!`, "u"));
      await waitRestored(secondBot, homeB);
      await waitForLobby(rcon);
    },
  );
});

describe("Repairing the Search and Destroy map", () => {
  test(
    "/rwf admin repair reports an intact yard and pastes broken blocks back",
    { timeout: 90_000 },
    async ({ bot, rcon, server }) => {
      await waitForLobby(rcon);
      const log = transcript(bot);
      const intact = /Map training-yard is intact\./u;
      const bomb = coords(yard.bombs.Red);
      const floor = coords(yard.floor);
      await rcon.command(`op ${bot.username}`);
      try {
        const before = pastes(await serverLogs(server));
        bot.chat("/rwf admin repair");
        await log.until(/Verifying training-yard\.\.\./u);
        await log.until(intact, 30_000);
        expect(pastes(await serverLogs(server))).toBe(before);

        // An operator's edits: the red bomb broken, a floor block swapped.
        expect(
          await inRwf(rcon, `execute if block ${bomb} minecraft:tnt`),
        ).toContain("Test passed");
        expect(
          await inRwf(rcon, `execute if block ${floor} minecraft:air`),
        ).toContain("Test failed");
        await inRwf(rcon, `setblock ${bomb} minecraft:air`);
        await inRwf(rcon, `setblock ${floor} minecraft:diamond_block`);

        bot.chat("/rwf admin repair");
        await eventually(
          "the second repair to finish",
          async () => log.all(intact).length === 2,
          30_000,
        );
        expect(pastes(await serverLogs(server))).toBe(before + 1);
        expect(
          await inRwf(rcon, `execute if block ${bomb} minecraft:tnt`),
        ).toContain("Test passed");
        expect(
          await inRwf(
            rcon,
            `execute if block ${floor} minecraft:diamond_block`,
          ),
        ).toContain("Test failed");
        expect(
          await inRwf(rcon, `execute if block ${floor} minecraft:air`),
        ).toContain("Test failed");
        const after = await status(rcon);
        expect([after.ready, after.phase]).toEqual([true, "Lobby"]);
      } finally {
        await rcon.command(`deop ${bot.username}`);
      }
    },
  );
});

describe("The Search and Destroy rollout flag", () => {
  test(
    "/rwf join and /rwf spectate are refused while the flag is off for the player",
    { timeout: 60_000 },
    async ({ bot, rcon, brain }) => {
      await waitForLobby(rcon);
      const log = transcript(bot);
      const closed = /Search and Destroy is not open to you yet\./u;
      await setRwfDenied(brain.port, [z.uuid().parse(bot.player.uuid)]);
      try {
        bot.chat("/rwf join");
        await log.until(closed);
        bot.chat("/rwf spectate");
        await eventually(
          "both refusals",
          async () => log.all(closed).length === 2,
        );
        const refused = await status(rcon);
        expect([refused.phase, refused.humans]).toEqual(["Lobby", 0]);
        expect(await rcon.command("rwf admin status")).toContain("Watchers: 0");
        expect(log.has(/joined the match/u)).toBe(false);
      } finally {
        await setRwfDenied(brain.port, []);
      }

      // Once the flag opens for them, the same command admits them.
      bot.chat("/rwf join");
      await log.until(new RegExp(`${bot.username} joined the match`, "u"));
      bot.chat("/rwf leave");
      await waitForLobby(rcon);
    },
  );
});

/** Counts each player's deaths as their own client sees them. */
function deathCounter(humans: Human[]): Map<string, number> {
  const deaths = new Map<string, number>();
  for (const { bot: player } of humans) {
    deaths.set(player.username, 0);
    player.on("death", () => {
      deaths.set(player.username, (deaths.get(player.username) ?? 0) + 1);
    });
  }
  return deaths;
}

/** The settled row of `player` in a match. */
function rowOf(settled: Awaited<ReturnType<typeof settledMatch>>, player: Bot) {
  return settled.players.find((row) => row.player === player.player.uuid);
}

/**
 * Three humans split two against one; one of the pair arms the nuke, which
 * kills the lone enemy and spares the armer's mate. Returns the armer's name
 * and what each player earned.
 */
async function nukeMatch(
  rcon: RconClient,
  server: ServerInfo,
  humans: Human[],
): Promise<{ armer: string; earned: Map<string, number> }> {
  const deaths = deathCounter(humans);
  const teams = await playTogether(humans);
  const live = await status(rcon);
  expect([live.phase, live.humans]).toEqual(["Live", 3]);
  const pairTeam =
    teams.filter((team) => team === "Red").length === 2 ? "Red" : "Blue";
  const pair = humans.filter((_, index) => teams[index] === pairTeam);
  const [armer, mate] = pair;
  const lone = humans.find((_, index) => teams[index] !== pairTeam);
  if (armer === undefined || mate === undefined || pair.length !== 2) {
    throw new Error("the teams did not split two against one");
  }
  if (lone === undefined) {
    throw new Error("nobody stands alone");
  }
  await armNuke(rcon, armer, pairTeam);
  await lone.log.until(new RegExp(`${pairTeam} Team just armed a nuke!`, "u"));
  await armer.log.until(
    new RegExp(
      `${pairTeam} Team's nuke exploded! Everyone but them was annihilated!`,
      "u",
    ),
    75_000,
  );
  await armer.log.until(
    new RegExp(`${enemy(pairTeam)} Team was defeated!`, "u"),
  );
  await armer.log.until(new RegExp(`${pairTeam} Team wins!`, "u"));
  expect(humans.map(({ bot: player }) => deaths.get(player.username))).toEqual(
    humans.map((one) => (one === lone ? 1 : 0)),
  );

  const settled = await settledMatch(server, live.matchId);
  expect(settled.match.winner).toBe(pairTeam.toUpperCase());
  const earned = new Map<string, number>();
  for (const one of humans) {
    const won = one !== lone;
    const row = rowOf(settled, one.bot);
    expect(
      [row?.result, row?.deaths, row?.credits_owed, row?.credits_paid],
      one.bot.username,
    ).toEqual(won ? ["WIN", 0, 3, 3] : ["LOSE", 1, 1, 1]);
    earned.set(one.bot.username, won ? 3 : 1);
  }
  await waitForLobby(rcon);
  return { armer: armer.bot.username, earned };
}

/**
 * A second paid match the same day: it lasts past the minimum length, then
 * everyone off the armer's team is killed. Each payout is cut to what is
 * left of the day's cap, and whoever was cut is told so.
 */
async function cappedMatch(
  rcon: RconClient,
  server: ServerInfo,
  humans: Human[],
  { armer, earned }: { armer: string; earned: Map<string, number> },
): Promise<void> {
  const teams = await playTogether(humans);
  const begun = Date.now();
  const live = await status(rcon);
  expect([live.phase, live.humans]).toEqual(["Live", 3]);
  const armerIndex = humans.findIndex(({ bot: one }) => one.username === armer);
  const winners = teams[armerIndex];
  const announcer = humans[armerIndex];
  if (winners === undefined || announcer === undefined) {
    throw new Error("the armer is not in the second match");
  }
  await Bun.sleep(Math.max(0, 62_000 - (Date.now() - begun)));
  for (const [index, { bot: player }] of humans.entries()) {
    if (teams[index] !== winners) {
      await rcon.command(`kill ${player.username}`);
    }
  }
  await announcer.log.until(new RegExp(`${winners} Team wins!`, "u"), 15_000);
  const settled = await settledMatch(server, live.matchId);
  for (const [index, { bot: player, log }] of humans.entries()) {
    const owed = teams[index] === winners ? 3 : 1;
    const before = earned.get(player.username) ?? 0;
    const paid = Math.min(owed, rwfDailyCap - before);
    const row = rowOf(settled, player);
    expect(
      [row?.credits_owed, row?.payout_status, row?.credits_paid],
      player.username,
    ).toEqual([owed, "PAID", paid]);
    if (paid < owed) {
      await log.until(
        new RegExp(
          String.raw`You reached today's match earnings cap; ${paid.toString()} of ${owed.toString()} credits were paid\.`,
          "u",
        ),
        20_000,
      );
    }
    earned.set(player.username, before + paid);
  }
  await waitForLobby(rcon);
}

/** Connects `names` afresh, each with a new transcript. */
async function connectAll(
  server: ServerInfo,
  names: string[],
): Promise<Human[]> {
  const humans: Human[] = [];
  for (const name of names) {
    humans.push(human(await connect(server, name)));
  }
  return humans;
}

async function disconnectAll(humans: Human[]): Promise<void> {
  for (const { bot: player } of humans) {
    await disconnectBot(player);
  }
}

describe("The nuke and the daily cap", () => {
  test(
    "a nuke kills everyone off the arming team, and the daily cap stops a second payout",
    { timeout: 330_000 },
    async ({ rcon, server }) => {
      await waitForLobby(rcon);
      const names = ["n", "m", "o"].map(
        (prefix) => `${prefix}_${randomBytes(4).toString("hex")}`,
      );
      let humans = await connectAll(server, names);
      try {
        const first = await nukeMatch(rcon, server, humans);
        // Every restore is confirmed by the next login, as players do.
        await disconnectAll(humans);
        humans = [];
        humans = await connectAll(server, names);
        // The armer and their mate earned the cap (3) in the first match.
        await cappedMatch(rcon, server, humans, first);
        for (const { bot: player } of humans) {
          const total = first.earned.get(player.username) ?? 0;
          expect(total).toBeLessThanOrEqual(rwfDailyCap);
          await eventually(
            `${player.username}'s balance`,
            async () => (await balance(player)) === startingBalance + total,
            20_000,
          );
        }
      } finally {
        await disconnectAll(humans);
      }
    },
  );
});
