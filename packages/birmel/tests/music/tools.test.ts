import { beforeEach, describe, expect, mock, test } from "bun:test";
import { z } from "zod";
import { runWithRequestContext } from "@shepherdjerred/birmel/agent-tools/tools/request-context.ts";
import {
  clearAllPlaylistsForTests,
  getPlaylist,
} from "@shepherdjerred/birmel/music/playlists.ts";
import { isQueueNotificationSuppressed } from "@shepherdjerred/birmel/music/notification-suppression.ts";

type MockTrack = {
  title: string;
  url: string;
  duration: string;
  thumbnail?: string;
  requestedBy?: { username: string };
  source?: string;
};

type MockQueue = {
  currentTrack: MockTrack | null;
  addTrack: (track: MockTrack) => void;
  tracks: {
    size: number;
    toArray: () => MockTrack[];
    clear: () => void;
    shuffle: () => void;
  };
};

type PlayCall = {
  voiceChannelId: string;
  textChannelId: string | undefined;
};

const sentEmbeds: unknown[] = [];
const playCalls: PlayCall[] = [];
const queues = new Map<string, MockQueue>();
const searchTracks = new Map<string, MockTrack>();

function makeTrack(title: string, videoId: string): MockTrack {
  return {
    title,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    duration: "3:00",
    requestedBy: { username: "Requester" },
    source: "youtube",
  };
}

function makeQueue(input: {
  currentTrack?: MockTrack | undefined;
  tracks: MockTrack[];
}): MockQueue {
  const tracks = [...input.tracks];
  const queue: MockQueue = {
    currentTrack: input.currentTrack ?? null,
    addTrack: (track: MockTrack) => {
      tracks.push(track);
      if (!isQueueNotificationSuppressed(queue)) {
        sentEmbeds.push({ title: "Added to Queue", track });
      }
    },
    tracks: {
      get size() {
        return tracks.length;
      },
      toArray: () => [...tracks],
      clear: () => {
        tracks.length = 0;
      },
      shuffle: () => {
        tracks.reverse();
      },
    },
  };
  return queue;
}

const channels = new Map<string, unknown>();

void mock.module("@shepherdjerred/birmel/discord/client.ts", () => ({
  getDiscordClient: () => ({
    user: { id: "bot-user" },
    channels: {
      fetch: (id: string) => Promise.resolve(channels.get(id) ?? null),
    },
  }),
}));

void mock.module("@shepherdjerred/birmel/music/player.ts", () => ({
  getMusicPlayer: () => ({
    queues: {
      get: (guildId: string) => queues.get(guildId) ?? null,
    },
    search: (query: string) => {
      const track = searchTracks.get(query);
      return Promise.resolve({
        hasTracks: () => track != null,
        tracks: track == null ? [] : [track],
      });
    },
    play: (
      voiceChannel: { id: string },
      searchResult: { tracks: MockTrack[] },
      options: { nodeOptions?: { metadata?: { id: string } } },
    ) => {
      playCalls.push({
        voiceChannelId: voiceChannel.id,
        textChannelId: options.nodeOptions?.metadata?.id,
      });
      const track = searchResult.tracks[0];
      if (track == null) {
        throw new Error("mock search result did not include a track");
      }
      return Promise.resolve({ track });
    },
  }),
}));

void mock.module("@shepherdjerred/birmel/music/responses.ts", () => ({
  sendMusicEmbed: (embed: unknown) => {
    sentEmbeds.push(embed);
    return Promise.resolve();
  },
}));

const { musicPlaybackTool } =
  await import("@shepherdjerred/birmel/agent-tools/tools/music/playback.ts");
const { musicQueueTool } =
  await import("@shepherdjerred/birmel/agent-tools/tools/music/queue.ts");
const { musicPlaylistTool } =
  await import("@shepherdjerred/birmel/agent-tools/tools/music/playlists.ts");

const TrackDataSchema = z.object({
  title: z.string(),
  url: z.string(),
  duration: z.string(),
  coverUrl: z.string().optional(),
});

const BasicToolResultSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

const QueueToolResultSchema = BasicToolResultSchema.extend({
  data: z
    .object({
      currentTrack: TrackDataSchema.nullable(),
      tracks: z.array(TrackDataSchema),
      totalTracks: z.number(),
      totalDuration: z.string().optional(),
    })
    .optional(),
});

const PlaylistToolResultSchema = BasicToolResultSchema.extend({
  data: z
    .object({
      playlistName: z.string(),
      trackCount: z.number(),
      tracks: z.array(TrackDataSchema),
    })
    .optional(),
});

function withMusicContext<T>(
  context: { guildId?: string; voiceChannelId?: string | undefined },
  fn: () => T | Promise<T>,
): T | Promise<T> {
  return runWithRequestContext(
    {
      sourceChannelId: "text-1",
      sourceMessageId: "message-1",
      guildId: context.guildId ?? "guild-1",
      userId: "user-1",
      ...(context.voiceChannelId != null && {
        voiceChannelId: context.voiceChannelId,
      }),
    },
    fn,
  );
}

async function executePlayback(
  input: Parameters<NonNullable<typeof musicPlaybackTool.execute>>[0],
): Promise<unknown> {
  const execute = musicPlaybackTool.execute;
  if (execute == null) {
    throw new Error("music playback tool has no execute function");
  }
  return await execute(input);
}

async function executeQueue(
  input: Parameters<NonNullable<typeof musicQueueTool.execute>>[0],
): Promise<unknown> {
  const execute = musicQueueTool.execute;
  if (execute == null) {
    throw new Error("music queue tool has no execute function");
  }
  return await execute(input);
}

async function executePlaylist(
  input: Parameters<NonNullable<typeof musicPlaylistTool.execute>>[0],
): Promise<unknown> {
  const execute = musicPlaylistTool.execute;
  if (execute == null) {
    throw new Error("music playlist tool has no execute function");
  }
  return await execute(input);
}

beforeEach(() => {
  sentEmbeds.length = 0;
  playCalls.length = 0;
  queues.clear();
  searchTracks.clear();
  clearAllPlaylistsForTests();
  channels.clear();
  channels.set("text-1", { id: "text-1" });
  channels.set("voice-1", {
    id: "voice-1",
    type: 2,
    isVoiceBased: () => true,
  });
});

