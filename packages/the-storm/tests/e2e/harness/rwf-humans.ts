import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import { expect } from "vitest";
import { z } from "zod";
import type { RconClient } from "#e2e/harness/rcon.ts";
import { connectBot, disconnectBot, waitUntil } from "./bot.ts";
import { rwfTestSettings } from "./rwf-settings.ts";
import { lookAround } from "./rwfbots.ts";
import { eventually, transcript, type Transcript } from "./rwf-match.ts";
import type { ServerInfo } from "./server.ts";

/**
 * The Red Warfare suites' players and places: the human players and their
 * transcripts, the training yard and the lobby, and the RCON helpers that
 * move players and read their state in either world.
 */

export const dimension = `minecraft:${rwfTestSettings.world}`;
export const lobbyDimension = `minecraft:${rwfTestSettings.lobbyWorld}`;

export type Team = "Red" | "Blue";

/** The training yard's bombs, one in each base, and a clear spot for a duel. */
export const yard = {
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
  /** The yard's region, both corners included. */
  region: { min: new Vec3(0, 64, 0), max: new Vec3(63, 79, 63) },
  /** Where the dead and watchers look down from. */
  spectator: new Vec3(31.5, 76, 31.5),
} as const;

/**
 * The lobby (rwf/lobby/lobby.yml), in its own world: its region and the spawn
 * on the plaza. It overlaps the yard's coordinates, so which world a player
 * stands in is asked of the server (`standsIn`).
 */
export const lobby = {
  region: { min: new Vec3(0, 64, 0), max: new Vec3(177, 99, 99) },
  spawn: new Vec3(60.5, 70, 50.5),
} as const;

export type Region = { min: Vec3; max: Vec3 };

/** How many of `item` `bot` carries, every stack together. */
export function count(bot: Bot, item: string): number {
  return bot.inventory
    .items()
    .filter((stack) => stack.name === item)
    .reduce((total, stack) => total + stack.count, 0);
}

/** The item in hotbar `slot` (0 to 8), as `bot`'s client sees it. */
export function hotbar(bot: Bot, slot: number): string | undefined {
  // Hotbar slots are 36-44 in the player inventory window.
  return bot.inventory.slots[36 + slot]?.name;
}

export function coords(at: Vec3): string {
  return `${at.x.toString()} ${at.y.toString()} ${at.z.toString()}`;
}

/** A target selector box covering `region`, both corners' blocks included. */
export function box(region: Region): string {
  const { min, max } = region;
  return `x=${min.x.toString()},y=${min.y.toString()},z=${min.z.toString()},dx=${(max.x - min.x).toString()},dy=${(max.y - min.y).toString()},dz=${(max.z - min.z).toString()}`;
}

/** Whether `bot` stands inside `region` of the world `in` names. */
export async function standsIn(
  rcon: RconClient,
  bot: Bot,
  inWorld: string,
  region: Region,
): Promise<boolean> {
  const reply = await rcon.command(
    `execute in ${inWorld} if entity @a[name=${bot.username},${box(region)}]`,
  );
  return reply.includes("Test passed");
}

/** Waits until `bot` stands inside `region` of the world `in` names. */
export async function arrives(
  rcon: RconClient,
  bot: Bot,
  inWorld: string,
  region: Region,
): Promise<void> {
  await eventually(
    `${bot.username} in ${inWorld}`,
    async () => standsIn(rcon, bot, inWorld, region),
    15_000,
  );
}

/** Runs `command` with the rwf world as the executing dimension. */
export async function inRwf(
  rcon: RconClient,
  command: string,
): Promise<string> {
  return rcon.command(`execute in ${dimension} run ${command}`);
}

