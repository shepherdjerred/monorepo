import { describe, expect, it, vi } from "vitest";
import {
  ChatInputCommandInteraction,
  MessageComponentInteraction,
} from "discord.js";
import {
  playSportsSelection,
  runSportsCommand,
} from "@shepherdjerred/streambot/discord/commands/sports-command.ts";
import { EMPTY_HANDLE } from "@shepherdjerred/streambot/session/session-types.ts";
import type { SportsEvent } from "@shepherdjerred/streambot/sports/types.ts";
import type { ResolvedSource } from "@shepherdjerred/streambot/machine/types.ts";
import { loadConfig } from "@shepherdjerred/streambot/config/index.ts";

const USER = "100000000000000001";
const GUILD = "100000000000000002";
const TEXT = "100000000000000003";
const VOICE = "100000000000000004";
const LIVE: SportsEvent = {
  id: "streameast:game",
  provider: "streameast",
  title: "Bears vs Packers",
  status: "live",
  startsAt: null,
  pageUrl: "https://v2.streameast.ga/game/",
};
const RESOLVED: ResolvedSource = {
  title: LIVE.title,
  ffmpegInput: "https://example.com/live.m3u8",
  mediaKind: "video",
  chapters: [],
};

function harness(voice: string | null = VOICE) {
  const dispatch = vi.fn();
  const ensureForPlay = vi.fn(() => ({ ...EMPTY_HANDLE, dispatch }));
  const releaseUnused = vi.fn();
  const resolvePlaySource = vi.fn(async () => RESOLVED);
  const listToday = vi.fn(async () => [LIVE]);
  const sportsStreaming = vi.fn(async () => true);
  const deps = {
    config: loadConfig({
      BOT_TOKEN: "bot-token",
      TOKEN: "user-token",
      VIDEOS_DIR: "/tmp/videos",
    }),
    library: () => [],
    resolvePlaySource,
    getSessions: () => ({ ensureForPlay, releaseUnused }),
    sports: {
      listToday,
      search: vi.fn(async () => ({ kind: "found" as const, events: [LIVE] })),
    },
    featureGate: {
      assistantV2: async () => true,
      history: async () => true,
      musicOverVoice: async () => true,
      sportsStreaming,
    },
  };
  const interaction: MessageComponentInteraction = Object.assign(
    Object.create(MessageComponentInteraction.prototype),
    {
      user: { id: USER },
      guildId: GUILD,
      channelId: TEXT,
      client: {
        guilds: {
          cache: new Map([
            [
              GUILD,
              {
                voiceStates: { cache: new Map([[USER, { channelId: voice }]]) },
              },
            ],
          ]),
        },
        channels: { cache: new Map() },
      },
    },
  );
  return {
    deps,
    interaction,
    dispatch,
    ensureForPlay,
    releaseUnused,
    resolvePlaySource,
    listToday,
    sportsStreaming,
  };
}

describe("sports picker playback", () => {
  it("uses the selecting user's current voice channel and the stored provider page", async () => {
    const h = harness();
    const message = await playSportsSelection(h.interaction, LIVE, h.deps);
    expect(message).toContain(LIVE.title);
    expect(h.ensureForPlay).toHaveBeenCalledExactlyOnceWith({
      guildId: GUILD,
      voiceChannelId: VOICE,
      statusChannelId: TEXT,
    });
    expect(h.resolvePlaySource).toHaveBeenCalledWith(
      { kind: "url", url: LIVE.pageUrl, mode: "video" },
      expect.any(AbortSignal),
    );
    expect(h.dispatch).toHaveBeenCalledExactlyOnceWith({
      type: "ADD",
      source: { kind: "url", url: LIVE.pageUrl, mode: "video" },
      requesterId: USER,
    });
    expect(h.sportsStreaming).toHaveBeenCalledWith({
      guildId: GUILD,
      channelId: VOICE,
      userId: USER,
    });
    expect(h.releaseUnused).toHaveBeenCalledExactlyOnceWith(GUILD, VOICE);
    expect(h.listToday).not.toHaveBeenCalled();
  });

  it("does not allocate a bot when the user left voice while browsing", async () => {
    const h = harness(null);
    await expect(
      playSportsSelection(h.interaction, LIVE, h.deps),
    ).rejects.toThrow("Join a voice channel");
    expect(h.ensureForPlay).not.toHaveBeenCalled();
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it("rechecks the sports feature gate before resolving or queueing", async () => {
    const h = harness();
    h.sportsStreaming.mockResolvedValue(false);
    await expect(
      playSportsSelection(h.interaction, LIVE, h.deps),
    ).rejects.toThrow("Sports streams are not enabled here");
    expect(h.resolvePlaySource).not.toHaveBeenCalled();
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(h.releaseUnused).toHaveBeenCalledExactlyOnceWith(GUILD, VOICE);
  });

  it("releases an unused session when the provider cannot resolve the game", async () => {
    const h = harness();
    h.resolvePlaySource.mockRejectedValue(new Error("stream unavailable"));
    await expect(
      playSportsSelection(h.interaction, LIVE, h.deps),
    ).rejects.toThrow("I couldn't start the streameast stream right now");
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(h.releaseUnused).toHaveBeenCalledExactlyOnceWith(GUILD, VOICE);
  });

  it("rejects a future game before allocating a session", async () => {
    const h = harness();
    await expect(
      playSportsSelection(
        h.interaction,
        { ...LIVE, status: "scheduled" },
        h.deps,
      ),
    ).rejects.toThrow("not live yet");
    expect(h.ensureForPlay).not.toHaveBeenCalled();
  });

  it("only lists games while browsing, without reserving a playback bot", async () => {
    const h = harness();
    h.listToday.mockResolvedValue([]);
    const editReply = vi.fn();
    const slash: ChatInputCommandInteraction = Object.assign(
      Object.create(ChatInputCommandInteraction.prototype),
      h.interaction,
      { deferReply: vi.fn(), editReply },
    );
    await runSportsCommand(slash, h.deps);
    expect(h.listToday).toHaveBeenCalledOnce();
    expect(h.ensureForPlay).not.toHaveBeenCalled();
    expect(h.resolvePlaySource).not.toHaveBeenCalled();
    expect(editReply.mock.calls[0]![0].embeds[0].toJSON().title).toBe(
      "Sports today",
    );
  });
});
