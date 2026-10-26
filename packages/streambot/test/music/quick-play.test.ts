import { afterEach, expect, test, vi } from "vitest";
import { ApplicationFlags, Client, GatewayIntentBits } from "discord.js";
import {
  quickPlay,
  prefixPlayQuery,
} from "@shepherdjerred/streambot/discord/quick-play.ts";
import { messageContentAllowed } from "@shepherdjerred/streambot/discord/command-intents.ts";
import type { MusicLinkReply } from "@shepherdjerred/streambot/discord/music-link-reply.ts";
import type { MusicInteraction } from "@shepherdjerred/streambot/discord/music-context.ts";
import type { CommandBotDeps } from "@shepherdjerred/streambot/discord/commands/command-bot-deps.ts";
import { commandJson } from "@shepherdjerred/streambot/discord/commands/commands.ts";
import { loadConfig } from "@shepherdjerred/streambot/config/index.ts";
import {
  harness,
  guildId,
  userId,
  voiceChannelId,
  otherChannel,
  statusChannelId,
  number,
} from "#numbered-fixture";
import { fixtureMusic } from "#music-fixture";
import { SONG } from "#music-fixture";
import { musicCommandContext } from "@shepherdjerred/streambot/discord/music-context.ts";
import { queueBatch } from "@shepherdjerred/streambot/commands/queue-batch.ts";
import type { Source } from "@shepherdjerred/streambot/sources/source.ts";

const services: ReturnType<typeof fixtureMusic>[] = [];
const pendingPlaylistLoad = Promise.withResolvers<{
  count: number;
  complete: null;
  message: string;
}>().promise;
afterEach(() => {
  for (const music of services.splice(0)) music.loads.close();
});
async function setup(
  resolvePlaySource: CommandBotDeps["resolvePlaySource"] = () =>
    Promise.resolve({
      title: "Chosen song",
      mediaKind: "music",
      ffmpegInput: "fixture",
      chapters: [],
    }),
) {
  const featureGate = {
    numberedChannels: () => Promise.resolve(true),
    automaticChannelRouting: () => Promise.resolve(true),
    assistantV2: () => Promise.resolve(false),
    history: () => Promise.resolve(false),
    musicOverVoice: () => Promise.resolve(true),
    spotifyLinks: () => Promise.resolve(true),
  };
  const h = await harness(2, {
    featureGate,
    library: () => [],
    resolvePlaySource,
  });
  const music = fixtureMusic();
  services.push(music);
  const voice: { channelId: string | null } = { channelId: voiceChannelId };
  const issuer: MusicInteraction = {
    guildId,
    channelId: statusChannelId,
    user: { id: userId },
    guild: {
      voiceStates: { cache: new Map<string, typeof voice>([[userId, voice]]) },
    },
  };
  const reply = {
    start: vi.fn(() => Promise.resolve()),
    edit: vi.fn(() => Promise.resolve()),
    onCancel: vi.fn(() => Promise.resolve()),
  } satisfies MusicLinkReply;
  const deps: CommandBotDeps = {
    config: loadConfig({
      BOT_TOKEN: "bot",
      USER_TOKENS: "user",
      VIDEOS_DIR: "/videos",
    }),
    getSessions: () => h.manager,
    library: () => [],
    listSources: () => Promise.resolve([]),
    resolvePlaySource,
    expandPlaylist: () =>
      Promise.resolve(
        Array.from({ length: 250 }, (_, i) => ({
          title: "Song " + String(i),
          url: "https://www.youtube.com/watch?v=h5EofwRzit0",
        })),
      ),
    music,
    featureGate,
  };
  return { ...h, music, deps, issuer, reply, voice };
}

test("/play registers one required query without subcommands", () => {
  const play = commandJson.find((command) => command.name === "play");
  expect(play?.options).toEqual([
    {
      type: 3,
      name: "query",
      description: "Song, artist, title, or link",
      required: true,
    },
  ]);
});
test.each([
  ["!play Daft Punk Get Lucky", "Daft Punk Get Lucky"],
  ["!PLAY\n Get Lucky ", "Get Lucky"],
  ["!play", ""],
  ["!playlist song", null],
  ["hello !play song", null],
  [" !play song", null],
])("prefix parser handles %s", (input, expected) => {
  expect(prefixPlayQuery(input)).toBe(expected);
});

test("missing intent leaves slash commands usable; granted intents can be added before login", async () => {
  expect(messageContentAllowed({ flags: 0 })).toBe(false);
  expect(
    messageContentAllowed({ flags: ApplicationFlags.GatewayMessageContent }),
  ).toBe(true);
  expect(
    messageContentAllowed({
      flags: ApplicationFlags.GatewayMessageContentLimited,
    }),
  ).toBe(true);
  expect(
    messageContentAllowed({
      flags: 0,
      flags_new: String(ApplicationFlags.GatewayMessageContentLimited),
    }),
  ).toBe(true);
  expect(() => messageContentAllowed({})).toThrow();
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  client.options.intents = client.options.intents.add(
    GatewayIntentBits.MessageContent,
  );
  expect(client.options.intents.has(GatewayIntentBits.MessageContent)).toBe(
    true,
  );
  await client.destroy();
});