export async function teleport(
  rcon: RconClient,
  bot: Bot,
  to: Vec3,
): Promise<void> {
  const reply = await inRwf(rcon, `minecraft:tp ${bot.username} ${coords(to)}`);
  try {
    await waitUntil(
      `${bot.username} arrives at ${coords(to)}`,
      () => bot.entity.position.distanceTo(to) < 0.5,
    );
  } catch (error) {
    throw new Error(
      `${String(error)}; RCON replied ${reply}; player is at ${coords(bot.entity.position)}`,
      { cause: error },
    );
  }
}

export function numberAfter(pattern: RegExp, what: string) {
  return z.string().transform((text, context) => {
    const match = pattern.exec(text.trim());
    if (match?.groups?.["value"] === undefined) {
      context.addIssue({ code: "custom", message: `no ${what} in ${text}` });
      return z.NEVER;
    }
    return Number(match.groups["value"]);
  });
}

export const HealthSchema = numberAfter(/: (?<value>-?[\d.]+)f$/u, "health");

export async function health(rcon: RconClient, bot: Bot): Promise<number> {
  return HealthSchema.parse(
    await rcon.command(`data get entity ${bot.username} Health`),
  );
}

/** A player and their transcript. */
export type Human = { bot: Bot; log: Transcript };

export function human(bot: Bot): Human {
  return { bot, log: transcript(bot) };
}

export async function join({ bot, log }: Human): Promise<void> {
  bot.chat("/rwf join");
  await log.until(new RegExp(`${bot.username} joined the match`, "u"));
}

/** Joins again on the same connection; a pending restore delays, never refuses, it. */
export async function joinRecovered({ bot, log }: Human): Promise<void> {
  const joined = new RegExp(`${bot.username} joined the match`, "u");
  bot.chat("/rwf join");
  await log.until(joined, 20_000);
  expect(log.has(/Reconnect to finish recovery/u)).toBe(false);
}

/**
 * Everyone joins one countdown (inside its six seconds) and the match goes
 * live; returns their teams in order. Transcripts start afresh, so a second
 * match reads only its own lines.
 */
export async function playTogether(
  humans: Human[],
  idle: Human[] = [],
  beforeStart?: () => Promise<void>,
): Promise<Team[]> {
  for (const { log } of humans) {
    log.lines.length = 0;
  }
  for (const one of humans) {
    await joinRecovered(one);
  }
  await beforeStart?.();
  for (const { log } of humans) {
    await log.until(/The game has begun!/u, 30_000);
  }
  const teams = await Promise.all(humans.map(async ({ log }) => teamOf(log)));
  for (const one of humans) {
    if (!idle.includes(one)) {
      await lookAround(one.bot);
    }
  }
  return teams;
}

export async function teamOf(log: Transcript): Promise<Team> {
  const seen = await log.until(/You are in (?<team>Red|Blue) Team/u, 30_000);
  return z.enum(["Red", "Blue"]).parse(seen.groups?.["team"]);
}

export function enemy(team: Team): Team {
  return team === "Red" ? "Blue" : "Red";
}

/**
 * `other`'s entity as `bot` sees it. Mineflayer sets it to null while the
 * entity is out of view (a player arriving from the lobby is respawned on
 * every client that sees the yard), so null counts as unseen.
 */
export function inView(bot: Bot, other: Bot): Bot["entity"] | undefined {
  const entity: Bot["entity"] | null | undefined =
    bot.players[other.username]?.entity;
  return entity?.isValid === true && bot.entities[entity.id] === entity
    ? entity
    : undefined;
}

export async function connect(
  server: ServerInfo,
  username: string,
): Promise<Bot> {
  return connectBot({ host: server.host, port: server.gamePort, username });
}

/** Connects `names` afresh, each with a new transcript. */
export async function connectAll(
  server: ServerInfo,
  names: string[],
): Promise<Human[]> {
  const humans: Human[] = [];
  for (const name of names) {
    humans.push(human(await connect(server, name)));
  }
  return humans;
}

export async function disconnectAll(humans: Human[]): Promise<void> {
  for (const { bot: player } of humans) {
    await disconnectBot(player);
  }
}
