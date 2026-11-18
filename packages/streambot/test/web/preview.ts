/** Local visual verification only. Production serves no fixture authentication routes. */
import {
  createFixtureSlot,
  webFixture,
  GUILD,
  CHANNEL,
  USER,
  OTHER,
} from "./web-fixture.ts";
import { FIXTURE_EVENTS } from "./web-fixture-media.ts";
import type { ResolvedSource } from "@shepherdjerred/streambot/machine/types.ts";
import type { SessionHandle } from "@shepherdjerred/streambot/session/session-types.ts";
import { sessionRevision } from "@shepherdjerred/streambot/session/session-revision.ts";
import type { Source } from "@shepherdjerred/streambot/sources/source.ts";
import { MediaHistoryStore } from "@shepherdjerred/streambot/history/media-history.ts";
import { inferMediaIntent } from "@shepherdjerred/streambot/discovery/media-intent.ts";
import type { RecordMedia } from "@shepherdjerred/streambot/history/types.ts";
import { fileURLToPath } from "node:url";
import {
  PlaybackChannelNumberSchema,
  type PlaybackChannelNumber,
} from "@shepherdjerred/streambot/types/playback-channel.ts";
import { LolPlaybackSchedules } from "@shepherdjerred/streambot/sports/playback-schedules.ts";
import { lolSportsEvent } from "@shepherdjerred/streambot/sports/lolesports.ts";
import { matchSportsEvents } from "@shepherdjerred/streambot/sports/sports-service.ts";
import { lolMatch } from "#lol-fixture";
import { fixtureMusic, SONG } from "#music-fixture";
import { musicSource } from "@shepherdjerred/streambot/music/service.ts";

