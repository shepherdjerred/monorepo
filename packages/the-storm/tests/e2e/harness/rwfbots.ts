import { readdir } from "node:fs/promises";
import path from "node:path";
import type { Bot } from "mineflayer";
import { expect } from "vitest";
import { z } from "zod";
import { waitForMessage } from "./bot.ts";
import { ownedConfigDir } from "./paths.ts";
import { matchDatabase } from "./rwf-match.ts";
import type { ServerInfo } from "./server.ts";
import { querySqlite, stormDataFile } from "./storm-data.ts";
import type { RconClient } from "#e2e/harness/rcon.ts";

/**
 * What the rwfbots suite reads: the shipped personalities, what a human's
 * client learns about the bots, `/rwfbots debug`, the personality records and
 * the gzip recordings and traces.
 */

export type Team = "Red" | "Blue";

const PersonalitySchema = z.object({
  id: z.string(),
  name: z.string(),
  skin: z.object({ value: z.string(), signature: z.string() }),
  quirks: z.array(z.string()),
});
export type Personality = z.infer<typeof PersonalitySchema>;

/** The shipped personalities by in-game name. */
export async function personalities(): Promise<Map<string, Personality>> {
  const folder = path.join(ownedConfigDir, "rwfbots", "personalities");
  const entries = await readdir(folder);
  const files = entries.filter((file) => file.endsWith(".yml"));
  const all = await Promise.all(
    files.map(async (file) => {
      const text = await Bun.file(path.join(folder, file)).text();
      return PersonalitySchema.parse(Bun.YAML.parse(text));
    }),
  );
  return new Map(all.map((personality) => [personality.name, personality]));
}

/** A repository-owned TheStorm config file, parsed. */
export async function ownedYaml<T extends z.ZodType>(
  file: string,
  schema: T,
): Promise<z.infer<T>> {
  const text = await Bun.file(path.join(ownedConfigDir, file)).text();
  return schema.parse(Bun.YAML.parse(text));
}

const PropertySchema = z.object({
  name: z.string(),
  value: z.string(),
  signature: z.string().optional(),
});
const PlayerInfoSchema = z.object({
  data: z.array(
    z.object({
      uuid: z.string(),
      player: z
        .object({
          name: z.string(),
          properties: z.array(PropertySchema).default([]),
        })
        .optional(),
    }),
  ),
});
const TeamsPacketSchema = z.object({
  team: z.string(),
  mode: z.union([z.string(), z.number()]),
  suffix: z.unknown().optional(),
  players: z.array(z.string()).optional(),
});

const botTeams = new Map<string, Team>([
  ["rwf_red_bot", "Red"],
  ["rwf_blue_bot", "Blue"],
]);

/**
 * What the human's client learns about the bots: the profiles (and skins) the
 * server announces, the scoreboard teams they join, who was hurt, and their
 * entities.
 */
export function clientView(bot: Bot) {
  const profiles = new Map<
    string,
    { uuid: string; textures: z.infer<typeof PropertySchema> | undefined }
  >();
  const teams = new Map<string, string>();
  const suffixes = new Map<string, string>();
  const hurt = new Set<string>();
  bot._client.on("player_info", (packet: unknown) => {
    for (const entry of PlayerInfoSchema.parse(packet).data) {
      if (entry.player !== undefined) {
        profiles.set(entry.player.name, {
          uuid: entry.uuid,
          textures: entry.player.properties.find(
            (property) => property.name === "textures",
          ),
        });
      }
    }
  });
  bot._client.on("teams", (packet: unknown) => {
    const parsed = TeamsPacketSchema.parse(packet);
    if (parsed.suffix !== undefined) {
      suffixes.set(parsed.team, JSON.stringify(parsed.suffix));
    }
    if (parsed.mode === "add" || parsed.mode === "join") {
      for (const player of parsed.players ?? []) {
        teams.set(player, parsed.team);
      }
    }
  });
  bot.on("entityHurt", (entity) => {
    if (entity.username !== undefined) {
      hurt.add(entity.username);
    }
  });
  return {
    profiles,
    teams,
    suffixes,
    hurt,
    entity: (name: string) =>
      Object.values(bot.entities).find(
        (seen) => seen.type === "player" && seen.username === name,
      ),
    /** The team a bot's scoreboard entry joined, if it is on a bot team. */
    botTeam: (name: string): Team | undefined =>
      botTeams.get(teams.get(name) ?? ""),
  };
}
export type ClientView = ReturnType<typeof clientView>;

