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
 * The DM now flows through `sendDM` -> `client.users.fetch(ownerId).send()`, so
 * the recipient's `send` (not the GuildMember's) is what actually delivers.
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
  test("sends DM to server owner with permission error details", async () => {
    const sentMessages: string[] = [];
    const client = clientCapturingDm(async (message: string) => {
      sentMessages.push(message);
    });

    await notifyServerOwnerAboutPermissionError(
      client,
      serverId,
      channelId,
      "Missing Send Messages permission",
    );

    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]).toContain("Bot Permission Issue");
    expect(sentMessages[0]).toContain("Test Server");
    expect(sentMessages[0]).toContain(`<#${channelId}>`);
    expect(sentMessages[0]).toContain("Missing Send Messages permission");
  });

  test("handles case when guild is not found", async () => {
    const client = mockClient({
      guilds: {
        fetch: async () => null,
      },
    });

    await expect(
      notifyServerOwnerAboutPermissionError(client, serverId, channelId),
    ).resolves.toBeUndefined();
  });

  test("handles case when owner fetch fails", async () => {
    const client = mockClient({
      guilds: {
        fetch: async () => ({
          name: "Test Server",
          fetchOwner: async () => null,
        }),
      },
    });

    await expect(
      notifyServerOwnerAboutPermissionError(client, serverId, channelId),
    ).resolves.toBeUndefined();
  });

  test("handles case when DM send fails (user has DMs disabled)", async () => {
    const client = clientCapturingDm(() => {
      throw new Error("Cannot send messages to this user");
    });

    await expect(
      notifyServerOwnerAboutPermissionError(client, serverId, channelId),
    ).resolves.toBeUndefined();
  });

  test("handles generic error during DM send", async () => {
    const client = clientCapturingDm(() => {
      throw new Error("Network error");
    });

    await expect(
      notifyServerOwnerAboutPermissionError(client, serverId, channelId),
    ).resolves.toBeUndefined();
  });

  test("includes reason in message when provided", async () => {
    const sentMessages: string[] = [];
    const client = clientCapturingDm(async (message: string) => {
      sentMessages.push(message);
    });

    await notifyServerOwnerAboutPermissionError(
      client,
      serverId,
      channelId,
      "Custom error reason",
    );

    expect(sentMessages[0]).toContain("Custom error reason");
  });

  test("works without reason parameter", async () => {
    const sentMessages: string[] = [];
    const client = clientCapturingDm(async (message: string) => {
      sentMessages.push(message);
    });

    await notifyServerOwnerAboutPermissionError(client, serverId, channelId);

    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]).toContain("Bot Permission Issue");
    expect(sentMessages[0]).not.toContain("**Reason:**");
  });
});
