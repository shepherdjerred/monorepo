import { describe, expect, test } from "vitest";
import {
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  LeaguePuuidSchema,
} from "@scout-for-lol/data/index.ts";
import {
  buildLobbyPrematchEmbed,
  describeLobby,
} from "#src/league/tournament/prematch-card.ts";
import type { TournamentLobbyRecord } from "#src/league/tournament/lobby-store.ts";

function openLobby(): TournamentLobbyRecord {
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
    joinedPuuids: [LeaguePuuidSchema.parse("joined-player".padEnd(78, "0"))],
    prematchMessageIds: undefined,
    gameId: undefined,
    matchId: undefined,
    expiresAt: new Date("2026-08-29T00:00:00.000Z"),
    createdAt: new Date("2026-08-29T00:00:00.000Z"),
  };
}

describe("open tournament-lobby cards", () => {
  test("shows a team-neutral joined-player roster without inventing teams", () => {
    const embed = buildLobbyPrematchEmbed(openLobby(), ["Player#NA1"]).toJSON();

    expect(embed.title).toBe("Custom game starting — 5v5");
    expect(embed.fields).toEqual([
      {
        name: "Players",
        value: "• Player#NA1",
      },
    ]);
  });

  test("shows the joined count when identity enrichment is unavailable", () => {
    const embed = buildLobbyPrematchEmbed(openLobby()).toJSON();

    expect(embed.fields).toEqual([
      {
        name: "Open lobby",
        value: "1 player(s) joined · teams are set in League",
      },
    ]);
  });

  test("describes an open lobby in private status output", () => {
    expect(describeLobby(openLobby())).toContain("Open lobby · 5v5 · 1 joined");
  });
});
