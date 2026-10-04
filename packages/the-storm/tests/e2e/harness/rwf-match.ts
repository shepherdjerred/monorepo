import path from "node:path";
import type { Bot } from "mineflayer";
import { z } from "zod";
import { packageRoot } from "./paths.ts";
import type { ServerInfo } from "./server.ts";
import { copyStormDatabase, querySqlite } from "./storm-data.ts";
import type { RconClient } from "@shepherdjerred/the-storm-brain/rcon";

/**
 * What the rwf suites share: a player's chat transcript, polling, the
 * `/rwf admin status` reply, and the settled match rows in SQLite.
 */

/** Every chat line a player has seen, for assertions that must not race arrivals. */
export function transcript(bot: Bot) {
  const lines: string[] = [];
  bot.on("messagestr", (line: string) => {
    lines.push(line);
  });
  const find = (pattern: RegExp): RegExpExecArray | undefined => {
    for (const line of lines) {
      const match = pattern.exec(line);
      if (match !== null) {
        return match;
      }
    }
    return undefined;
  };
  return {
    lines,
    find,
    has: (pattern: RegExp) => find(pattern) !== undefined,
    all: (pattern: RegExp): RegExpExecArray[] =>
      lines.flatMap((line) => {
        const match = pattern.exec(line);
        return match === null ? [] : [match];
      }),
    async until(pattern: RegExp, timeoutMs = 10_000): Promise<RegExpExecArray> {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const found = find(pattern);
        if (found !== undefined) {
          return found;
        }
        if (Date.now() > deadline) {
          throw new Error(
            `${bot.username} never saw ${pattern.toString()}; saw:\n${lines.join("\n")}`,
          );
        }
        await Bun.sleep(50);
      }
    },
  };
}
export type Transcript = ReturnType<typeof transcript>;

export async function eventually(
  description: string,
  check: () => Promise<boolean>,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${description}`);
    }
    await Bun.sleep(200);
  }
}

/** Sorts rows of primitives for order-free comparison. */
export function sorted<T>(rows: T[]): T[] {
  return rows.toSorted((a, b) =>
    JSON.stringify(a).localeCompare(JSON.stringify(b)),
  );
}

const StatusSchema = z.string().transform((text, context) => {
  const ready = /Ready: (?<ready>true|false), phase: (?<phase>\w+)/u.exec(text);
  const match =
    /Match (?<matchId>[0-9a-f-]{36}), map (?<map>\S+), (?<humans>\d+) humans, (?<bots>\d+) bots, bot roster (?<roster>present|absent)/u.exec(
      text,
    );
  if (ready?.groups === undefined || match?.groups === undefined) {
    context.addIssue({ code: "custom", message: `no status in ${text}` });
    return z.NEVER;
  }
  return {
    ready: ready.groups["ready"] === "true",
    phase: ready.groups["phase"] ?? "",
    matchId: match.groups["matchId"] ?? "",
    map: match.groups["map"] ?? "",
    humans: Number(match.groups["humans"]),
    bots: Number(match.groups["bots"]),
    roster: match.groups["roster"] ?? "",
  };
});

/** `/rwf admin status`, parsed. */
export async function status(rcon: RconClient) {
  return StatusSchema.parse(await rcon.command("rwf admin status"));
}

/** The previous match has reset and admission is open again. */
export async function waitForLobby(rcon: RconClient): Promise<void> {
  await eventually(
    "the lobby to reopen",
    async () => {
      const now = await status(rcon);
      return now.ready && now.phase === "Lobby" && now.humans === 0;
    },
    30_000,
  );
}

export const MatchRowSchema = z.object({
  id: z.string(),
  map: z.string(),
  winner: z.string().nullable(),
  humans: z.number().int(),
  bots: z.number().int(),
  recording_file: z.string().nullable(),
  recording_bytes: z.number().int(),
  dropped_frames: z.number().int(),
});
export type MatchRow = z.infer<typeof MatchRowSchema>;

export const PlayerRowSchema = z.object({
  player: z.string(),
  team: z.string(),
  kit: z.string(),
  kills: z.number().int(),
  deaths: z.number().int(),
  result: z.string(),
  credits_owed: z.number().int(),
  payout_status: z.string(),
  credits_paid: z.number().int(),
});

/** A fresh copy of the server's database, under the match's own cache folder. */
export async function matchDatabase(server: ServerInfo, matchId: string) {
  const outDir = path.join(packageRoot, ".cache", "e2e", "rwf", matchId);
  return { outDir, database: await copyStormDatabase(server, outDir) };
}

export async function matchRows(server: ServerInfo, matchId: string) {
  const { outDir, database } = await matchDatabase(server, matchId);
  const matches = z
    .array(MatchRowSchema)
    .parse(
      await querySqlite(
        database,
        `SELECT id, map, winner, humans, bots, recording_file, recording_bytes, dropped_frames FROM rwf_match WHERE id = '${matchId}'`,
      ),
    );
  const players = z
    .array(PlayerRowSchema)
    .parse(
      await querySqlite(
        database,
        `SELECT player, team, kit, kills, deaths, result, credits_owed, payout_status, credits_paid FROM rwf_match_player WHERE match_id = '${matchId}' ORDER BY player`,
      ),
    );
  return { outDir, database, match: matches[0], players };
}

/** The settled match row: payouts finished and the recording closed. */
export async function settledMatch(server: ServerInfo, matchId: string) {
  let latest = await matchRows(server, matchId);
  await eventually(
    `match ${matchId} to settle`,
    async () => {
      latest = await matchRows(server, matchId);
      return (
        latest.match?.recording_file !== null &&
        latest.match?.recording_file !== undefined &&
        latest.players.length > 0 &&
        latest.players.every(
          (row) => row.payout_status === "PAID" || row.payout_status === "NONE",
        )
      );
    },
    30_000,
  );
  const match = latest.match;
  if (match === undefined) {
    throw new Error(`no rwf_match row for ${matchId}`);
  }
  return { ...latest, match };
}
