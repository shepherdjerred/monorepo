/**
 * The Activity's actor resolution reads Discord over REST, so it must work with
 * no gateway — and must keep "Discord is unreachable" (503) distinct from "you
 * are not in this server" (403).
 */

import { describe, expect, test, vi } from "vitest";
import { ChannelType, PermissionFlagsBits } from "discord.js";
import type { CustomActivityClaims } from "@scout-for-lol/data";
import { DiscordUpstreamError } from "#src/lib/discord-rest.ts";
import type { BotRestReader } from "#src/lib/discord/bot-rest.ts";
import type {
  DiscordChannel,
  DiscordGuildMember,
} from "#src/lib/discord/bot-rest-schemas.ts";
import {
  testAccountId,
  testChannelId,
  testGuildId,
} from "#src/testing/test-ids.ts";

const GUILD = testGuildId("851");
const CHANNEL = testChannelId("852");
const ACTOR = testAccountId("853");
const ADMIN_ROLE = "854";

const state: {
  member: DiscordGuildMember | null;
  channel: DiscordChannel | null;
  unavailable: boolean;
  adminRole: boolean;
  ownerId: string;
} = {
  member: null,
  channel: null,
  unavailable: false,
  adminRole: false,
  // Somebody else owns the server unless a test says otherwise.
  ownerId: "000",
};

function guard<T>(produce: () => T): Promise<T> {
  if (state.unavailable) {
    return Promise.reject(
      new DiscordUpstreamError("fetch_error", "Discord is unreachable"),
    );
  }
  return Promise.resolve(produce());
}

function unused(): never {
  throw new Error("not used by the Activity actor");
}

const fakeRest: BotRestReader = {
  guild: () =>
    guard(() => ({ id: GUILD, name: "Server", owner_id: state.ownerId })),
  guildExists: () => guard(() => true),
  guildChannels: unused,
  guildRoles: () =>
    guard(() => [
      { id: GUILD, name: "@everyone", permissions: "0" },
      {
        id: ADMIN_ROLE,
        name: "Admins",
        permissions: state.adminRole
          ? PermissionFlagsBits.Administrator.toString()
          : "0",
      },
    ]),
  botMember: unused,
  guildMember: () => guard(() => state.member),
  freshGuildMember: () => guard(() => state.member),
  searchGuildMembers: unused,
  user: unused,
  channel: () => guard(() => state.channel),
  clearCaches: () => {
    /* the fake holds no cache */
  },
};

const activityAuth = await import("#src/customs/activity/activity-auth.ts");
const botRestModule = await import("#src/lib/discord/bot-rest.ts");

vi.doMock("#src/lib/discord/bot-rest.ts", () => ({
  ...botRestModule,
  botRest: () => fakeRest,
}));
vi.doMock("#src/lib/discord/installed-guilds.ts", () => ({
  installedGuildName: () => Promise.resolve("Recorded Server"),
  isScoutInstalledInGuild: () => Promise.resolve(true),
  installedGuildIdsAmong: () => Promise.resolve(new Set<string>()),
}));
vi.doMock("#src/customs/activity/activity-auth.ts", () => ({
  ...activityAuth,
  assertCustomActivityPolicy: () => Promise.resolve(),
}));

const { assertCustomLaunchChannel, customActivityActor } =
  await import("#src/customs/activity/activity-actor.ts");

const claims: CustomActivityClaims = {
  sub: ACTOR,
  guildId: GUILD,
  channelId: CHANNEL,
  instanceId: "instance",
  applicationId: "application",
  type: "customs_activity",
};

function member(roles: string[]): DiscordGuildMember {
  return {
    user: { id: ACTOR, username: "player", global_name: "Player" },
    nick: "Nick",
    avatar: null,
    roles,
  };
}

function voiceChannel(overrides: Partial<DiscordChannel> = {}): DiscordChannel {
  return {
    id: CHANNEL,
    name: "lobby",
    type: ChannelType.GuildVoice,
    parent_id: null,
    permission_overwrites: [],
    guild_id: GUILD,
    ...overrides,
  };
}

function reset(): void {
  state.member = member([]);
  state.channel = voiceChannel();
  state.unavailable = false;
  state.adminRole = false;
  state.ownerId = "000";
}

describe("customActivityActor", () => {
  test("names the guild from the recorded install, not a gateway cache", async () => {
    reset();
    const actor = await customActivityActor(claims);
    expect(actor).toMatchObject({
      guildName: "Recorded Server",
      displayName: "Nick",
      administrator: false,
    });
  });

  test("derives Administrator by joining the member's roles against the guild's", async () => {
    reset();
    state.member = member([ADMIN_ROLE]);
    state.adminRole = true;
    await expect(customActivityActor(claims)).resolves.toMatchObject({
      administrator: true,
    });
  });

  test("the guild owner is Administrator with no admin role", async () => {
    // Discord grants the owner everything implicitly, so a roles-only answer
    // would deny the one person who can do anything in their own server.
    reset();
    state.ownerId = ACTOR;
    await expect(customActivityActor(claims)).resolves.toMatchObject({
      administrator: true,
    });
  });

  test("a non-owner without an admin role is not Administrator", async () => {
    reset();
    state.member = member([ADMIN_ROLE]);
    state.adminRole = false;
    await expect(customActivityActor(claims)).resolves.toMatchObject({
      administrator: false,
    });
  });

  test("a non-member is 403", async () => {
    reset();
    state.member = null;
    await expect(customActivityActor(claims)).rejects.toMatchObject({
      status: 403,
    });
  });

  test("an unreachable Discord is 503, not 403", async () => {
    reset();
    state.unavailable = true;
    await expect(customActivityActor(claims)).rejects.toMatchObject({
      status: 503,
    });
  });
});

describe("assertCustomLaunchChannel", () => {
  const actor = {
    discordId: ACTOR,
    guildId: GUILD,
    channelId: CHANNEL,
    guildName: "Recorded Server",
    displayName: "Nick",
    avatarUrl: undefined,
    administrator: false,
  };

  test("accepts a voice channel of the claimed guild", async () => {
    reset();
    await expect(assertCustomLaunchChannel(actor)).resolves.toBeUndefined();
  });

  test("rejects a text channel", async () => {
    reset();
    state.channel = voiceChannel({ type: ChannelType.GuildText });
    await expect(assertCustomLaunchChannel(actor)).rejects.toThrow(
      "guild voice channel",
    );
  });

  test("rejects a voice channel belonging to another guild", async () => {
    reset();
    state.channel = voiceChannel({ guild_id: testGuildId("999") });
    await expect(assertCustomLaunchChannel(actor)).rejects.toThrow(
      "guild voice channel",
    );
  });

  test("an unreachable Discord is 503, never a launch rejection", async () => {
    reset();
    state.unavailable = true;
    await expect(assertCustomLaunchChannel(actor)).rejects.toMatchObject({
      status: 503,
    });
  });
});
