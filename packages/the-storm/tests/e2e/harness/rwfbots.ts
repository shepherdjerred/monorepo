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
import type { RconClient } from "@shepherdjerred/the-storm-brain/rcon";

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
  roster: Map<string, { team: string; bot: boolean }>;
  intents: { pseudonym: string; kind: string; target: string }[];
  events: string[][];
};

/** A match recording's roster (`R`), bot intents (`I`) and events (`E`). */
export function readRecording(lines: string[]): Recording {
  const recording: Recording = { roster: new Map(), intents: [], events: [] };
  for (const line of lines) {
    const fields = line.split("\t");
    const field = (index: number) => fields[index] ?? "";
    switch (field(0)) {
      case "R": {
        recording.roster.set(field(1), {
          team: field(2),
          bot: field(4) === "true",
        });
        break;
      }
      case "I": {
        recording.intents.push({
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
        // Other record kinds (ticks, positions) are not asserted on.
        break;
      }
    }
  }
  return recording;
}
