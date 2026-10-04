/** Local visual verification only. Production serves no fixture authentication routes. */
import { webFixture, GUILD, CHANNEL, USER, OTHER } from "./web-fixture.ts";
import { FIXTURE_EVENTS } from "./web-fixture-media.ts";
import { MediaHistoryStore } from "@shepherdjerred/streambot/history/media-history.ts";
import { inferMediaIntent } from "@shepherdjerred/streambot/discovery/media-intent.ts";
import type { RecordMedia } from "@shepherdjerred/streambot/history/types.ts";
import { fileURLToPath } from "node:url";
import { PlaybackChannelNumberSchema } from "@shepherdjerred/streambot/types/playback-channel.ts";

if (import.meta.main) {
  const origin = "http://127.0.0.1:5188";
  const history = new MediaHistoryStore(":memory:");
  const fixture = webFixture(
    origin,
    fileURLToPath(new URL("../../dist/web", import.meta.url)),
    false,
    {
      history,
      username: "Morgan",
      automatic: true,
      resolve: (source) => ({
        title: source.kind === "file" ? source.title : "Live session",
        chapters: [],
        ffmpegInput: "fixture",
        mediaKind: "video",
        durationSeconds: 10_871,
      }),
    },
  );
  fixture.enableNumbered(2);
  fixture.playback.deps.sessions.numbered.selection.clear({
    guildId: GUILD,
    channelId: CHANNEL,
    userId: USER,
  });
  fixture.playback.deps.sessions.numbered.selection.follow(
    { guildId: GUILD, channelId: CHANNEL, userId: USER },
    PlaybackChannelNumberSchema.parse(2),
  );
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
  await fixture.seed();
  Bun.serve({
    hostname: "127.0.0.1",
    port: 5188,
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
  console.info("Streambot fixture preview ready on 127.0.0.1:5188");
}
