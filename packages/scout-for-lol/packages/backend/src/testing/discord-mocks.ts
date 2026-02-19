/**
 * Shared Discord.js Type Mocks for Testing
 *
 * This module provides factory functions for creating mock Discord.js objects in tests.
 * These mocks eliminate the need for individual type assertions in test files.
 *
 * Usage:
 * ```ts
 * const user = mockUser({ username: "TestBot" });
 * const guild = mockGuild({ name: "Test Server" });
 * const channel = mockTextChannel({ name: "general" });
 * ```
 *
 * TODO(https://github.com/shepherdjerred/scout-for-lol/issues/177): Consider using a proper mocking library instead of type assertions
 * TODO(https://github.com/shepherdjerred/scout-for-lol/issues/191): Remove type assertion suppressions (Priority 1)
 */

import type {
  User,
  Guild,
  TextChannel,
  DMChannel,
  Client,
  GuildMember,
  Message,
  PermissionsBitField,
} from "discord.js";
import { ChannelType, PermissionFlagsBits } from "discord.js";
import { testAccountId, testGuildId, testChannelId } from "./test-ids.ts";

/**
 * Cast a plain object to a Discord.js type for testing.
 * Discord.js types are classes with many required properties;
 * in tests we only need partial implementations.
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- Centralized mock helper: Discord.js types are classes that can't be constructed without a real Client
function castMock<T>(obj: Record<string, unknown>): T {
  // eslint-disable-next-line custom-rules/no-type-assertions -- Discord.js types are classes that can't be constructed without a real Client
  return obj as unknown as T;
}

/**
 * Create a mock Discord User object
 */
export function mockUser(overrides: Record<string, unknown> = {}): User {
  const defaults: Record<string, unknown> = {
    id: testAccountId("1"),
    username: "TestUser",
    discriminator: "0000",
    globalName: "Test User",
    avatar: null,
    bot: false,
    system: false,
    mfaEnabled: false,
    banner: null,
    accentColor: null,
    locale: "en-US",
    verified: true,
    email: null,
    flags: null,
    premiumType: null,
    publicFlags: null,
    toString: () => `<@${testAccountId("1")}>`,
  };

  return castMock<User>({ ...defaults, ...overrides });
}

/**
 * Create a mock Discord GuildMember object
 * @lintignore
 */
export function mockGuildMember(
  overrides: Record<string, unknown> = {},
): GuildMember {
  const defaults: Record<string, unknown> = {
    id: testAccountId("2"),
    user: mockUser(),
    nickname: null,
    roles: {
      cache: new Map(),
      fetch: () => Promise.resolve(new Map()),
    },
    joinedAt: new Date(),
    premiumSince: null,
    mute: false,
    deaf: false,
    pending: false,
    communicationDisabledUntil: null,
    permissions: {
      has: (permission: bigint) =>
        permission === PermissionFlagsBits.ViewChannel,
    },
  };

  return castMock<GuildMember>({ ...defaults, ...overrides });
}

/**
 * Create a mock Discord Guild object
 */
export function mockGuild(overrides: Record<string, unknown> = {}): Guild {
  const defaults: Record<string, unknown> = {
    id: testGuildId("1"),
    name: "Test Guild",
    icon: null,
    splash: null,
    discoverySplash: null,
    owner: null,
    ownerId: testAccountId("1"),
    permissions: null,
    region: null,
    afkChannelId: null,
    afkTimeout: 300,
    widgetEnabled: true,
    widgetChannelId: null,
    verificationLevel: 0,
    defaultMessageNotifications: 0,
    explicitContentFilter: 0,
    roles: {
      cache: new Map(),
      fetch: () => Promise.resolve(new Map()),
    },
    emojis: {
      cache: new Map(),
      fetch: () => Promise.resolve(new Map()),
    },
    stickers: {
      cache: new Map(),
      fetch: () => Promise.resolve(new Map()),
    },
    createdTimestamp: Date.now(),
    defaultChannelId: null,
    systemChannelId: null,
    systemChannelFlags: null,
    rulesChannelId: null,
    publicUpdatesChannelId: null,
    maximumMembers: 250_000,
    maximumPresences: null,
    approximateMemberCount: 100,
    approximatePresenceCount: 50,
    vanityURLCode: null,
    vanityURLUses: null,
    banner: null,
    description: null,
    premiumTier: 0,
    premiumSubscriptionCount: 0,
    preferredLocale: "en-US",
    nsfwLevel: 0,
    nsfw: false,
    available: true,
    memberCount: 100,
    large: false,
    channels: {
      cache: new Map(),
      fetch: () => Promise.resolve(new Map()),
    },
    members: {
      cache: new Map(),
      fetch: () => Promise.resolve(new Map()),
      me: mockGuildMember(),
    },
    presences: {
      cache: new Map(),
    },
    voiceStates: {
      cache: new Map(),
    },
    stageInstances: {
      cache: new Map(),
    },
    invites: {
      cache: new Map(),
    },
    eventCount: 0,
    scheduledEvents: {
      cache: new Map(),
    },
    applicationId: null,
    systemChannel: null,
    rulesChannel: null,
    publicUpdatesChannel: null,
    safetyAlertsChannel: null,
    client: mockClient(),
  };

  return castMock<Guild>({ ...defaults, ...overrides });
}

