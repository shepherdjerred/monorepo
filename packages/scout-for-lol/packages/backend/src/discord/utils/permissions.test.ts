import { describe, expect, test } from "vitest";
import {
  isPermissionError,
  isMissingChannelError,
  checkSendMessagePermission,
  getPermissionErrorMessage,
  formatPermissionErrorForLog,
} from "#src/discord/utils/permissions.ts";
import { PermissionFlagsBits } from "discord.js";
import { mockTextChannel } from "#src/testing/discord-mocks.ts";
import { testAccountId } from "#src/testing/test-ids.ts";

// The bot's own user id, which for a Discord bot is its application id. The
// helpers take the id rather than a `User` object precisely so they work on a
// process with no gateway, where `client.user` is null.
const BOT_USER_ID = testAccountId("999");

// A guild whose member reads always fail — the shape every "cannot access
// channel" case shares. One helper instead of repeating the mock keeps the
// fixtures from drifting apart (and the jscpd ratchet honest).
const unreachableGuild = () => ({
  members: {
    me: null,
    fetch: async () => {
      throw new Error("Fetch failed");
    },
  },
});

describe("isPermissionError", () => {
  test("returns true for Discord missing permissions error (50013)", () => {
    const error = { code: 50_013, message: "Missing Permissions" };
    expect(isPermissionError(error)).toBe(true);
  });

  test("returns true for Discord missing access error (50001)", () => {
    const error = { code: 50_001, message: "Missing Access" };
    expect(isPermissionError(error)).toBe(true);
  });

  test("returns false for other error codes", () => {
    const error = { code: 10_003, message: "Unknown Channel" };
    expect(isPermissionError(error)).toBe(false);
  });

  test("returns false for non-Discord errors", () => {
    const error = new Error("Generic error");
    expect(isPermissionError(error)).toBe(false);
  });

  test("returns false for invalid error objects", () => {
    expect(isPermissionError("string error")).toBe(false);
    expect(isPermissionError(123)).toBe(false);
    expect(isPermissionError(null)).toBe(false);
    expect(isPermissionError(void 0)).toBe(false);
  });
});

describe("isMissingChannelError", () => {
  test("returns true for Unknown Channel (10003) and Unknown Guild (10004)", () => {
    expect(
      isMissingChannelError({ code: 10_003, message: "Unknown Channel" }),
    ).toBe(true);
    expect(
      isMissingChannelError({ code: 10_004, message: "Unknown Guild" }),
    ).toBe(true);
  });

  test("returns false for permission errors and non-Discord errors", () => {
    expect(
      isMissingChannelError({ code: 50_013, message: "Missing Permissions" }),
    ).toBe(false);
    expect(isMissingChannelError(new Error("boom"))).toBe(false);
    expect(isMissingChannelError(null)).toBe(false);
  });
});

