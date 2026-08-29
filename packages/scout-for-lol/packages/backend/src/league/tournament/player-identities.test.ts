import { describe, expect, test, vi } from "vitest";
import {
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  LeaguePuuidSchema,
} from "@scout-for-lol/data/index.ts";
import type { TournamentLobbyRecord } from "#src/league/tournament/lobby-store.ts";

const resolvedPuuids: string[] = [];

vi.doMock("#src/lib/riot/account-riot-id.ts", () => ({
  getRiotIdByPuuid: async (puuid: string) => {
    resolvedPuuids.push(puuid);
    if (puuid.startsWith("b")) return null;
    return { gameName: "Joined Player", tagLine: "NA1" };
  },
}));

const { resolveLobbyPlayerNames } =
  await import("#src/league/tournament/player-identities.ts");

function openLobby(puuids: string[]): TournamentLobbyRecord {
  return {
    id: 1,
    code: "OPEN-CODE",
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
    lobbyName: undefined,
    password: undefined,
    state: "champ_select",
    joinedPuuids: puuids,
    prematchMessageIds: undefined,
    gameId: undefined,
    matchId: undefined,
    expiresAt: new Date("2026-08-29T00:00:00.000Z"),
    createdAt: new Date("2026-08-29T00:00:00.000Z"),
  };
}

describe("open-lobby player enrichment", () => {
  test("renders every joined player as a Riot ID", async () => {
    const firstPuuid = LeaguePuuidSchema.parse("a".repeat(78));
    const secondPuuid = LeaguePuuidSchema.parse("c".repeat(78));

    await expect(
      resolveLobbyPlayerNames(openLobby([firstPuuid, secondPuuid])),
    ).resolves.toEqual(["Joined Player#NA1", "Joined Player#NA1"]);
    expect(resolvedPuuids).toEqual([firstPuuid, secondPuuid]);
  });

  test("uses the count-only card path rather than leaking or partially rendering PUUIDs", async () => {
    const resolvedPuuid = LeaguePuuidSchema.parse("a".repeat(78));
    const unresolvedPuuid = LeaguePuuidSchema.parse("b".repeat(78));

    await expect(
      resolveLobbyPlayerNames(openLobby([resolvedPuuid, unresolvedPuuid])),
    ).resolves.toBeUndefined();
  });
});