describe("music AI tools", () => {
  test("play defaults to the requester's voice channel", async () => {
    searchTracks.set("lofi", makeTrack("Lofi", "lofi123"));

    const result = BasicToolResultSchema.parse(
      await withMusicContext({ voiceChannelId: "voice-1" }, () =>
        executePlayback({
          guildId: "guild-1",
          action: "play",
          query: "lofi",
        }),
      ),
    );

    expect(result.success).toBe(true);
    expect(playCalls).toEqual([
      { voiceChannelId: "voice-1", textChannelId: "text-1" },
    ]);
    expect(sentEmbeds).toHaveLength(0);
  });

  test("play returns an explicit error when no voice channel is available", async () => {
    const result = BasicToolResultSchema.parse(
      await withMusicContext({}, () =>
        executePlayback({
          guildId: "guild-1",
          action: "play",
          query: "lofi",
        }),
      ),
    );

    expect(result).toEqual({
      success: false,
      message: "Join a voice channel first, then ask me to play something.",
    });
    expect(playCalls).toEqual([]);
  });

  test("queue summary returns rich track data", async () => {
    queues.set(
      "guild-1",
      makeQueue({
        currentTrack: makeTrack("Current", "current123"),
        tracks: [makeTrack("Next", "next123"), makeTrack("Later", "later123")],
      }),
    );

    const result = QueueToolResultSchema.parse(
      await executeQueue({ guildId: "guild-1", action: "summary" }),
    );

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      currentTrack: {
        title: "Current",
        url: "https://www.youtube.com/watch?v=current123",
        duration: "3:00",
        coverUrl: "https://img.youtube.com/vi/current123/hqdefault.jpg",
      },
      tracks: [
        {
          title: "Next",
          url: "https://www.youtube.com/watch?v=next123",
          duration: "3:00",
          coverUrl: "https://img.youtube.com/vi/next123/hqdefault.jpg",
        },
        {
          title: "Later",
          url: "https://www.youtube.com/watch?v=later123",
          duration: "3:00",
          coverUrl: "https://img.youtube.com/vi/later123/hqdefault.jpg",
        },
      ],
      totalTracks: 2,
      totalDuration: "6:00",
    });
    expect(sentEmbeds).toHaveLength(1);
  });

  test("queue get returns an explicit no-active-queue error", async () => {
    const result = BasicToolResultSchema.parse(
      await executeQueue({ guildId: "guild-1", action: "get" }),
    );

    expect(result).toEqual({ success: false, message: "No active queue" });
  });

  test("playlist actions mutate only the target guild", async () => {
    searchTracks.set("guild-one-song", makeTrack("Guild One", "guildone123"));

    await executePlaylist({
      guildId: "guild-1",
      action: "create",
      playlistName: "mix",
    });
    await executePlaylist({
      guildId: "guild-2",
      action: "create",
      playlistName: "mix",
    });

    const addResult = PlaylistToolResultSchema.parse(
      await executePlaylist({
        guildId: "guild-1",
        action: "add",
        playlistName: "mix",
        query: "guild-one-song",
      }),
    );

    expect(addResult.success).toBe(true);

    const guildOnePlaylist = getPlaylist("guild-1", "mix");
    const guildTwoPlaylist = getPlaylist("guild-2", "mix");
    if (!guildOnePlaylist.ok) {
      throw new Error(guildOnePlaylist.message);
    }
    if (!guildTwoPlaylist.ok) {
      throw new Error(guildTwoPlaylist.message);
    }

    expect(guildOnePlaylist.value.tracks.map((track) => track.title)).toEqual([
      "Guild One",
    ]);
    expect(guildTwoPlaylist.value.tracks).toEqual([]);
  });

  test("playlist play suppresses per-track queue add embeds", async () => {
    searchTracks.set("first-song", makeTrack("First", "first123"));
    searchTracks.set(
      "https://www.youtube.com/watch?v=first123",
      makeTrack("First", "first123"),
    );
    searchTracks.set(
      "https://www.youtube.com/watch?v=second123",
      makeTrack("Second", "second123"),
    );
    searchTracks.set(
      "https://www.youtube.com/watch?v=third123",
      makeTrack("Third", "third123"),
    );

    queues.set(
      "guild-1",
      makeQueue({
        currentTrack: makeTrack("First", "first123"),
        tracks: [],
      }),
    );

    await executePlaylist({
      guildId: "guild-1",
      action: "create",
      playlistName: "mix",
    });
    await executePlaylist({
      guildId: "guild-1",
      action: "add",
      playlistName: "mix",
      query: "first-song",
    });
    await executePlaylist({
      guildId: "guild-1",
      action: "add",
      playlistName: "mix",
      query: "https://www.youtube.com/watch?v=second123",
    });
    await executePlaylist({
      guildId: "guild-1",
      action: "add",
      playlistName: "mix",
      query: "https://www.youtube.com/watch?v=third123",
    });
    sentEmbeds.length = 0;

    const result = BasicToolResultSchema.parse(
      await withMusicContext({ voiceChannelId: "voice-1" }, () =>
        executePlaylist({
          guildId: "guild-1",
          action: "play",
          playlistName: "mix",
        }),
      ),
    );

    expect(result.success).toBe(true);
    expect(playCalls).toEqual([
      { voiceChannelId: "voice-1", textChannelId: "text-1" },
    ]);
    expect(sentEmbeds).toHaveLength(1);
    expect(
      queues
        .get("guild-1")
        ?.tracks.toArray()
        .map((track) => track.title),
    ).toEqual(["Second", "Third"]);
  });
});
