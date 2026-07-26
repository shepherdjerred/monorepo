import { describe, expect, test } from "bun:test";
import { DiscordApiChannelSchema } from "#shared/glitter-corpus.ts";
import {
  effectiveChannelPermissions,
  scopeEntry,
} from "./glitter-corpus-scope.ts";
import { requireMessageContentIntent } from "./glitter-corpus-discord.ts";

const VIEW_AND_HISTORY = String((1n << 10n) | (1n << 16n));

function channel(input?: {
  type?: 0 | 11 | 12 | 15;
  overwrites?: {
    id: string;
    type: 0 | 1;
    allow: string;
    deny: string;
  }[];
}) {
  return DiscordApiChannelSchema.parse({
    id: "456",
    guild_id: "123",
    parent_id: null,
    name: "public",
    type: input?.type ?? 0,
    permission_overwrites: input?.overwrites ?? [],
  });
}

describe("Glitter Discord inventory permissions", () => {
  test("requires both View Channel and Read Message History", () => {
    const permissions = effectiveChannelPermissions({
      guildId: "123",
      botUserId: "999",
      roleIds: [],
      guildRoles: [{ id: "123", permissions: VIEW_AND_HISTORY }],
      channel: channel(),
    });
    expect(
      (permissions & BigInt(VIEW_AND_HISTORY)) === BigInt(VIEW_AND_HISTORY),
    ).toBe(true);

    const entry = scopeEntry({
      guildId: "123",
      botUserId: "999",
      memberRoleIds: [],
      guildRoles: [{ id: "123", permissions: VIEW_AND_HISTORY }],
      denylist: new Set(),
      discoveredAt: "2026-07-26T00:00:00.000Z",
      channel: channel(),
      permissionChannel: channel(),
    });
    expect(entry.scopeDecision).toBe("include");
  });

  test("channel overwrite denial excludes an otherwise visible channel", () => {
    const entry = scopeEntry({
      guildId: "123",
      botUserId: "999",
      memberRoleIds: [],
      guildRoles: [{ id: "123", permissions: VIEW_AND_HISTORY }],
      denylist: new Set(),
      discoveredAt: "2026-07-26T00:00:00.000Z",
      channel: channel({
        overwrites: [
          {
            id: "123",
            type: 0,
            allow: "0",
            deny: String(1n << 16n),
          },
        ],
      }),
      permissionChannel: channel({
        overwrites: [
          {
            id: "123",
            type: 0,
            allow: "0",
            deny: String(1n << 16n),
          },
        ],
      }),
    });
    expect(entry.scopeDecision).toBe("exclude-no-history-permission");
  });

  test("private threads are excluded even with administrator visibility", () => {
    const entry = scopeEntry({
      guildId: "123",
      botUserId: "999",
      memberRoleIds: [],
      guildRoles: [{ id: "123", permissions: "8" }],
      denylist: new Set(),
      discoveredAt: "2026-07-26T00:00:00.000Z",
      channel: channel({ type: 12 }),
      permissionChannel: channel(),
    });
    expect(entry.scopeDecision).toBe("exclude-private-thread");
  });

  test("forum parents are inventory-only while their public threads are included", () => {
    const base = {
      guildId: "123",
      botUserId: "999",
      memberRoleIds: [],
      guildRoles: [{ id: "123", permissions: VIEW_AND_HISTORY }],
      denylist: new Set<string>(),
      discoveredAt: "2026-07-26T00:00:00.000Z",
    };
    expect(
      scopeEntry({
        ...base,
        channel: channel({ type: 15 }),
        permissionChannel: channel({ type: 15 }),
      }).scopeDecision,
    ).toBe("exclude-non-message-channel");
    expect(
      scopeEntry({
        ...base,
        channel: channel({ type: 11 }),
        permissionChannel: channel(),
      }).scopeDecision,
    ).toBe("include");
  });

  test("public threads use their parent channel's permission overwrites", () => {
    const entry = scopeEntry({
      guildId: "123",
      botUserId: "999",
      memberRoleIds: [],
      guildRoles: [{ id: "123", permissions: "0" }],
      denylist: new Set(),
      discoveredAt: "2026-07-26T00:00:00.000Z",
      channel: channel({ type: 11 }),
      permissionChannel: channel({
        overwrites: [
          {
            id: "123",
            type: 0,
            allow: VIEW_AND_HISTORY,
            deny: "0",
          },
        ],
      }),
    });
    expect(entry.scopeDecision).toBe("include");
  });
});

describe("Glitter Discord content preflight", () => {
  test("accepts either enabled Message Content application flag", () => {
    expect(() =>
      requireMessageContentIntent({
        applicationId: "123",
        botUserId: "123",
        flagsNew: String(1 << 19),
      }),
    ).not.toThrow();
    expect(() =>
      requireMessageContentIntent({
        applicationId: "123",
        botUserId: "123",
        flags: 1 << 18,
      }),
    ).not.toThrow();
  });

  test("rejects disabled content access and mismatched identities", () => {
    expect(() =>
      requireMessageContentIntent({
        applicationId: "123",
        botUserId: "123",
        flagsNew: "0",
      }),
    ).toThrow("Message Content intent is not enabled");
    expect(() =>
      requireMessageContentIntent({
        applicationId: "123",
        botUserId: "456",
        flagsNew: String(1 << 19),
      }),
    ).toThrow("does not match bot user");
  });
});