describe("checkSendMessagePermission", () => {
  test("returns true for DM channels", async () => {
    const dmChannel = mockTextChannel({
      isDMBased: () => true,
    });
    const result = await checkSendMessagePermission(dmChannel, BOT_USER_ID);
    expect(result.hasPermission).toBe(true);
  });

  test("returns false when channel doesn't have permissionsFor method", async () => {
    const invalidChannel = mockTextChannel({
      isDMBased: () => false,
      permissionsFor: undefined,
      guild: unreachableGuild(),
    });
    const result = await checkSendMessagePermission(
      invalidChannel,
      BOT_USER_ID,
    );
    expect(result.hasPermission).toBe(false);
    expect(result.reason).toContain("Error checking permissions");
  });

  test("returns false when permissionsFor returns null", async () => {
    // This is also the case that used to be reported as "Bot user not
    // available". There is no such outcome any more: the bot's id is known from
    // configuration whether or not this process holds a gateway, so a guild
    // that cannot be read is reported as exactly that — and the delivery path
    // no longer turns a missing `client.user` into a permission complaint sent
    // to the guild owner.
    const channel = mockTextChannel({
      isDMBased: () => false,
      permissionsFor: () => null,
      guild: unreachableGuild(),
    });
    const result = await checkSendMessagePermission(channel, BOT_USER_ID);
    expect(result.hasPermission).toBe(false);
    expect(result.reason).toContain("Cannot access channel");
  });

  test("returns false when bot missing SendMessages permission", async () => {
    const channel = mockTextChannel({
      isDMBased: () => false,
      permissionsFor: () => ({
        has: (permission: bigint) => {
          // Has ViewChannel but not SendMessages
          return permission === PermissionFlagsBits.ViewChannel;
        },
      }),
      guild: unreachableGuild(),
    });
    const result = await checkSendMessagePermission(channel, BOT_USER_ID);
    expect(result.hasPermission).toBe(false);
    expect(result.reason).toContain("Send Messages");
  });

  test("returns false when bot missing ViewChannel permission", async () => {
    const channel = mockTextChannel({
      isDMBased: () => false,
      permissionsFor: () => ({
        has: (permission: bigint) => {
          // Has SendMessages but not ViewChannel
          return permission === PermissionFlagsBits.SendMessages;
        },
      }),
      guild: unreachableGuild(),
    });
    const result = await checkSendMessagePermission(channel, BOT_USER_ID);
    expect(result.hasPermission).toBe(false);
    expect(result.reason).toContain("cannot view");
  });

  test("returns true when bot has both required permissions", async () => {
    const channel = mockTextChannel({
      isDMBased: () => false,
      permissionsFor: () => ({
        has: (permission: bigint) => {
          // Has both ViewChannel and SendMessages
          return (
            permission === PermissionFlagsBits.ViewChannel ||
            permission === PermissionFlagsBits.SendMessages
          );
        },
      }),
      guild: unreachableGuild(),
    });
    const result = await checkSendMessagePermission(channel, BOT_USER_ID);
    expect(result.hasPermission).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  test("handles errors when checking permissions", async () => {
    const channel = mockTextChannel({
      isDMBased: () => false,
      permissionsFor: () => {
        throw new Error("Permission check failed");
      },
      guild: unreachableGuild(),
    });
    const result = await checkSendMessagePermission(channel, BOT_USER_ID);
    expect(result.hasPermission).toBe(false);
    expect(result.reason).toContain("Error checking permissions");
  });
});

describe("checkSendMessagePermission - member resolution", () => {
  test("uses guild.members.me when available", async () => {
    const mockMe = { id: "bot-member-id" };
    const channel = mockTextChannel({
      isDMBased: () => false,
      permissionsFor: (target: unknown) => {
        // Verify we're using the member object, not the user
        expect(target).toBe(mockMe);
        return {
          has: () => true,
        };
      },
      guild: {
        members: {
          me: mockMe,
          fetch: () => Promise.resolve(mockMe),
        },
      },
    });
    const result = await checkSendMessagePermission(channel, BOT_USER_ID);
    expect(result.hasPermission).toBe(true);
  });

  test("fetches bot member when guild.members.me is not available", async () => {
    const mockMember = { id: "bot-member-id" };
    let fetchCalled = false;
    const channel = mockTextChannel({
      isDMBased: () => false,
      permissionsFor: (target: unknown) => {
        // Should use the fetched member
        expect(target).toBe(mockMember);
        return {
          has: () => true,
        };
      },
      guild: {
        members: {
          me: null,
          fetch: async (userId: string) => {
            fetchCalled = true;
            expect(userId).toBe(testAccountId("999"));
            return mockMember;
          },
        },
      },
    });
    const result = await checkSendMessagePermission(channel, BOT_USER_ID);
    expect(result.hasPermission).toBe(true);
    expect(fetchCalled).toBe(true);
  });

  test("falls back to the bot user id when the member fetch fails", async () => {
    const channel = mockTextChannel({
      isDMBased: () => false,
      permissionsFor: (target: unknown) => {
        // A snowflake is a UserResolvable, so discord.js resolves it against
        // the guild itself rather than needing a cached User object.
        expect(target).toBe(BOT_USER_ID);
        return {
          has: () => true,
        };
      },
      guild: unreachableGuild(),
    });
    const result = await checkSendMessagePermission(channel, BOT_USER_ID);
    expect(result.hasPermission).toBe(true);
  });
});

describe("getPermissionErrorMessage", () => {
  test("includes channel ID in message", () => {
    const message = getPermissionErrorMessage("123456789");
    expect(message).toContain("<#123456789>");
  });

  test("includes reason when provided", () => {
    const message = getPermissionErrorMessage(
      "123456789",
      "Missing Send Messages permission",
    );
    expect(message).toContain("Missing Send Messages permission");
  });

  test("provides default message when no reason given", () => {
    const message = getPermissionErrorMessage("123456789");
    expect(message).toContain("Send Messages");
    expect(message).toContain("View Channel");
  });
});

describe("formatPermissionErrorForLog", () => {
  test("formats permission error correctly", () => {
    const error = { code: 50_013, message: "Missing Permissions" };
    const message = formatPermissionErrorForLog(
      "123456789",
      error,
      "Missing Send Messages",
    );
    expect(message).toContain("123456789");
    expect(message).toContain("Missing Send Messages");
    expect(message).toContain("Discord Permission Error");
  });

  test("formats non-permission error correctly", () => {
    const error = new Error("Network error");
    const message = formatPermissionErrorForLog("123456789", error);
    expect(message).toContain("123456789");
    expect(message).toContain("Network error");
    expect(message).not.toContain("Discord Permission Error");
  });

  test("includes reason when provided", () => {
    const error = { code: 50_013, message: "Missing Permissions" };
    const message = formatPermissionErrorForLog(
      "123456789",
      error,
      "Custom reason",
    );
    expect(message).toContain("Custom reason");
  });
});
