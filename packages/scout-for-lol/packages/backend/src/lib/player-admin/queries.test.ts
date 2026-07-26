import { describe, expect, test } from "bun:test";
import { createPermissionSet } from "@scout-for-lol/data";
import {
  serializePlayerDetail,
  serializePlayerSummary,
} from "#src/lib/player-admin/queries.ts";

const detail = {
  id: 1,
  alias: "player",
  discordId: "100000000000000001",
  creatorDiscordId: "100000000000000002",
  createdTime: new Date("2026-01-01T00:00:00Z"),
  updatedTime: new Date("2026-01-02T00:00:00Z"),
  accounts: [
    {
      id: 2,
      alias: "account",
      puuid: "secret-puuid",
      region: "AMERICA_NORTH",
      riotGameName: "Player",
      riotTagLine: "NA1",
      lastMatchTime: null,
      lastCheckedAt: null,
    },
  ],
  subscriptions: [
    {
      id: 3,
      channelId: "100000000000000003",
      creatorDiscordId: "100000000000000002",
      createdTime: new Date("2026-01-03T00:00:00Z"),
    },
  ],
  competitionParticipants: [
    {
      id: 4,
      status: "JOINED",
      invitedBy: "100000000000000002",
      invitedAt: null,
      joinedAt: new Date("2026-01-04T00:00:00Z"),
      leftAt: null,
      competition: {
        id: 5,
        title: "Competition",
        isCancelled: false,
        visibility: "OPEN",
        startDate: null,
        endDate: null,
        seasonId: null,
      },
    },
  ],
};

const summary = {
  id: detail.id,
  alias: detail.alias,
  discordId: detail.discordId,
  updatedTime: detail.updatedTime,
  accounts: detail.accounts.map((account) => ({ id: account.id })),
  subscriptions: detail.subscriptions.map((subscription) => ({
    id: subscription.id,
    channelId: subscription.channelId,
  })),
};

describe("serializePlayerSummary", () => {
  test("redacts related-resource metadata without its read scopes", () => {
    const permissions = createPermissionSet([
      { resource: "players", action: "read" },
    ]);

    const serialized = serializePlayerSummary(summary, {}, permissions);

    expect(serialized.accountCount).toBe(0);
    expect(serialized.subscriptionCount).toBe(0);
    expect(serialized.channelIds).toEqual([]);
  });

  test("includes related-resource metadata with its read scopes", () => {
    const permissions = createPermissionSet([
      { resource: "players", action: "read" },
      { resource: "accounts", action: "read" },
      { resource: "subscriptions", action: "read" },
    ]);

    const serialized = serializePlayerSummary(summary, {}, permissions);

    expect(serialized.accountCount).toBe(1);
    expect(serialized.subscriptionCount).toBe(1);
    expect(serialized.channelIds).toEqual(["100000000000000003"]);
  });
});

describe("serializePlayerDetail", () => {
  test("redacts related resources without their read scopes", () => {
    const permissions = createPermissionSet([
      { resource: "players", action: "read" },
    ]);

    const serialized = serializePlayerDetail(detail, {}, permissions);

    expect(serialized.accounts).toEqual([]);
    expect(serialized.subscriptions).toEqual([]);
    expect(serialized.competitions).toEqual([]);
  });

  test("includes each related resource when its read scope is held", () => {
    const permissions = createPermissionSet([
      { resource: "players", action: "read" },
      { resource: "accounts", action: "read" },
      { resource: "subscriptions", action: "read" },
      { resource: "competitions", action: "read" },
    ]);

    const serialized = serializePlayerDetail(detail, {}, permissions);

    expect(serialized.accounts).toHaveLength(1);
    expect(serialized.accounts[0]?.puuid).toBe("secret-puuid");
    expect(serialized.subscriptions).toHaveLength(1);
    expect(serialized.competitions).toHaveLength(1);
  });
});
