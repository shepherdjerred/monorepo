import { describe, expect, test } from "bun:test";
import { notifyServerOwnerAboutPermissionError } from "#src/discord/utils/permissions.ts";
import { mockClient } from "#src/testing/discord-mocks.ts";
import {
  testGuildId,
  testAccountId,
  testChannelId,
} from "#src/testing/test-ids.ts";

const serverId = testGuildId("123");
const channelId = testChannelId("456");
const ownerId = testAccountId("789");

/**
 * Build a client whose guild owner is resolvable and whose DM send is captured.
 * The DM flows through `sendDM` -> `client.users.fetch(ownerId).send()`, so the
 * recipient's `send` (not the GuildMember's) is what actually delivers.
 */
function clientCapturingDm(send: (message: string) => Promise<unknown>) {
  return mockClient({
    guilds: {
      fetch: async () => ({
        name: "Test Server",
        fetchOwner: async () => ({
          id: ownerId,
          user: { tag: "TestOwner#1234" },
        }),
      }),
    },
    users: {
      cache: new Map(),
      fetch: async () => ({ tag: "TestOwner#1234", send }),
    },
  });
}

describe("notifyServerOwnerAboutPermissionError", () => {
  test("immediate stage: sends the initial permission-issue DM", async () => {
    const sentMessages: string[] = [];
    const client = clientCapturingDm(async (message: string) => {
      sentMessages.push(message);
    });

    await notifyServerOwnerAboutPermissionError({
      client,
      serverId,
      channelId,
      stage: "immediate",
      reason: "Missing Send Messages permission",
    });

    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]).toContain("Bot Permission Issue");
    expect(sentMessages[0]).toContain("Test Server");
    expect(sentMessages[0]).toContain(`<#${channelId}>`);
    expect(sentMessages[0]).toContain("Missing Send Messages permission");
  });

  test("week stage: sends the 1-week reminder copy", async () => {
    const sentMessages: string[] = [];
    const client = clientCapturingDm(async (message: string) => {
      sentMessages.push(message);
    });

    await notifyServerOwnerAboutPermissionError({
      client,
      serverId,
      channelId,
      stage: "week",
    });

    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]).toContain("Still can't post");
  });

  test("channel_missing kind: sends deleted-channel copy, not permission copy", async () => {
    const sentMessages: string[] = [];
    const client = clientCapturingDm(async (message: string) => {
      sentMessages.push(message);
    });

    await notifyServerOwnerAboutPermissionError({
      client,
      serverId,
      channelId,
      stage: "immediate",
      kind: "channel_missing",
    });

    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]).toContain("can't reach");
    expect(sentMessages[0]).not.toContain("Bot Permission Issue");
  });

  test("month stage: sends the final reminder with a feedback link", async () => {
    const sentMessages: string[] = [];
    const client = clientCapturingDm(async (message: string) => {
      sentMessages.push(message);
    });

    await notifyServerOwnerAboutPermissionError({
      client,
      serverId,
      channelId,
      stage: "month",
    });

    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]).toContain("Final reminder");
    expect(sentMessages[0]).toMatch(/https?:\/\//);
  });

  test("handles case when guild is not found", async () => {
    const client = mockClient({
      guilds: {
        fetch: async () => null,
      },
    });

    await expect(
      notifyServerOwnerAboutPermissionError({
        client,
        serverId,
        channelId,
        stage: "immediate",
      }),
    ).resolves.toBeUndefined();
  });

  test("handles case when DM send fails (user has DMs disabled)", async () => {
    const client = clientCapturingDm(() => {
      throw new Error("Cannot send messages to this user");
    });

    await expect(
      notifyServerOwnerAboutPermissionError({
        client,
        serverId,
        channelId,
        stage: "immediate",
      }),
    ).resolves.toBeUndefined();
  });

  test("includes reason in message when provided", async () => {
    const sentMessages: string[] = [];
    const client = clientCapturingDm(async (message: string) => {
      sentMessages.push(message);
    });

    await notifyServerOwnerAboutPermissionError({
      client,
      serverId,
      channelId,
      stage: "immediate",
      reason: "Custom error reason",
    });

    expect(sentMessages[0]).toContain("Custom error reason");
  });

  test("works without reason parameter", async () => {
    const sentMessages: string[] = [];
    const client = clientCapturingDm(async (message: string) => {
      sentMessages.push(message);
    });

    await notifyServerOwnerAboutPermissionError({
      client,
      serverId,
      channelId,
      stage: "immediate",
    });

    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]).toContain("Bot Permission Issue");
    expect(sentMessages[0]).not.toContain("**Reason:**");
  });
});