if (import.meta.main) {
  const port = Number(Bun.argv[2] ?? 5188);
  const origin = "http://127.0.0.1:" + String(port);
  const history = new MediaHistoryStore(":memory:");
  const upcoming = {
    ...lolMatch(),
    startTime: new Date(Date.now() + 86_400_000).toISOString(),
  };
  const live = {
    ...lolMatch(),
    id: "115660540726095041",
    state: "inProgress" as const,
    startTime: new Date().toISOString(),
  };
  const lolEvents = [lolSportsEvent(live), lolSportsEvent(upcoming)];
  const schedules = new LolPlaybackSchedules(
    ":memory:",
    { find: () => Promise.resolve(upcoming) },
    {
      allowed: () => Promise.resolve(true),
      authority: () => Promise.resolve({ allowed: true, listeners: true }),
      slot: () => ({ idle: true }),
      start: () => Promise.resolve("busy" as const),
      stop: () => {
        throw new Error("Preview cannot stop a real stream");
      },
    },
  );
  const resolvePreview = (source: Source): ResolvedSource => ({
    title:
      source.music?.title ??
      (source.kind === "file" ? source.title : "Live session"),
    chapters: [],
    ffmpegInput: "fixture",
    mediaKind: source.mode === "music" ? "music" : "video",
    durationSeconds: 10_871,
  });
  const fixture = webFixture(
    origin,
    fileURLToPath(new URL("../../dist/web", import.meta.url)),
    false,
    {
      history,
      music: fixtureMusic(),
      musicEnabled: true,
      username: "Morgan",
      automatic: true,
      lol: true,
      schedules,
      sports: {
        listToday: () => Promise.resolve([...FIXTURE_EVENTS, ...lolEvents]),
        listSchedule: () => Promise.resolve(lolEvents),
        search: (query, provider) =>
          Promise.resolve(
            matchSportsEvents(
              query,
              [...FIXTURE_EVENTS, ...lolEvents],
              provider,
            ),
          ),
      },
      resolve: resolvePreview,
    },
  );
  history.playlists.create(
    { userId: USER, guildId: GUILD },
    "Evening favorites",
    [{ title: "Daft Punk — Get Lucky", source: musicSource(SONG) }],
  );
  const shared = history.playlists.create(
    { userId: OTHER, guildId: GUILD },
    "Friday listening",
    [{ title: "Daft Punk — Get Lucky", source: musicSource(SONG) }],
  );
  history.playlists.edit(
    shared.id,
    { userId: OTHER, guildId: GUILD },
    shared.revision,
    (playlist) => {
      playlist.guild_id = GUILD;
    },
  );
  const videoSlot = PlaybackChannelNumberSchema.parse(2);
  fixture.enableNumbered(2);
  await fixture.seed();
  const slots = new Map<
    PlaybackChannelNumber,
    { actor: typeof fixture.actor; handle: SessionHandle }
  >([[videoSlot, { actor: fixture.actor, handle: fixture.handle }]]);
  const baseSessions = fixture.playback.deps.sessions;
  fixture.playback.deps.sessions = {
    ...baseSessions,
    getExisting: (_guild, _channel, slot) =>
      slot === undefined ? null : (slots.get(slot)?.handle ?? null),
    ensureForPlay: ({ playbackChannel }) => {
      if (playbackChannel === undefined) return fixture.handle;
      let entry = slots.get(playbackChannel);
      if (entry === undefined) {
        entry = createFixtureSlot({ resolveSource: resolvePreview });
        slots.set(playbackChannel, entry);
      }
      return entry.handle;
    },
    releaseUnused: (_guild, _channel, slot) => {
      if (slot === undefined) return;
      const entry = slots.get(slot);
      if (entry?.actor.getSnapshot().matches("idle") === true) {
        if (entry.actor !== fixture.actor) entry.actor.stop();
        slots.delete(slot);
      }
    },
    revision: (_guild, _channel, slot) => {
      if (slot === undefined) return null;
      const entry = slots.get(slot);
      return entry === undefined ? null : sessionRevision(entry);
    },
  };
  fixture.playback.deps.sessions.numbered.selection.clear({
    guildId: GUILD,
    channelId: CHANNEL,
    userId: USER,
  });
  const event = FIXTURE_EVENTS[0];
  if (event === undefined) throw new Error("Missing sports fixture");
  const recent: RecordMedia[] = [
    {
      title: "Arrival",
      provider: "local",
      source: {
        kind: "file",
        path: "/media/movies/arrival.mkv",
        title: "Arrival",
      },
      durationSeconds: 10_871,
    },
    {
      title: "Khruangbin · live session",
      provider: "youtube",
      source: {
        kind: "url",
        url: "https://www.youtube.com/watch?v=QrR_gm6RqCo",
      },
      thumbnailUrl: "https://i.ytimg.com/vi/QrR_gm6RqCo/hqdefault.jpg",
      durationSeconds: 240,
    },
    {
      title: event.title,
      provider: event.provider,
      source: { kind: "url", url: event.pageUrl, sportsEvent: event },
    },
  ];
  for (const [index, media] of recent.entries()) {
    const scope = {
      guildId: GUILD,
      channelId: CHANNEL,
      userId: index === 1 ? OTHER : USER,
    };
    const nowMs = Date.now() - (index + 1) * 3_600_000;
    const requestId = history.recordQueueRequest({
      scope,
      rawQuery: media.title,
      intent: inferMediaIntent({ query: media.title }),
      media,
      nowMs,
    });
    history.recordPlaybackStart({
      requestId,
      scope,
      media,
      nowMs: nowMs + 5000,
    });
    history.finishStartedRequest(requestId, "completed");
  }
  Bun.serve({
    hostname: "127.0.0.1",
    port,
    fetch: async (request) => {
      const response = await fixture.handler(request);
      if (
        new URL(request.url).pathname !== "/api/auth/discord/start" ||
        response.status !== 302
      )
        return response;
      // Exercise the real OAuth callback with the fixture's simulated Discord provider.
      const state = new URL(
        response.headers.get("location") ?? "",
      ).searchParams.get("state");
      const headers = new Headers(response.headers);
      headers.set(
        "location",
        "/api/auth/discord/callback?" +
          new URLSearchParams({
            code: "fixture",
            state: String(state),
          }).toString(),
      );
      return new Response(null, { status: 302, headers });
    },
  });
  console.info("Streambot fixture preview ready on " + origin);
}