test("quick search uses the real guarded session routing and creates an audio slot", async () => {
  const f = await setup();
  await quickPlay(f.issuer, f.deps, "Get Lucky by Daft Punk", f.reply);
  await vi.waitFor(() =>
    expect(
      f.manager.getExisting(guildId, voiceChannelId, number(1))?.view().current
        ?.source,
    ).toBeDefined(),
  );
  expect(f.reply.edit).toHaveBeenCalledWith(
    expect.objectContaining({ content: expect.stringContaining("Queued") }),
  );
  expect(f.entries.filter((entry) => entry.busy)).toHaveLength(1);
});

test("a pasted Spotify link queues catalog metadata through the shared cancellable loader", async () => {
  const f = await setup();
  await quickPlay(
    f.issuer,
    f.deps,
    "<https://open.spotify.com/track/5nTtCOCds6I0PHMNtqelas>",
    f.reply,
  );
  await vi.waitFor(() =>
    expect(f.reply.edit).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("Queued") }),
    ),
  );
  await vi.waitFor(() =>
    expect(
      f.manager.getExisting(guildId, voiceChannelId, number(1))?.view().current
        ?.source?.music?.title,
    ).toBe("Get Lucky"),
  );
  const current = f.manager
    .getExisting(guildId, voiceChannelId, number(1))
    ?.view().current;
  expect(current?.source?.music?.title).toBe("Get Lucky");
  expect(current?.source?.music?.artworkId).toBeDefined();
  expect(f.reply.onCancel).toHaveBeenCalledOnce();
});

test("a rejected playlist load replaces its loading reply with the error", async () => {
  const f = await setup();
  const context = {
    userId,
    guildId,
    channelId: statusChannelId,
    slot: number(2),
  };
  f.music.loads.start(context, () => pendingPlaylistLoad);
  f.music.loads.start(context, () => pendingPlaylistLoad);

  await quickPlay(
    f.issuer,
    f.deps,
    "https://www.youtube.com/playlist?list=PLfixture",
    f.reply,
  );

  expect(f.reply.start).toHaveBeenCalledWith(
    expect.objectContaining({
      content: expect.stringContaining("Loading playlist"),
    }),
  );
  expect(f.reply.edit).toHaveBeenCalledWith(
    expect.objectContaining({
      content: "A playlist is already loading. Finish or cancel it first.",
      components: [],
    }),
  );
});

test("saved catalog tracks route to the audio slot when their request mode was stripped", async () => {
  const f = await setup();
  const context = await musicCommandContext(f.issuer, f.deps);
  const routed: Source[] = [];
  const events: Parameters<typeof context.dispatch>[0][] = [];
  const target = {
    ...context,
    playbackChannel: number(1),
    dispatch: (event: Parameters<typeof context.dispatch>[0]) => {
      events.push(event);
    },
  };
  const deps = {
    ...context,
    routePlayback: async (source: Source) => {
      routed.push(source);
      return target;
    },
  };

  await queueBatch({
    deps,
    sources: [
      {
        kind: "search",
        query: "Daft Punk Get Lucky",
        music: SONG,
      },
    ],
    userId,
    placement: "queue",
    signal: new AbortController().signal,
  });

  expect(routed[0]?.mode).toBe("music");
  expect(events[0]).toMatchObject({
    type: "ADD_BATCH",
    items: [{ source: { music: SONG, mode: undefined } }],
  });
});

test("quick YouTube playlist loading retains all 250 tracks and the video destination", async () => {
  const f = await setup();
  await quickPlay(
    f.issuer,
    f.deps,
    "https://www.youtube.com/playlist?list=PLfixture",
    f.reply,
  );
  await vi.waitFor(() =>
    expect(f.reply.edit).toHaveBeenCalledWith(
      expect.objectContaining({ content: "Queued 250 track(s)." }),
    ),
  );
  const view = f.manager
    .getExisting(guildId, voiceChannelId, number(2))
    ?.view();
  expect((view?.queue.length ?? 0) + Number(view?.current != null)).toBe(250);
});

test("quick play refuses empty requests and missing voice membership without allocating", async () => {
  const f = await setup();
  await quickPlay(f.issuer, f.deps, " ", f.reply);
  expect(f.reply.start).toHaveBeenCalledWith(
    expect.objectContaining({ content: expect.stringContaining("Try") }),
  );
  f.reply.start.mockClear();
  f.voice.channelId = null;
  await expect(
    quickPlay(f.issuer, f.deps, "Get Lucky", f.reply),
  ).rejects.toThrow("Join a voice channel");
  expect(f.reply.start).not.toHaveBeenCalled();
  expect(f.entries.every((entry) => !entry.busy)).toBe(true);
});

test("moving voice channels during resolution prevents a late quick-play dispatch", async () => {
  const pending =
    Promise.withResolvers<
      Awaited<ReturnType<CommandBotDeps["resolvePlaySource"]>>
    >();
  const resolve = vi.fn(() => pending.promise);
  const f = await setup(resolve);
  const request = quickPlay(
    f.issuer,
    { ...f.deps, resolvePlaySource: resolve },
    "Get Lucky",
    f.reply,
  );
  await vi.waitFor(() => expect(resolve).toHaveBeenCalledOnce());
  f.voice.channelId = otherChannel;
  pending.resolve({
    title: "Get Lucky",
    mediaKind: "music",
    ffmpegInput: "fixture",
    chapters: [],
  });
  await expect(request).rejects.toThrow("voice channel changed");
  expect(f.entries.every((entry) => !entry.busy)).toBe(true);
});
