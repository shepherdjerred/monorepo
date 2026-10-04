import { describe, expect, test } from "vitest";
import {
  CustomAuthExchangeInputSchema,
  CustomAuditEventSchema,
  CustomCreateNightInputSchema,
  CustomGameSnapshotSchema,
  CustomGameStateSchema,
  CustomNightSnapshotSchema,
  CustomJoinNightInputSchema,
  CustomRevisionInputSchema,
} from "#src/customs/customs.schema.ts";

describe("Customs contracts", () => {
  test("a game snapshot from an older backend drops the retired tournament lobby", () => {
    const current = {
      id: "018f173a-6f4a-7d19-b731-963d62a2e1bd",
      sequence: 1,
      state: "RESULT_PENDING",
      rosterMode: "FIRST_TEN",
      map: "SUMMONERS_RIFT",
      pickMode: "TOURNAMENT_DRAFT",
      participants: [],
      activeCaptain: null,
      winner: null,
      voiceState: "READY",
      voiceReady: true,
      voiceOverride: false,
      voiceError: null,
      createdAt: "2026-08-30T01:00:00.000Z",
      startedAt: "2026-08-30T01:05:00.000Z",
      completedAt: null,
    };
    const legacy = {
      ...current,
      tournamentLobby: { state: "resolved", code: "NA-LEGACY-CODE" },
    };

    const parsed = CustomGameSnapshotSchema.parse(legacy);

    expect(parsed).toEqual(current);
    expect("tournamentLobby" in parsed).toBe(false);
  });

  test("manual result state is not part of the game contract", () => {
    expect(CustomGameStateSchema.safeParse("MANUAL").success).toBe(false);
  });

  test("scheduled expiry is an explicit audit source", () => {
    expect(
      CustomAuditEventSchema.parse({
        id: "018f173a-6f4a-7d19-b731-963d62a2e1bd",
        nightId: "118f173a-6f4a-7d19-b731-963d62a2e1bd",
        gameId: null,
        revision: 1,
        actorId: "temporal:custom-nights-expiry",
        action: "NIGHT_EXPIRED",
        payload: {},
        source: "TEMPORAL",
        createdAt: "2026-08-30T01:00:00.000Z",
      }).source,
    ).toBe("TEMPORAL");
  });

  test("mutations always carry an expected revision", () => {
    expect(
      CustomRevisionInputSchema.safeParse({
        nightId: "018f173a-6f4a-7d19-b731-963d62a2e1bd",
      }).success,
    ).toBe(false);
  });

  test("clients cannot select the Customs disclosure version", () => {
    expect(
      CustomCreateNightInputSchema.safeParse({
        disclosureVersion: "obsolete",
      }).success,
    ).toBe(false);
    expect(
      CustomJoinNightInputSchema.safeParse({
        nightId: "018f173a-6f4a-7d19-b731-963d62a2e1bd",
        expectedRevision: 1,
        disclosureVersion: "obsolete",
      }).success,
    ).toBe(false);
  });

  test("Activity exchange rejects extra identity claims", () => {
    expect(
      CustomAuthExchangeInputSchema.safeParse({
        code: "code",
        guildId: "guild",
        channelId: "channel",
        instanceId: "instance",
        userId: "untrusted-client-claim",
      }).success,
    ).toBe(false);
  });

  test("night snapshots reject stored-provider duplication", () => {
    const result = CustomNightSnapshotSchema.safeParse({
      id: "018f173a-6f4a-7d19-b731-963d62a2e1bd",
      guildId: "guild",
      guildName: "Guild",
      launchChannelId: "launch",
      voiceLobbyChannelId: "voice",
      hostDiscordId: "host",
      cohostDiscordIds: [],
      state: "RECRUITING",
      revision: 0,
      viewerRole: "HOST",
      participants: [],
      currentGame: null,
      recruitmentCounts: {
        ready: 0,
        maybe: 0,
        away: 0,
        held: 0,
        remaining: 10,
      },
      recruitmentMessageId: null,
      riotTournamentId: "duplicated-provider-state",
      teamAVoiceChannelId: null,
      teamBVoiceChannelId: null,
      lastActivityAt: "2026-08-29T12:00:00.000Z",
      expiresAt: "2026-08-30T00:00:00.000Z",
      endedAt: null,
    });
    expect(result.success).toBe(false);
  });
});
