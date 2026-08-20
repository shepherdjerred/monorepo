import { describe, expect, test } from "bun:test";
import {
  CustomNightSnapshotSchema,
  type CustomNightParticipant,
} from "@scout-for-lol/data";
import {
  anonymizeNightSnapshot,
  redactCustomValue,
} from "#src/customs/anonymize.ts";

const NOW = "2026-08-15T20:00:00.000Z";

function participant(discordId: string, name: string): CustomNightParticipant {
  return {
    discordId,
    displayName: name,
    avatarUrl: null,
    role: discordId === "12345678901234567" ? "HOST" : "MEMBER",
    availability: "READY",
    readyAt: NOW,
    awayUntil: null,
    awayOverdue: false,
    held: false,
    consentedAt: NOW,
    playerId: 1,
    playerAlias: name,
    accounts: [],
    selectedAccountId: null,
  };
}

describe("custom participant anonymization", () => {
  test("removes the participant and replaces host identity in a valid snapshot", () => {
    const target = "12345678901234567";
    const original = CustomNightSnapshotSchema.parse({
      id: "4df1fd22-770f-4f9b-a247-bd97a73c603d",
      guildId: "12345678901234567",
      guildName: "Guild",
      launchChannelId: "12345678901234567",
      voiceLobbyChannelId: "12345678901234567",
      hostDiscordId: target,
      cohostDiscordIds: [target],
      state: "ENDED",
      revision: 4,
      participants: [
        participant(target, "Sensitive Name"),
        participant("98765432109876543", "Remaining Player"),
      ],
      currentGame: null,
      recruitmentCounts: {
        ready: 2,
        maybe: 0,
        away: 0,
        held: 0,
        remaining: 8,
      },
      recruitmentMessageId: null,
      riotTournamentId: null,
      teamAVoiceChannelId: null,
      teamBVoiceChannelId: null,
      lastActivityAt: NOW,
      expiresAt: NOW,
      endedAt: NOW,
    });
    const anonymized = anonymizeNightSnapshot({
      snapshot: original,
      discordId: target,
      sensitive: {
        strings: new Set([target, "Sensitive Name"]),
        numbers: new Set([1]),
      },
    });
    expect(anonymized.revision).toBe(5);
    expect(anonymized.hostDiscordId).toBe("00000000000000000");
    expect(anonymized.cohostDiscordIds).toEqual([]);
    expect(anonymized.participants.map((entry) => entry.discordId)).toEqual([
      "98765432109876543",
    ]);
    expect(anonymized.recruitmentCounts.ready).toBe(1);
  });

  test("redacts identifiers nested in audit payloads and free text", () => {
    expect(
      redactCustomValue(
        {
          discordId: "12345678901234567",
          accountId: 42,
          revision: 42,
          note: "SpaceMan queued with Ace and Sensitive Name",
          mapLabel: "Ace",
          participantDiscordIds: ["12345678901234567"],
          rosterDiscordIds: ["12345678901234567"],
        },
        {
          strings: new Set(["12345678901234567", "Ace", "Sensitive Name"]),
          numbers: new Set([42]),
        },
      ),
    ).toEqual({
      discordId: "Anonymous player",
      accountId: null,
      revision: 42,
      note: "SpaceMan queued with Anonymous player and Anonymous player",
      mapLabel: "Ace",
      participantDiscordIds: ["Anonymous player"],
      rosterDiscordIds: ["Anonymous player"],
    });
  });
});
