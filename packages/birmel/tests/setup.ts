import { beforeAll, afterAll, vi } from "vitest";

// Mock environment variables for testing
beforeAll(() => {
  Bun.env["DISCORD_TOKEN"] = "test-discord-token";
  Bun.env["DISCORD_CLIENT_ID"] = "123456789012345678";
  Bun.env["OPENROUTER_API_KEY"] = "test-openrouter-key";
});

afterAll(() => {
  // Cleanup
});

// Mock Discord.js to prevent actual API calls
vi.mock("discord.js", () => ({
  Client: class MockClient {
    guilds = { cache: new Map(), fetch: () => Promise.resolve({}) };
    channels = { fetch: () => Promise.resolve({}) };
    users = { fetch: () => Promise.resolve({}) };
    login = () => Promise.resolve("logged-in");
    destroy() {
      /* noop */
    }
    on() {
      /* noop */
    }
    once() {
      /* noop */
    }
  },
  // Mirrors the real builder's defaults: an omitted name or description reads
  // back as null, which is what the delivery tests assert against.
  AttachmentBuilder: class MockAttachmentBuilder {
    attachment: unknown;
    name: string | null;
    description: string | null;
    constructor(
      attachment: unknown,
      data: { name?: string; description?: string } = {},
    ) {
      this.attachment = attachment;
      this.name = data.name ?? null;
      this.description = data.description ?? null;
    }
  },
  GatewayIntentBits: {
    Guilds: 1,
    GuildMessages: 2,
    MessageContent: 4,
    GuildMembers: 8,
    GuildModeration: 16,
    GuildVoiceStates: 32,
    GuildPresences: 64,
    GuildMessageReactions: 128,
    GuildScheduledEvents: 256,
    GuildIntegrations: 512,
    GuildWebhooks: 1024,
    GuildInvites: 2048,
    DirectMessages: 4096,
  },
  Partials: {
    Message: 0,
    Channel: 1,
    Reaction: 2,
    User: 3,
    GuildMember: 4,
  },
  PermissionFlagsBits: {
    ViewChannel: 1n << 10n,
    SendMessages: 1n << 11n,
    ManageMessages: 1n << 13n,
    EmbedLinks: 1n << 14n,
    AttachFiles: 1n << 15n,
    ReadMessageHistory: 1n << 16n,
    MentionEveryone: 1n << 17n,
    UseExternalEmojis: 1n << 18n,
    Connect: 1n << 20n,
    Speak: 1n << 21n,
    MuteMembers: 1n << 22n,
    DeafenMembers: 1n << 23n,
    MoveMembers: 1n << 24n,
    ManageChannels: 1n << 4n,
    ManageRoles: 1n << 28n,
    Administrator: 1n << 3n,
    KickMembers: 1n << 1n,
    BanMembers: 1n << 2n,
    ModerateMembers: 1n << 40n,
    ManageGuild: 1n << 5n,
  },
  AutoModerationRuleTriggerType: {
    Keyword: 1,
    Spam: 3,
    KeywordPreset: 4,
    MentionSpam: 5,
    1: "Keyword",
    3: "Spam",
    4: "KeywordPreset",
    5: "MentionSpam",
  },
  AutoModerationActionType: {
    BlockMessage: 1,
    SendAlertMessage: 2,
    Timeout: 3,
  },
  ChannelType: {
    GuildText: 0,
    GuildVoice: 2,
    GuildCategory: 4,
  },
  GuildScheduledEventEntityType: {
    None: 0,
    StageInstance: 1,
    Voice: 2,
    External: 3,
  },
  GuildScheduledEventPrivacyLevel: {
    GuildOnly: 2,
  },
  GuildScheduledEventStatus: {
    Scheduled: 1,
    Active: 2,
    Completed: 3,
    Canceled: 4,
  },
}));
