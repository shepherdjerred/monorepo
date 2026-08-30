import { describe, expect, test } from "vitest";
import type {
  CustomGameParticipant,
  CustomNightSnapshot,
} from "@scout-for-lol/data";
import {
  canDraftForTeam,
  canManageCustomNight,
  customRoleFor,
} from "#src/customs/authorization.ts";

const SNAPSHOT: CustomNightSnapshot = {
  id: "018f173a-6f4a-7d19-b731-963d62a2e1bd",
  guildId: "guild",
  guildName: "Guild",
  launchChannelId: "launch",
  voiceLobbyChannelId: "voice",
  hostDiscordId: "host",
  cohostDiscordIds: ["cohost"],
  state: "RECRUITING",
  revision: 0,
  viewerRole: "HOST",
  participants: [],
  currentGame: null,
  recruitmentCounts: { ready: 0, maybe: 0, away: 0, held: 0, remaining: 10 },
  recruitmentMessageId: null,
  teamAVoiceChannelId: null,
  teamBVoiceChannelId: null,
  lastActivityAt: "2026-08-29T12:00:00.000Z",
  expiresAt: "2026-08-30T00:00:00.000Z",
  endedAt: null,
};

const CAPTAIN: CustomGameParticipant = {
  discordId: "captain",
  displayName: "Captain",
  playerId: 1,
  playerAlias: "captain",
  accountId: 1,
  puuid: "puuid",
  riotGameName: null,
  riotTagLine: null,
  rosterOrder: 0,
  benchOrder: null,
  team: "A",
  side: "BLUE",
  captain: true,
  pickOrder: null,
  championId: null,
  won: null,
};

describe("custom authorization", () => {
  test("host, cohost, and administrator can manage", () => {
    expect(canManageCustomNight(customRoleFor(SNAPSHOT, "host", false))).toBe(
      true,
    );
    expect(canManageCustomNight(customRoleFor(SNAPSHOT, "cohost", false))).toBe(
      true,
    );
    expect(
      canManageCustomNight(customRoleFor(SNAPSHOT, "outsider", true)),
    ).toBe(true);
    expect(canManageCustomNight(customRoleFor(SNAPSHOT, "member", false))).toBe(
      false,
    );
  });

  test("captains draft only for their active team", () => {
    expect(canDraftForTeam("CAPTAIN", "captain", [CAPTAIN], "A")).toBe(true);
    expect(canDraftForTeam("CAPTAIN", "captain", [CAPTAIN], "B")).toBe(false);
    expect(canDraftForTeam("HOST", "host", [CAPTAIN], "B")).toBe(true);
  });
});
