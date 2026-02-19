/**
 * Tests for Guild Create Event Handler
 */

import { describe, it, expect, mock } from "bun:test";
import { z } from "zod";
import { handleGuildCreate } from "@scout-for-lol/backend/discord/events/guild-create";
import { ChannelType } from "discord.js";
import {
  mockGuild,
  mockTextChannel,
} from "@scout-for-lol/backend/testing/discord-mocks";
import {
  testGuildId,
  testAccountId,
} from "@scout-for-lol/backend/testing/test-ids";

describe("handleGuildCreate", () => {
  it("should send welcome message to system channel when available", async () => {
    const sendMock = mock((_msg: unknown) => Promise.resolve({}));

    const guild = mockGuild({
      name: "Test Server",
      id: testGuildId("123"),
      memberCount: 100,
      systemChannel: mockTextChannel({
        type: ChannelType.GuildText,
        name: "general",
        permissionsFor: mock(() => ({
          has: mock(() => true),
        })),
        send: sendMock,
      }),
      channels: {
        fetch: mock(() => Promise.resolve(new Map())),
      },
      members: {
        me: { id: testAccountId("999") },
      },
      client: {
        user: { id: testAccountId("999") },
      },
    });

    await handleGuildCreate(guild);

    expect(sendMock).toHaveBeenCalledTimes(1);
    // Verify the welcome message contains expected content
    const MessageSchema = z.object({ content: z.string() });
    const firstCall: unknown = sendMock.mock.calls[0]?.[0];
    const result = MessageSchema.safeParse(firstCall);
    if (!result.success) {
      throw new Error(`Invalid message structure: ${result.error.message}`);
    }
    const { content } = result.data;
    expect(content).toContain("Thanks for adding Scout");
    expect(content).toContain("https://scout-for-lol.com/getting-started");
    expect(content).toContain("/help");
    expect(content).toContain("/subscription add");
  });

  it("should find first available text channel if system channel unavailable", async () => {
    const sendMock = mock((_msg: unknown) => Promise.resolve({}));

    const mockChannel = mockTextChannel({
      type: ChannelType.GuildText,
      name: "welcome",
      permissionsFor: mock(() => ({
        has: mock(() => true),
      })),
      send: sendMock,
    });

    const guild = mockGuild({
      name: "Test Server",
      id: testGuildId("456"),
      memberCount: 50,
      systemChannel: null,
      channels: {
        fetch: mock(() => {
          const channelMap = new Map();
          channelMap.set("channel1", { type: ChannelType.GuildVoice });
          channelMap.set("channel2", mockChannel);
          return Promise.resolve(channelMap);
        }),
      },
      members: {
        me: { id: testAccountId("999") },
      },
      client: {
        user: { id: testAccountId("999") },
      },
    });

    await handleGuildCreate(guild);

    expect(sendMock).toHaveBeenCalledTimes(1);
    // Verify the welcome message contains expected content
    const MessageSchema = z.object({ content: z.string() });
    const firstCall: unknown = sendMock.mock.calls[0]?.[0];
    const result = MessageSchema.safeParse(firstCall);
    if (!result.success) {
      throw new Error(`Invalid message structure: ${result.error.message}`);
    }
    const { content } = result.data;
    expect(content).toContain("Thanks for adding Scout");
    expect(content).toContain("/help");
  });

  it("should handle case when no suitable channel found", async () => {
    const guild = mockGuild({
      name: "Test Server",
      id: testGuildId("789"),
      memberCount: 25,
      systemChannel: null,
      channels: {
        fetch: mock(() => {
          const channelMap = new Map();
          channelMap.set(
            "channel1",
            mockTextChannel({
              type: ChannelType.GuildText,
              permissionsFor: mock(() => ({
                has: mock(() => false), // No permissions
              })),
            }),
          );
          return Promise.resolve(channelMap);
        }),
      },
      members: {
        me: { id: testAccountId("999") },
      },
      client: {
        user: { id: testAccountId("999") },
      },
    });

    // Should not throw error, just log warning
    await expect(handleGuildCreate(guild)).resolves.toBeUndefined();
  });

  it("should handle errors gracefully when sending message fails", async () => {
    const sendMock = mock(() => Promise.reject(new Error("Permission denied")));

    const guild = mockGuild({
      name: "Test Server",
      id: testGuildId("101"),
      memberCount: 75,
      systemChannel: mockTextChannel({
        type: ChannelType.GuildText,
        name: "general",
        permissionsFor: mock(() => ({
          has: mock(() => true),
        })),
        send: sendMock,
      }),
      channels: {
        fetch: mock(() => Promise.resolve(new Map())),
      },
      members: {
        me: { id: testAccountId("999") },
      },
      client: {
        user: { id: testAccountId("999") },
      },
    });

    // Should not throw error, just log it
    await expect(handleGuildCreate(guild)).resolves.toBeUndefined();
    expect(sendMock).toHaveBeenCalledTimes(1);
  });
});