/**
 * Create a mock Discord TextChannel object
 */
export function mockTextChannel(
  overrides: Record<string, unknown> = {},
): TextChannel {
  const defaults: Record<string, unknown> = {
    id: testChannelId("1"),
    name: "general",
    type: ChannelType.GuildText,
    guild: mockGuild(),
    guildId: testGuildId("1"),
    parent: null,
    parentId: null,
    permissionOverwrites: {
      cache: new Map(),
    },
    topic: null,
    nsfw: false,
    rateLimitPerUser: 0,
    lastMessageId: null,
    lastPinTimestamp: null,
    isDMBased: () => false,
    isTextBased: () => true,
    isThread: () => false,
    isVoiceBased: () => false,
    createdTimestamp: Date.now(),
    position: 0,
    permissionsLocked: false,
    archived: false,
    autoArchiveDuration: 60,
    locked: false,
    invitable: true,
    memberCount: 0,
    messageCount: 0,
    viewable: true,
    manageable: true,
    fetchWebhooks: () => Promise.resolve(new Map()),
    permissionsFor: (_target: unknown) => ({
      has: (permission: bigint) =>
        permission === PermissionFlagsBits.ViewChannel ||
        permission === PermissionFlagsBits.SendMessages,
    }),
    send: (_content: unknown) =>
      Promise.resolve({
        id: "message-id",
        content: typeof _content === "string" ? _content : "",
        author: mockUser({ bot: true }),
      }),
    client: mockClient(),
  };

  return castMock<TextChannel>({ ...defaults, ...overrides });
}

/**
 * Create a mock Discord DMChannel object
 * @lintignore
 */
export function mockDMChannel(
  overrides: Record<string, unknown> = {},
): DMChannel {
  const defaults: Record<string, unknown> = {
    id: testChannelId("2"),
    type: ChannelType.DM,
    isDMBased: () => true,
    isTextBased: () => true,
    isThread: () => false,
    isVoiceBased: () => false,
    recipient: mockUser(),
    createdAt: new Date(),
    createdTimestamp: Date.now(),
    send: (_content: unknown) =>
      Promise.resolve({
        id: "message-id",
        content: typeof _content === "string" ? _content : "",
        author: mockUser({ bot: true }),
      }),
    client: mockClient(),
  };

  return castMock<DMChannel>({ ...defaults, ...overrides });
}

/**
 * Create a mock Discord Message object
 * @lintignore
 */
export function mockMessage(overrides: Record<string, unknown> = {}): Message {
  const defaults: Record<string, unknown> = {
    id: "message-id",
    content: "Test message",
    author: mockUser(),
    channel: mockTextChannel(),
    guild: mockGuild(),
    guildId: testGuildId("1"),
    member: mockGuildMember(),
    createdTimestamp: Date.now(),
    editedTimestamp: null,
    mentions: {
      has: () => false,
      cache: new Map(),
    },
    roleMentions: [],
    pinned: false,
    type: 0,
    system: false,
    embeds: [],
    components: [],
    attachments: new Map(),
    reactions: {
      cache: new Map(),
    },
    deletable: true,
    editable: true,
    flags: null,
    reply: (_options: unknown) => Promise.resolve(mockMessage()),
    delete: () => Promise.resolve(),
    edit: (_options: unknown) => Promise.resolve(mockMessage()),
    react: (_emoji: string) => Promise.resolve(),
    client: mockClient(),
  };

  return castMock<Message>({ ...defaults, ...overrides });
}

/**
 * Create a mock Discord Client object
 */
export function mockClient(overrides: Record<string, unknown> = {}): Client {
  const defaults: Record<string, unknown> = {
    token: "test-token",
    user: mockUser({ bot: true, username: "TestBot" }),
    guilds: {
      cache: new Map(),
      fetch: () => Promise.resolve(mockGuild()),
    },
    channels: {
      cache: new Map(),
      fetch: () => Promise.resolve(mockTextChannel()),
    },
    users: {
      cache: new Map(),
      fetch: () => Promise.resolve(mockUser()),
    },
    application: {
      id: testAccountId("100"),
    },
    isReady: () => true,
    rest: {
      get: () => Promise.resolve({}),
      post: () => Promise.resolve({}),
      patch: () => Promise.resolve({}),
      put: () => Promise.resolve({}),
      delete: () => Promise.resolve({}),
    },
  };

  return castMock<Client>({ ...defaults, ...overrides });
}

/**
 * Create a mock PermissionsBitField object
 * @lintignore
 */
export function mockPermissions(
  permissions: bigint = PermissionFlagsBits.ViewChannel,
): PermissionsBitField {
  return castMock<PermissionsBitField>({
    bitfield: permissions,
    has: (permission: bigint | bigint[]) => {
      const perms = Array.isArray(permission) ? permission : [permission];
      return perms.every((p) => (permissions & p) === p);
    },
    add: () => mockPermissions(),
    remove: () => mockPermissions(),
    serialize: () => ({}),
    toArray: () => [],
    freeze: () => mockPermissions(),
  });
}
