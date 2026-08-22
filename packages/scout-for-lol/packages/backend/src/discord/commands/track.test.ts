import { describe, expect, test, vi } from "vitest";
import type { ChatInputCommandInteraction } from "discord.js";
import type { AddSubscriptionResult } from "#src/lib/subscription/types.ts";
import {
  executeTrack,
  formatTrackResult,
} from "#src/discord/commands/track.ts";

type TrackInteraction = Parameters<typeof executeTrack>[0];

describe("/track", () => {
  test("rejects direct messages and invalid command input", async () => {
    const replyMock = vi.fn(
      (payload: Parameters<ChatInputCommandInteraction["reply"]>[0]) =>
        Promise.resolve(payload),
    );
    const deferReplyMock = vi.fn(
      (options: Parameters<ChatInputCommandInteraction["deferReply"]>[0]) =>
        Promise.resolve(options),
    );
    const editReplyMock = vi.fn(
      (options: Parameters<ChatInputCommandInteraction["editReply"]>[0]) =>
        Promise.resolve(options),
    );
    const interaction: TrackInteraction = {
      guildId: null,
      channelId: "312300000000000001",
      user: { id: "312300000000000002" },
      options: { getString: () => "Faker#KR1" },
      reply: replyMock,
      deferReply: deferReplyMock,
      editReply: editReplyMock,
      replied: false,
      deferred: false,
    };

    await executeTrack(interaction);

    expect(replyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ephemeral: true,
        content: expect.stringContaining("can only be used in a server"),
      }),
    );
  });

  test("formats the happy path with a dashboard escalation", () => {
    const result: AddSubscriptionResult = {
      kind: "created",
      subscription: { id: 1 },
      account: { id: 2, puuid: "p", region: "na1", alias: "Faker" },
      player: { id: 3, alias: "faker", accounts: [] },
      isAddingToExistingPlayer: false,
      isFirstSubscription: true,
      warnings: [],
    };

    const message = formatTrackResult(result);
    expect(message).toContain("Now tracking");
    expect(message).toContain("/app/");
  });

  test("formats duplicate and domain-error responses", () => {
    expect(
      formatTrackResult({
        kind: "subscription-already-exists",
        playerAlias: "faker",
        addedToExistingPlayer: false,
        playerId: 1,
        accountId: 2,
        accounts: [],
      }),
    ).toContain("already tracked");
    expect(
      formatTrackResult({ kind: "riot-id-not-found", message: "not found" }),
    ).toContain("not found");
  });

  test("reports an attached account rather than a no-op", () => {
    const message = formatTrackResult({
      kind: "subscription-already-exists",
      playerAlias: "faker",
      addedToExistingPlayer: true,
      playerId: 1,
      accountId: 2,
      accounts: [
        { alias: "faker", region: "KR" },
        { alias: "faker", region: "NA" },
      ],
    });
    expect(message).toContain("Added that Riot account");
    expect(message).toContain("2 accounts");
  });
});
