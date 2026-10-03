import { createActor, waitFor } from "xstate";
import { createPlaybackMachine } from "@shepherdjerred/streambot/machine/playback-machine.ts";
import { buildPlaybackView } from "@shepherdjerred/streambot/machine/view.ts";
import type {
  PlaybackEvent,
  ResolvedSource,
} from "@shepherdjerred/streambot/machine/types.ts";
import {
  EMPTY_HANDLE,
  type SessionHandle,
} from "@shepherdjerred/streambot/session/session-types.ts";
import { sessionRevision } from "@shepherdjerred/streambot/session/session-revision.ts";
import {
  ChannelIdSchema,
  GuildIdSchema,
  UserIdSchema,
} from "@shepherdjerred/streambot/types/ids.ts";
import { loadConfig } from "@shepherdjerred/streambot/config/index.ts";
import { DiscoveryService } from "@shepherdjerred/streambot/discovery/discovery-service.ts";
import type { Source } from "@shepherdjerred/streambot/sources/source.ts";
import type { LibraryEntry } from "@shepherdjerred/streambot/sources/library.ts";
import {
  sourceIdentity,
  sourceLabel,
} from "@shepherdjerred/streambot/sources/source.ts";
import { WebCatalog } from "@shepherdjerred/streambot/web/server/catalog.ts";
import { WebPlayback } from "@shepherdjerred/streambot/web/server/playback.ts";
import { createWebHandler } from "@shepherdjerred/streambot/web/server/api.ts";
import { WebSessionStore } from "@shepherdjerred/streambot/web/server/session-store.ts";
import type { MediaFeatureGate } from "@shepherdjerred/streambot/config/media-features.ts";
import {
  fixturePoster,
  fixtureSports,
  FIXTURE_EVENTS,
} from "./web-fixture-media.ts";

export const GUILD = GuildIdSchema.parse("100000000000000010");
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
) {
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
  let allocated = false;
  let allocations = 0;
  let position = 120;
  let subtitleBusy = false;
  let beforeResolve: (() => void) | undefined;
  const actor = createActor(
    createPlaybackMachine({
      joinVoice: (input) =>
        Promise.resolve({ guildId: input.guildId, channelId: input.channelId }),
      leaveVoice: () => Promise.resolve(),
      resolveSource: (input) => Promise.resolve(resolved(input.source)),
      runStream: (_input, signal) =>
        new Promise<void>((resolve) => {
          signal.addEventListener(
            "abort",
            () => {
              resolve();
            },
            { once: true },
          );
        }),
    }),
    { input: { guildId: GUILD, channelId: CHANNEL, idleTimeoutMs: 60_000 } },
  );
  actor.start();
  const owner = { actor };
  const handle: SessionHandle = {
    ...EMPTY_HANDLE,
    dispatch: (event) => {
      events.push(event);
      actor.send(event);
    },
    view: () => buildPlaybackView(actor.getSnapshot(), position),
    seek: (seconds) => {
      position = seconds;
      return Promise.resolve(true);
    },
    setVolume: (percent) => {
      actor.send({ type: "SET_VOLUME", volume: percent });
      return Promise.resolve(true);
    },
    currentSourceId: () => {
      const source = actor.getSnapshot().context.current?.source;
      return source === undefined ? null : sourceIdentity(source);
    },
    claimSubtitleMenu: () => {
      if (subtitleBusy) return false;
      subtitleBusy = true;
      return true;
    },
    releaseSubtitleMenu: () => {
      subtitleBusy = false;
    },
    listSubtitleCandidates: () =>
      Promise.resolve([
        {
          kind: "sidecar",
          file: "/private/arrival.en.srt",
          lang: "en",
          modifier: null,
        },
        {
          kind: "embedded",
          subtitleIndex: 0,
          codec: "subrip",
          lang: "fr",
          modifier: null,
        },
      ]),
  };
  const discovery = new DiscoveryService({
    library: () => LIBRARY,
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
  const catalog = new WebCatalog(() => LIBRARY, discovery, {
    fetchPoster: fixturePoster,
    sports: fixtureSports,
  });
  const featureGate: MediaFeatureGate = {
    assistantV2: () => Promise.resolve(advanced),
    history: () => Promise.resolve(false),
    musicOverVoice: () => Promise.resolve(true),
    sportsStreaming: () => Promise.resolve(sportsEnabled),
  };
  const revision = () => (allocated ? sessionRevision(owner) : null);
  const playback = new WebPlayback({
    sessions: {
      getExisting: () => (allocated ? handle : null),
      ensureForPlay: () => {
        allocated = true;
        allocations += 1;
        return handle;
      },
      releaseUnused: () => {
        if (actor.getSnapshot().matches("idle")) allocated = false;
      },
      revision,
    },
    bot: {
      webGuilds: (ids) =>
        ids.includes(GUILD) ? [{ id: GUILD, name: "The living room" }] : [],
      webVerifyMember: () => Promise.resolve(member),
      webVoiceChannel: () => channel,
      webReady: () => true,
    },
    commands: {
      config,
      featureGate,
      sports: fixtureSports,
      library: () => LIBRARY,
      resolvePlaySource: (source) => {
        beforeResolve?.();
        return Promise.resolve(resolved(source));
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
    fetch: Object.assign(
      (_url: string | URL | Request) => {
        const url = _url instanceof Request ? _url.url : _url.toString();
        if (url.endsWith("/oauth2/token"))
          return Promise.resolve(
            Response.json({ access_token: "fixture-only" }),
          );
        return url.endsWith("/users/@me/guilds")
          ? Promise.resolve(Response.json([{ id: GUILD }]))
          : Promise.resolve(Response.json({ id: USER, username: "jerred" }));
      },
      { preconnect: fetch.preconnect },
    ),
  });
  const created = store.create({
    userId: USER,
    username: "jerred",
    guildIds: [GUILD],
  });
  const session = store.read(created.token);
  if (session === null) throw new Error("Fixture session was not persisted");
  return {
    store,
    actor,
    handle,
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
          ...action,
        }),
      }),
    seed: async () => {
      allocated = true;
      actor.send({
        type: "ADD",
        source: {
          kind: "file",
          path: "/media/movies/arrival.mkv",
          title: "Arrival",
        },
        requesterId: OTHER,
      });
      await waitFor(actor, (snapshot) => snapshot.matches("streaming"), {
        timeout: 2000,
      });
    },
    setChannel: (value: typeof channel) => {
      channel = value;
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