/** Strips the section-sign formatting the plugin's messages carry over RCON. */
export function plain(text: string): string {
  return text.replaceAll(/§./gu, "");
}

/** Escapes `text` for a regular expression. */
export function escaped(text: string): string {
  return text.replaceAll(/[$()*+.?[\\\]^{|}]/gu, String.raw`\$&`);
}

const DebugSchema = z.string().transform((text, context) => {
  const match =
    /governor level (?<level>\d+); think p95 (?<think>[\d.]+) ms \(last [\d.]+ ms, (?<jobs>\d+) jobs\); staleness p95 (?<stale>[\d.]+) ticks; bot sections p95 (?<sections>[\d.]+) ms/u.exec(
      plain(text),
    );
  if (match?.groups === undefined) {
    context.addIssue({ code: "custom", message: `no overview in ${text}` });
    return z.NEVER;
  }
  return {
    level: Number(match.groups["level"]),
    thinkP95: Number(match.groups["think"]),
    jobs: Number(match.groups["jobs"]),
    stalenessP95: Number(match.groups["stale"]),
    sectionsP95: Number(match.groups["sections"]),
    text: plain(text),
  };
});

/** `/rwfbots debug`, parsed; the bot lines stay in `text`. */
export async function debug(rcon: RconClient) {
  return DebugSchema.parse(await rcon.command("rwfbots debug"));
}

export async function balance(bot: Bot): Promise<number> {
  const reply = waitForMessage(bot, /Balance: (?<amount>\d+) crystals?/u);
  bot.chat("/balance");
  const seen = await reply;
  return Number(seen.groups?.["amount"]);
}

export function diamonds(bot: Bot): number {
  return bot.inventory
    .items()
    .filter((stack) => stack.name === "diamond")
    .reduce((total, stack) => total + stack.count, 0);
}

const StatsRowSchema = z.object({
  personality_id: z.string(),
  matches: z.number().int(),
  wins: z.number().int(),
  kills: z.number().int(),
  deaths: z.number().int(),
  plants: z.number().int(),
});
export type StatsRow = z.infer<typeof StatsRowSchema>;

/** `rwfbots_personality_stats` by personality id, from a fresh database copy. */
export async function personalityStats(
  server: ServerInfo,
  key: string,
): Promise<Map<string, StatsRow>> {
  const { database } = await matchDatabase(server, key);
  const rows = z
    .array(StatsRowSchema)
    .parse(
      await querySqlite(
        database,
        "SELECT personality_id, matches, wins, kills, deaths, plants FROM rwfbots_personality_stats",
      ),
    );
  return new Map(rows.map((row) => [row.personality_id, row]));
}

/** The lines of a gzip file under the server's TheStorm data folder. */
export async function gzipLines(
  server: ServerInfo,
  relative: string,
  outDir: string,
): Promise<string[]> {
  const file = await stormDataFile(server, relative, outDir);
  if (file === undefined) {
    throw new Error(`${relative} is missing on the server`);
  }
  const bytes = new Uint8Array(await Bun.file(file).arrayBuffer());
  expect([bytes[0], bytes[1]]).toEqual([0x1f, 0x8b]);
  return new TextDecoder()
    .decode(Bun.gunzipSync(bytes))
    .split("\n")
    .filter((line) => line !== "");
}

