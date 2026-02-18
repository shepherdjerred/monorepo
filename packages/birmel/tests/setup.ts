import { beforeAll, afterAll, mock } from "bun:test";

// Mock @mastra/libsql
void mock.module("@mastra/libsql", () => ({
  // eslint-disable-next-line @typescript-eslint/no-extraneous-class -- empty mock class for testing
  LibSQLStore: class MockLibSQLStore {},
  // eslint-disable-next-line @typescript-eslint/no-extraneous-class -- empty mock class for testing
  LibSQLVector: class MockLibSQLVector {},
}));

// Mock @mastra/memory
void mock.module("@mastra/memory", () => ({
  // eslint-disable-next-line @typescript-eslint/no-extraneous-class -- empty mock class for testing
  Memory: class MockMemory {},
}));

// Mock @mastra/core/agent
void mock.module("@mastra/core/agent", () => ({
  Agent: class MockAgent {
    name: string;
    private readonly _instructions: string;

    constructor(config: {
      name: string;
      instructions: string;
      [key: string]: unknown;
    }) {
      this.name = config.name;
      this._instructions = config.instructions;
    }

    getInstructions(): string {
      return this._instructions;
    }
  },
}));

// Mock @mastra/core/tools
void mock.module("@mastra/core/tools", () => ({
  createTool: (config: {
    id: string;
    description: string;
    [key: string]: unknown;
  }) => ({
    ...config,
  }),
}));

// Mock @ai-sdk/openai
type ModelFn = (model: string) => { provider: string; model: string };
type OpenaiMock = ModelFn & { chat: ModelFn; responses: ModelFn };
const mockOpenai: OpenaiMock = Object.assign(
  (model: string) => ({ provider: "openai", model }),
  {
    chat: (model: string) => ({ provider: "openai.chat", model }),
    responses: (model: string) => ({ provider: "openai.responses", model }),
  },
);
void mock.module("@ai-sdk/openai", () => ({
  openai: mockOpenai,
}));

// Mock environment variables for testing
beforeAll(() => {
  Bun.env["DISCORD_TOKEN"] = "test-discord-token";
  Bun.env["DISCORD_CLIENT_ID"] = "test-client-id";
  Bun.env["ANTHROPIC_API_KEY"] = "test-anthropic-key";
  Bun.env["OPENAI_API_KEY"] = "test-openai-key";
});

afterAll(() => {
  // Cleanup
});

// Mock Discord.js to prevent actual API calls
void mock.module("discord.js", () => ({
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

// Mock discord-player
void mock.module("discord-player", () => ({
  Player: class MockPlayer {
    extractors = {
      register: () => Promise.resolve(),
    };
    events = {
      on() {
        /* noop */
      },
    };
    nodes = {
      create: () => ({
        play: () => Promise.resolve(),
        node: {
          pause() {
            /* noop */
          },
          resume() {
            /* noop */
          },
          skip() {
            /* noop */
          },
          stop() {
            /* noop */
          },
          setVolume() {
            /* noop */
          },
        },
        tracks: [],
        currentTrack: null,
      }),
    };
    queues = {
      get: () => null,
    };
    search = () => Promise.resolve({ hasTracks: () => false, tracks: [] });
  },
  Track: class MockTrack {
    title = "Mock Track";
    duration = "3:00";
    url = "https://example.com";
  },
  Playlist: class MockPlaylist {
    title = "Mock Playlist";
    tracks = [];
    url = "https://example.com/playlist";
  },
  Util: {
    buildTimeCode: (ms: number) =>
      `${String(Math.floor(ms / 60_000))}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0")}`,
    parseMS: (_str: string) => 0,
  },
  BaseExtractor: class MockBaseExtractor {
    static identifier = "mock-extractor";
    player = {};
  },
  ExtractorExecutionContext: class MockExtractorExecutionContext {
    player = {};
  },
  QueueRepeatMode: {
    OFF: 0,
    TRACK: 1,
    QUEUE: 2,
    AUTOPLAY: 3,
  },
  QueryType: {
    Auto: 0,
    YoutubeVideo: 1,
    YoutubeSearch: 2,
    YoutubePlaylist: 3,
    SoundcloudTrack: 4,
    SoundcloudPlaylist: 5,
    SpotifyTrack: 6,
    SpotifyPlaylist: 7,
    SpotifyAlbum: 8,
    AppleMusicTrack: 9,
    AppleMusicPlaylist: 10,
    AppleMusicAlbum: 11,
    Arbitrary: 12,
  },
}));

// Mock discord-player-youtubei
void mock.module("discord-player-youtubei", () => ({
  YoutubeiExtractor: class MockYoutubeiExtractor {
    static identifier = "youtubei-extractor";
    context = {};
  },
}));


