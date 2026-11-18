import { waitFor } from "xstate";
import type {
  PlaybackEvent,
  ResolvedSource,
} from "@shepherdjerred/streambot/machine/types.ts";
import { sessionRevision } from "@shepherdjerred/streambot/session/session-revision.ts";
import { ChannelSelection } from "@shepherdjerred/streambot/session/channel-selection.ts";
import {
  PlaybackChannelNumberSchema,
  type PlaybackChannelNumber,
} from "@shepherdjerred/streambot/types/playback-channel.ts";
import {
  ChannelIdSchema,
  GuildIdSchema,
  UserIdSchema,
} from "@shepherdjerred/streambot/types/ids.ts";
import { loadConfig } from "@shepherdjerred/streambot/config/index.ts";
import { DiscoveryService } from "@shepherdjerred/streambot/discovery/discovery-service.ts";
import type { Source } from "@shepherdjerred/streambot/sources/source.ts";
import type { LibraryEntry } from "@shepherdjerred/streambot/sources/library.ts";
import type { LibraryArtworkProvider } from "@shepherdjerred/streambot/metadata/plex.ts";
import { sourceLabel } from "@shepherdjerred/streambot/sources/source.ts";
import { createFixtureSlot } from "./web-fixture-slot.ts";
import { WebCatalog } from "@shepherdjerred/streambot/web/server/catalog.ts";
import { WebPlayback } from "@shepherdjerred/streambot/web/server/playback.ts";
import { createWebHandler } from "@shepherdjerred/streambot/web/server/api.ts";
import { WebSessionStore } from "@shepherdjerred/streambot/web/server/session-store.ts";
import type { MediaFeatureGate } from "@shepherdjerred/streambot/config/media-features.ts";
import type { MediaHistoryStore } from "@shepherdjerred/streambot/history/media-history.ts";
import type { MusicService } from "@shepherdjerred/streambot/music/service.ts";
import type { SportsCatalog } from "@shepherdjerred/streambot/sports/types.ts";
import type { LolPlaybackSchedules } from "@shepherdjerred/streambot/sports/playback-schedules.ts";
import {
  fixturePoster,
  fixtureSports,
  FIXTURE_EVENTS,
} from "./web-fixture-media.ts";

export const GUILD = GuildIdSchema.parse("100000000000000010");
export const SECOND_GUILD = GuildIdSchema.parse("100000000000000011");
export const CHANNEL = ChannelIdSchema.parse("100000000000000020");
export const USER = UserIdSchema.parse("100000000000000001");
export const OTHER = UserIdSchema.parse("100000000000000002");
export const LIBRARY: LibraryEntry[] = [
  {
    path: "/media/movies/arrival.mkv",
    relativePath: "arrival.mkv",
    library: "movies",
    title: "Arrival",
    year: 2016,
  },
  {
    path: "/media/movies/spirited-away.mkv",
    relativePath: "spirited-away.mkv",
    library: "movies",
    title: "Spirited Away",
    year: 2001,
  },
  {
    path: "/media/movies/whiplash.mkv",
    relativePath: "whiplash.mkv",
    library: "movies",
    title: "Whiplash",
    year: 2014,
  },
  {
    path: "/media/tv/severance/1-1.mkv",
    relativePath: "severance/1-1.mkv",
    library: "tv",
    title: "Severance — Good News About Hell",
    series: "Severance",
    season: 1,
    episode: 1,
  },
  {
    path: "/media/tv/severance/1-2.mkv",
    relativePath: "severance/1-2.mkv",
    library: "tv",
    title: "Severance — Half Loop",
    series: "Severance",
    season: 1,
    episode: 2,
  },
  {
    path: "/media/tv/the-bear/1-1.mkv",
    relativePath: "the-bear/1-1.mkv",
    library: "tv",
    title: "The Bear — System",
    series: "The Bear",
    season: 1,
    episode: 1,
  },
];

function resolved(source: Source): ResolvedSource {
  const event =
    source.kind === "url"
      ? FIXTURE_EVENTS.find((candidate) => candidate.pageUrl === source.url)
      : undefined;
  return {
    title: event?.title ?? sourceLabel(source),
    ffmpegInput: "fixture-media",
    mediaKind: "video",
    ...(event === undefined ? { durationSeconds: 6960 } : {}),
    chapters: [],
  };
}