export type Recording = {
  /** The format version from the `H` row. */
  version: number;
  roster: Map<string, { team: string; bot: boolean }>;
  intents: { tick: number; pseudonym: string; kind: string; target: string }[];
  events: string[][];
  frames: { tick: number; pseudonym: string }[];
  inputs: { tick: number; pseudonym: string; keys: number }[];
};

/**
 * A match recording's version (`H`), roster (`R`), intents (`I`), events
 * (`E`), frame ticks (`F`) and human inputs (`N`).
 */
export function readRecording(lines: string[]): Recording {
  const recording: Recording = {
    version: 0,
    roster: new Map(),
    intents: [],
    events: [],
    frames: [],
    inputs: [],
  };
  for (const line of lines) {
    const fields = line.split("\t");
    const field = (index: number) => fields[index] ?? "";
    switch (field(0)) {
      case "H": {
        recording.version = Number(field(1));
        break;
      }
      case "F": {
        recording.frames.push({
          tick: Number(field(1)),
          pseudonym: field(2),
        });
        break;
      }
      case "N": {
        recording.inputs.push({
          tick: Number(field(1)),
          pseudonym: field(2),
          keys: Number(field(3)),
        });
        break;
      }
      case "R": {
        recording.roster.set(field(1), {
          team: field(2),
          bot: field(4) === "true",
        });
        break;
      }
      case "I": {
        recording.intents.push({
          tick: Number(field(1)),
          pseudonym: field(2),
          kind: field(3),
          target: field(4),
        });
        break;
      }
      case "E": {
        recording.events.push(fields.slice(2));
        break;
      }
      default: {
        // The end and payout rows are read from the database instead.
        break;
      }
    }
  }
  return recording;
}

/** The ticks of `who`'s rows. */
function ticksOf(
  rows: { tick: number; pseudonym: string }[],
  who: string,
): number[] {
  return rows.filter((row) => row.pseudonym === who).map((row) => row.tick);
}

/** How many of `ticks` fall in `from`..`to`. */
function countWithin(ticks: number[], from: number, to: number): number {
  return ticks.filter((tick) => tick >= from && tick <= to).length;
}

/**
 * The per-tick samples: every human has one input row (`N`) for each of its
 * frames, bots have none, and over any stretch both were alive a bot has
 * half as many frames as a human (10 Hz against 20 Hz).
 */
export function expectSampleCadence(recording: Recording): void {
  expect(recording.version).toBe(3);
  const humans = [...recording.roster]
    .filter(([, entry]) => !entry.bot)
    .map(([pseudonym]) => pseudonym);
  const bots = [...recording.roster]
    .filter(([, entry]) => entry.bot)
    .map(([pseudonym]) => pseudonym);
  for (const human of humans) {
    const frames = ticksOf(recording.frames, human);
    expect(frames.length, `${human} has frames`).toBeGreaterThan(0);
    expect(ticksOf(recording.inputs, human), `${human}'s inputs`).toEqual(
      frames,
    );
  }
  for (const bot of bots) {
    expect(ticksOf(recording.inputs, bot), `${bot} has no inputs`).toEqual([]);
  }
  const [human] = humans;
  if (human === undefined || bots.length === 0) {
    return;
  }
  const humanFrames = ticksOf(recording.frames, human);
  const compared = bots.flatMap((bot) => {
    const botFrames = ticksOf(recording.frames, bot);
    const from = Math.max(humanFrames[0] ?? 0, botFrames[0] ?? 0);
    const to = Math.min(humanFrames.at(-1) ?? 0, botFrames.at(-1) ?? 0);
    const humanCount = countWithin(humanFrames, from, to);
    return humanCount < 100
      ? []
      : [{ bot, ratio: countWithin(botFrames, from, to) / humanCount }];
  });
  expect(compared.length, "bots alive beside the human").toBeGreaterThan(0);
  for (const { bot, ratio } of compared) {
    expect(ratio, `${bot}'s frames per human frame`).toBeGreaterThan(0.4);
    expect(ratio, `${bot}'s frames per human frame`).toBeLessThan(0.6);
  }
}
