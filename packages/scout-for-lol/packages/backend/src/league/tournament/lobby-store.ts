import { z } from "zod";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import {
  TournamentLobbyStateSchema,
  isTerminal,
  type TournamentLobbyState,
} from "#src/league/tournament/lifecycle.ts";
import {
  TournamentMapTypeSchema,
  TournamentPickTypeSchema,
  TournamentSpectatorTypeSchema,
  type DiscordAccountId,
  type DiscordChannelId,
  type DiscordGuildId,
  type Region,
} from "@scout-for-lol/data/index.ts";

/**
 * Reads and writes for TournamentLobby.
 *
 * Enum-shaped columns are TEXT for Postgres-cutover portability, so every read
 * re-validates them with Zod rather than trusting the column. A row that fails
 * to parse is a corrupted row, not something to paper over.
 */

const StringArraySchema = z.array(z.string());
const MessageIdMapSchema = z.record(z.string(), z.string());

/** Two hours: long enough for people to actually gather, short enough that a
 * lobby nobody plays does not linger in /lobby status all day. */
export const LOBBY_ABANDON_TTL_MS = 2 * 60 * 60 * 1000;

/**
 * Three hours from champ select, matching MAX_DISCORD_ALERT_AGE_MS and
 * ACTIVE_GAME_TTL_MS: a lobby that never resolves expires at exactly the moment
 * its report would have been suppressed as stale anyway.
 */
export const LOBBY_PLAYED_TTL_MS = 3 * 60 * 60 * 1000;

export type TournamentLobbyRecord = {
  readonly id: number;
  readonly code: string;
  readonly apiMode: string;
  readonly providerId: number;
  readonly tournamentId: number;
  readonly region: Region;
  readonly platformId: string;
  readonly serverId: DiscordGuildId;
  readonly channelId: DiscordChannelId;
  readonly creatorDiscordId: DiscordAccountId;
  readonly bluePuuids: string[];
  readonly redPuuids: string[];
  readonly blueAliases: string[];
  readonly redAliases: string[];
  readonly teamSize: number;
  readonly pickType: string;
  readonly mapType: string;
  readonly spectatorType: string;
  readonly lobbyName: string | undefined;
  readonly password: string | undefined;
  readonly state: TournamentLobbyState;
  readonly joinedPuuids: string[];
  readonly prematchMessageIds: Record<string, string> | undefined;
  readonly gameId: bigint | undefined;
  readonly matchId: string | undefined;
  readonly expiresAt: Date;
  readonly createdAt: Date;
};

type LobbyRow = Awaited<
  ReturnType<ExtendedPrismaClient["tournamentLobby"]["findFirst"]>
>;

export function parseLobbyRow(
  row: NonNullable<LobbyRow>,
): TournamentLobbyRecord {
  return {
    id: row.id,
    code: row.code,
    apiMode: row.apiMode,
    providerId: row.providerId,
    tournamentId: row.tournamentId,
    region: row.region,
    platformId: row.platformId,
    serverId: row.serverId,
    channelId: row.channelId,
    creatorDiscordId: row.creatorDiscordId,
    bluePuuids: StringArraySchema.parse(JSON.parse(row.bluePuuids)),
    redPuuids: StringArraySchema.parse(JSON.parse(row.redPuuids)),
    blueAliases: StringArraySchema.parse(JSON.parse(row.blueAliases)),
    redAliases: StringArraySchema.parse(JSON.parse(row.redAliases)),
    teamSize: row.teamSize,
    pickType: TournamentPickTypeSchema.parse(row.pickType),
    mapType: TournamentMapTypeSchema.parse(row.mapType),
    spectatorType: TournamentSpectatorTypeSchema.parse(row.spectatorType),
    lobbyName: row.lobbyName ?? undefined,
    password: row.password ?? undefined,
    state: TournamentLobbyStateSchema.parse(row.state),
    joinedPuuids: StringArraySchema.parse(JSON.parse(row.joinedPuuids)),
    prematchMessageIds:
      row.prematchMessageIds === null
        ? undefined
        : MessageIdMapSchema.parse(JSON.parse(row.prematchMessageIds)),
    gameId: row.gameId ?? undefined,
    matchId: row.matchId ?? undefined,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  };
}

/**
 * Lobbies the poller should look at this tick, oldest-polled first.
 *
 * Terminal lobbies are excluded by construction rather than filtered after the
 * fact, so a finished lobby costs no Riot call for the rest of its retention.
 */
export async function claimLobbiesToPoll(
  client: ExtendedPrismaClient,
  limit: number,
): Promise<TournamentLobbyRecord[]> {
  const active = TournamentLobbyStateSchema.options.filter(
    (state) => !isTerminal(state),
  );
  const rows = await client.tournamentLobby.findMany({
    where: { state: { in: active } },
    orderBy: [{ lastPolledAt: { sort: "asc", nulls: "first" } }, { id: "asc" }],
    take: limit,
  });
  return rows.map((row) => parseLobbyRow(row));
}

