import { describe, expect, test } from "vitest";
import { CustomNightSnapshotSchema } from "@scout-for-lol/data";
import { customRecruitmentMessage } from "#src/customs/recruitment-message.ts";

function snapshot(state: "RECRUITING" | "ENDED") {
  return CustomNightSnapshotSchema.parse({
    id: "00000000-0000-4000-8000-000000000001",
    guildId: "1",
    guildName: "Beta",
    launchChannelId: "2",
    voiceLobbyChannelId: "2",
    hostDiscordId: "3",
    cohostDiscordIds: [],
    state,
    revision: 0,
    viewerRole: "HOST",
    participants: [],
    currentGame: null,
    recruitmentCounts: { ready: 4, maybe: 2, away: 1, held: 1, remaining: 6 },
    recruitmentMessageId: null,
    teamAVoiceChannelId: null,
    teamBVoiceChannelId: null,
    lastActivityAt: "2026-08-29T10:00:00.000Z",
    expiresAt: "2026-08-29T22:00:00.000Z",
    endedAt: state === "ENDED" ? "2026-08-29T12:00:00.000Z" : null,
  });
}

describe("custom recruitment message fixture", () => {
  test("shows consent and live recruitment counts", () => {
    const embed = customRecruitmentMessage(snapshot("RECRUITING")).embeds?.[0];
    expect(embed?.toJSON()).toMatchObject({
      title: "Scout Customs",
      description:
        "Open the Scout Customs Activity in this channel to join. 6 more players needed.",
      fields: [
        { name: "Ready", value: "4", inline: true },
        { name: "Maybe", value: "2", inline: true },
        { name: "Away", value: "1", inline: true },
        { name: "Held", value: "1", inline: true },
      ],
    });
    expect(embed?.toJSON().footer?.text).toContain("consent");
  });

  test("renders a terminal message after the night ends", () => {
    expect(
      customRecruitmentMessage(snapshot("ENDED")).embeds?.[0]?.toJSON()
        .description,
    ).toBe("This custom-game night has ended.");
  });
});