/** Real actor, command service, catalog and auth; only Discord/media I/O is simulated. */
export function webFixture(
  origin = "http://127.0.0.1:8080",
  assetsDir = "/nonexistent",
  extraGuild = false,
  options: {
    library?: LibraryEntry[];
    plexArtwork?: LibraryArtworkProvider;
    history?: MediaHistoryStore;
    music?: MusicService;
    musicEnabled?: boolean;
    radioEnabled?: boolean;
    tvEnabled?: boolean;
    join?: (input: {
      guildId: typeof GUILD;
      channelId: typeof CHANNEL;
    }) => Promise<{ guildId: typeof GUILD; channelId: typeof CHANNEL }>;
    expandPlaylist?: (
      url: string,
      signal: AbortSignal,
    ) => Promise<readonly { title: string; url: string }[]>;
    expandPlaylistWithMetadata?: (
      url: string,
      signal: AbortSignal,
    ) => Promise<{
      title: string | undefined;
      items: readonly { title: string; url: string }[];
    }>;
    automatic?: boolean;
    resolve?: (source: Source) => ResolvedSource;
    sports?: SportsCatalog;
    schedules?: LolPlaybackSchedules;
    lol?: boolean;
    username?: string;
  } = {},
) {
  const library = options.library ?? LIBRARY;
  const sports = options.sports ?? fixtureSports;
  const resolveFixture = options.resolve ?? resolved;
  const username = options.username ?? "jerred";
  const guilds = [
    { id: GUILD, name: "The living room" },
    ...(extraGuild ? [{ id: SECOND_GUILD, name: "The studio" }] : []),
  ];
  const store = new WebSessionStore(":memory:");
  const config = loadConfig({
    BOT_TOKEN: "fixture",
    USER_TOKENS: "fixture",
    VIDEOS_DIR: "/videos",
  });
  const events: PlaybackEvent[] = [];
  const announcements: string[] = [];
  let channel: { id: typeof CHANNEL; name: string } | null = {
    id: CHANNEL,
    name: "Movie night",
  };
  let member = true;
  let enabled = true;
  let advanced = true;
  let sportsEnabled = true;
  let radioEnabled = options.radioEnabled ?? true;
  let tvEnabled = options.tvEnabled ?? true;
  let plexEnabled = false;
  let allocated = false;
  let numbered = false;
  let allocatedChannel: PlaybackChannelNumber | undefined;
  const selection = new ChannelSelection();
  const selected = () =>
    numbered
      ? selection.get({ guildId: GUILD, channelId: CHANNEL, userId: USER })
      : undefined;
  let allocations = 0;
  let beforeResolve: (() => void) | undefined;
  const primarySlot = createFixtureSlot({
    guildId: GUILD,
    channelId: CHANNEL,
    resolveSource: resolveFixture,
    ...(options.join === undefined ? {} : { joinVoice: options.join }),
    initialPosition: 120,
    events,
    includeSubtitles: true,
  });
  const { actor, handle } = primarySlot;
  const owner = primarySlot;
  const discovery = new DiscoveryService({
    library: () => library,
    searchYoutube: (query) =>
      Promise.resolve([
        {
          title: query + " · live session",
          url: "https://www.youtube.com/watch?v=QrR_gm6RqCo",
          thumbnailUrl: "https://i.ytimg.com/vi/QrR_gm6RqCo/hqdefault.jpg",
          channel: "Tiny Desk",
          durationSeconds: 240,
        },
      ]),
  });
  const catalog = new WebCatalog(() => library, discovery, {
    fetchPoster: fixturePoster,
    sports,
    ...(options.plexArtwork === undefined
      ? {}
      : { plexArtwork: options.plexArtwork }),
  });
  const featureGate: MediaFeatureGate = {
    musicCatalog: () => Promise.resolve(options.musicEnabled === true),
    spotifyLinks: () => Promise.resolve(options.musicEnabled === true),
    playlists: () => Promise.resolve(options.musicEnabled === true),
    radio: () => Promise.resolve(radioEnabled),
    tv: () => Promise.resolve(tvEnabled),
    assistantV2: () => Promise.resolve(advanced),
    history: () => Promise.resolve(options.history !== undefined),
    automaticChannelRouting: () => Promise.resolve(options.automatic === true),
    musicOverVoice: () => Promise.resolve(true),
    sportsStreaming: () => Promise.resolve(sportsEnabled),
    lolEsports: () => Promise.resolve(options.lol === true),
    lolAutoplay: () => Promise.resolve(options.lol === true),
  };
  const revision = (_guild = GUILD, _channel = CHANNEL, slot = selected()) =>
    allocated && slot === allocatedChannel ? sessionRevision(owner) : null;
  const playback = new WebPlayback({
    ...(options.schedules === undefined
      ? {}
      : { schedules: options.schedules }),
    ...(options.music === undefined ? {} : { music: options.music }),
    ...(options.expandPlaylist === undefined
      ? {}
      : { expandPlaylist: options.expandPlaylist }),
    ...(options.expandPlaylistWithMetadata === undefined
      ? {}
      : { expandPlaylistWithMetadata: options.expandPlaylistWithMetadata }),
    sessions: {
      numbered: {
        selected: () => Promise.resolve(selected()),
        selection,
        maximum: () => 3,
      },
      getExisting: (_guild, _channel, slot) =>
        allocated && slot === allocatedChannel ? handle : null,
      ensureForPlay: (params) => {
        allocated = true;
        allocatedChannel = params.playbackChannel;
        allocations += 1;
        return handle;
      },
      startStation: async (params) => {
        allocated = true;
        allocatedChannel = params.playbackChannel;
        allocations += 1;
        const added = await primarySlot.startStation(params.station);
        return { handle, added };
      },
      stopStation: (params) => {
        if (!allocated) return null;
        if (
          params.kind !== undefined &&
          primarySlot.station?.kind !== params.kind
        ) {
          return null;
        }
        const stopped = primarySlot.stopStation();
        if (
          stopped !== null &&
          actor.getSnapshot().matches("idle") &&
          actor.getSnapshot().context.current === null &&
          actor.getSnapshot().context.queue.length === 0
        ) {
          allocated = false;
        }
        return stopped;
      },
      releaseUnused: (_guild, _channel, slot) => {
        if (
          slot === allocatedChannel &&
          primarySlot.station === undefined &&
          actor.getSnapshot().matches("idle")
        )
          allocated = false;
      },
      revision,
    },
    bot: {
      webGuilds: (ids) => guilds.filter((guild) => ids.includes(guild.id)),
      webVerifyMember: () => Promise.resolve(member),
      webVoiceChannel: (guildId) => (guildId === GUILD ? channel : null),
      webReady: () => true,
      webRequesterName: (_guild, user) =>
        Promise.resolve(user === USER ? username : "Casey"),
    },
    commands: {
      config,
      featureGate,
      sports,
      ...(options.history === undefined ? {} : { history: options.history }),
      library: () => library,
      resolvePlaySource: (source) => {
        beforeResolve?.();
        return Promise.resolve(resolveFixture(source));
      },
    },
    featureGate,
    webEnabled: () => Promise.resolve(enabled),
    announce: (_id, message) => {
      announcements.push(message);
      return Promise.resolve();
    },
    catalog,
  });
  const handler = createWebHandler({
    bootstrap: {
      publicOrigin: origin,
      clientSecret: "fixture-only",
      port: 8080,
    },
    store,
    playback,
    assetsDir,
    applicationId: () => "123456789",
    plexPostersEnabled: () => Promise.resolve(plexEnabled),
    fetch: Object.assign(
      (_url: string | URL | Request) => {
        const url = _url instanceof Request ? _url.url : _url.toString();
        if (url.endsWith("/oauth2/token"))
          return Promise.resolve(
            Response.json({ access_token: "fixture-only" }),
          );
        return url.endsWith("/users/@me/guilds")
          ? Promise.resolve(
              Response.json(guilds.map((guild) => ({ id: guild.id }))),
            )
          : Promise.resolve(Response.json({ id: USER, username }));
      },
      { preconnect: fetch.preconnect },
    ),
  });
  const created = store.create({
    userId: USER,
    username,
    guildIds: guilds.map((guild) => guild.id),
  });
  const session = store.read(created.token);
  if (session === null) throw new Error("Fixture session was not persisted");
  return {
    store,
    actor,
    handle,
    primarySlot,
    playback,
    catalog,
    handler,
    session,
    revision,
    events,
    announcements,
    cookie:
      "streambot_session=" +
      created.token +
      "; streambot_csrf=" +
      created.csrfToken,
    csrf: created.csrfToken,
    command: (action: Record<string, unknown>) =>
      new Request(origin + "/api/commands", {
        method: "POST",
        headers: {
          cookie: "streambot_session=" + created.token,
          origin,
          "x-csrf-token": created.csrfToken,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          guildId: GUILD,
          channelId: CHANNEL,
          revision: revision(),
          playbackChannel: selected() ?? null,
          ...action,
        }),
      }),
    seed: async () => {
      allocated = true;
      allocatedChannel = selected();
      actor.send({
        type: "ADD",
        source: {
          kind: "file",
          path: "/media/movies/arrival.mkv",
          title: "Arrival",
        },
        requesterId: OTHER,
        queuedAt: Date.now() - 120_000,
      });
      await waitFor(actor, (snapshot) => snapshot.matches("streaming"), {
        timeout: 2000,
      });
    },
    setChannel: (value: typeof channel) => {
      channel = value;
    },
    enableNumbered: (slot = 2) => {
      numbered = true;
      selection.select(
        { guildId: GUILD, channelId: CHANNEL, userId: USER },
        PlaybackChannelNumberSchema.parse(slot),
        3,
      );
    },
    setMember: (value: boolean) => {
      member = value;
    },
    setEnabled: (value: boolean) => {
      enabled = value;
    },
    setAdvanced: (value: boolean) => {
      advanced = value;
    },
    setSportsEnabled: (value: boolean) => {
      sportsEnabled = value;
    },
    setRadioEnabled: (value: boolean) => {
      radioEnabled = value;
    },
    setTvEnabled: (value: boolean) => {
      tvEnabled = value;
    },
    setPlexEnabled: (value: boolean) => {
      plexEnabled = value;
    },
    setBeforeResolve: (value: typeof beforeResolve) => {
      beforeResolve = value;
    },
    allocations: () => allocations,
    close: () => {
      actor.stop();
      store.close();
    },
  };
}