export async function countOpenLobbiesForGuild(
  client: ExtendedPrismaClient,
  serverId: DiscordGuildId,
): Promise<number> {
  const active = TournamentLobbyStateSchema.options.filter(
    (state) => !isTerminal(state),
  );
  return client.tournamentLobby.count({
    where: { serverId, state: { in: active } },
  });
}

export async function findLobbyByCode(
  client: ExtendedPrismaClient,
  code: string,
): Promise<TournamentLobbyRecord | undefined> {
  const row = await client.tournamentLobby.findUnique({ where: { code } });
  return row === null ? undefined : parseLobbyRow(row);
}

export async function findLobbyByMatchId(
  client: ExtendedPrismaClient,
  matchId: string,
): Promise<TournamentLobbyRecord | undefined> {
  const row = await client.tournamentLobby.findFirst({ where: { matchId } });
  return row === null ? undefined : parseLobbyRow(row);
}

export async function listLobbiesForGuild(
  client: ExtendedPrismaClient,
  serverId: DiscordGuildId,
): Promise<TournamentLobbyRecord[]> {
  const rows = await client.tournamentLobby.findMany({
    where: { serverId },
    orderBy: { createdAt: "desc" },
    take: 25,
  });
  return rows.map((row) => parseLobbyRow(row));
}

export type CreateLobbyInput = {
  code: string;
  apiMode: string;
  providerId: number;
  tournamentId: number;
  region: Region;
  platformId: string;
  serverId: DiscordGuildId;
  channelId: DiscordChannelId;
  creatorDiscordId: DiscordAccountId;
  bluePuuids: string[];
  redPuuids: string[];
  blueAliases: string[];
  redAliases: string[];
  teamSize: number;
  pickType: string;
  mapType: string;
  spectatorType: string;
  lobbyName: string | undefined;
  password: string | undefined;
  expiresAt: Date;
};

export async function createLobby(
  client: ExtendedPrismaClient,
  input: CreateLobbyInput,
): Promise<TournamentLobbyRecord> {
  const row = await client.tournamentLobby.create({
    data: {
      code: input.code,
      apiMode: input.apiMode,
      providerId: input.providerId,
      tournamentId: input.tournamentId,
      region: input.region,
      platformId: input.platformId,
      serverId: input.serverId,
      channelId: input.channelId,
      creatorDiscordId: input.creatorDiscordId,
      bluePuuids: JSON.stringify(input.bluePuuids),
      redPuuids: JSON.stringify(input.redPuuids),
      blueAliases: JSON.stringify(input.blueAliases),
      redAliases: JSON.stringify(input.redAliases),
      teamSize: input.teamSize,
      pickType: input.pickType,
      mapType: input.mapType,
      spectatorType: input.spectatorType,
      lobbyName: input.lobbyName ?? null,
      password: input.password ?? null,
      state: "created",
      joinedPuuids: "[]",
      expiresAt: input.expiresAt,
    },
  });
  return parseLobbyRow(row);
}

export type LobbyUpdate = {
  state?: TournamentLobbyState;
  joinedPuuids?: string[];
  processedEventCount?: number;
  lastEventTimestamp?: string | undefined;
  prematchMessageIds?: Record<string, string>;
  gameId?: bigint;
  matchId?: string;
  expiresAt?: Date;
  markPolled?: boolean;
};

export async function updateLobby(
  client: ExtendedPrismaClient,
  id: number,
  update: LobbyUpdate,
): Promise<void> {
  await client.tournamentLobby.update({
    where: { id },
    data: {
      ...(update.state === undefined ? {} : { state: update.state }),
      ...(update.joinedPuuids === undefined
        ? {}
        : { joinedPuuids: JSON.stringify(update.joinedPuuids) }),
      ...(update.processedEventCount === undefined
        ? {}
        : { processedEventCount: update.processedEventCount }),
      ...(update.lastEventTimestamp === undefined
        ? {}
        : { lastEventTimestamp: update.lastEventTimestamp }),
      ...(update.prematchMessageIds === undefined
        ? {}
        : { prematchMessageIds: JSON.stringify(update.prematchMessageIds) }),
      ...(update.gameId === undefined ? {} : { gameId: update.gameId }),
      ...(update.matchId === undefined ? {} : { matchId: update.matchId }),
      ...(update.expiresAt === undefined
        ? {}
        : { expiresAt: update.expiresAt }),
      ...(update.markPolled === true ? { lastPolledAt: new Date() } : {}),
    },
  });
}

/**
 * Counts by state, for the gauge.
 *
 * Includes terminal states deliberately: "how many lobbies were abandoned this
 * week" is exactly the kind of question the first live rollout needs to answer.
 */
export async function countLobbiesByState(
  client: ExtendedPrismaClient,
): Promise<Map<TournamentLobbyState, number>> {
  const grouped = await client.tournamentLobby.groupBy({
    by: ["state"],
    _count: { _all: true },
  });
  const counts = new Map<TournamentLobbyState, number>();
  for (const state of TournamentLobbyStateSchema.options) {
    counts.set(state, 0);
  }
  for (const row of grouped) {
    counts.set(TournamentLobbyStateSchema.parse(row.state), row._count._all);
  }
  return counts;
}
