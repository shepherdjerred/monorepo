import {
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  LeaguePuuidSchema,
} from "@scout-for-lol/data/index.ts";
import type {
  CreateLobbyInput,
  TournamentLobbyRecord,
} from "#src/league/tournament/lobby-store.ts";

export const openLobbySettings = {
  apiMode: "live",
  providerId: 1,
  tournamentId: 2,
  region: "AMERICA_NORTH",
  platformId: "NA1",
  serverId: DiscordGuildIdSchema.parse("1337623164146155593"),
  channelId: DiscordChannelIdSchema.parse("1337623164146155594"),
  creatorDiscordId: DiscordAccountIdSchema.parse("160509172704739328"),
  bluePuuids: [],
  redPuuids: [],
  blueAliases: [],
  redAliases: [],
  teamSize: 5,
  pickType: "TOURNAMENT_DRAFT",
  mapType: "SUMMONERS_RIFT",
  spectatorType: "ALL",
} satisfies Omit<
  CreateLobbyInput,
  "code" | "lobbyName" | "password" | "expiresAt"
>;

export function openLobby(
  joinedPuuids = [LeaguePuuidSchema.parse("joined-player".padEnd(78, "0"))],
): TournamentLobbyRecord {
  return {
    id: 1,
    code: "OPEN-CODE",
    ...openLobbySettings,
    lobbyName: undefined,
    password: undefined,
    state: "champ_select",
    joinedPuuids,
    prematchMessageIds: undefined,
    gameId: undefined,
    matchId: undefined,
    expiresAt: new Date("2026-08-29T00:00:00.000Z"),
    createdAt: new Date("2026-08-29T00:00:00.000Z"),
  };
}
