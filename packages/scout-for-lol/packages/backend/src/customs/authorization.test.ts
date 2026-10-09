import { LeaguePuuidSchema } from "@scout-for-lol/domain/identity/league-account.ts";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  DiscordChannelIdSchema,
} from "@scout-for-lol/domain/identity/discord.ts";
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

const HOST_ACCOUNT = DiscordAccountIdSchema.parse("832206143528653125");
const COHOST_ACCOUNT = DiscordAccountIdSchema.parse("837655022129967818");

const SNAPSHOT: CustomNightSnapshot = {
  id: "018f173a-6f4a-7d19-b731-963d62a2e1bd",
  guildId: DiscordGuildIdSchema.parse("810135513265406599"),
  guildName: "Guild",
  launchChannelId: DiscordChannelIdSchema.parse("829863532286967615"),
  voiceLobbyChannelId: DiscordChannelIdSchema.parse("825942084019419946"),
  hostDiscordId: HOST_ACCOUNT,
  cohostDiscordIds: [COHOST_ACCOUNT],
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
  discordId: DiscordAccountIdSchema.parse("837826744103031196"),
  displayName: "Captain",
  playerId: 1,
  playerAlias: "837826744103031196",
  accountId: 1,
  puuid: LeaguePuuidSchema.parse(
    "puuid0000000000000000000000000000000000000000000000000000000000000000000000000",
  ),
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
    expect(
      canManageCustomNight(customRoleFor(SNAPSHOT, HOST_ACCOUNT, false)),
    ).toBe(true);
    expect(
      canManageCustomNight(customRoleFor(SNAPSHOT, COHOST_ACCOUNT, false)),
    ).toBe(true);
    expect(
      canManageCustomNight(
        customRoleFor(
          SNAPSHOT,
          DiscordAccountIdSchema.parse("830693552597407107"),
          true,
        ),
      ),
    ).toBe(true);
    expect(
      canManageCustomNight(
        customRoleFor(
          SNAPSHOT,
          DiscordAccountIdSchema.parse("837614830854307492"),
          false,
        ),
      ),
    ).toBe(false);
  });

  test("captains draft only for their active team", () => {
    expect(
      canDraftForTeam("CAPTAIN", "837826744103031196", [CAPTAIN], "A"),
    ).toBe(true);
    expect(
      canDraftForTeam("CAPTAIN", "837826744103031196", [CAPTAIN], "B"),
    ).toBe(false);
    expect(canDraftForTeam("HOST", HOST_ACCOUNT, [CAPTAIN], "B")).toBe(true);
  });
});
