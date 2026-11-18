import { createLlmRuntime } from "@shepherdjerred/llm-runtime";
import { Registry } from "prom-client";
import { describe, expect, test, vi } from "vitest";
import { inferMediaIntent } from "@shepherdjerred/streambot/discovery/media-intent.ts";
import { canonicalWorkKey } from "@shepherdjerred/streambot/discovery/same-work.ts";
import { MediaHistoryStore } from "@shepherdjerred/streambot/history/media-history.ts";
import type { RecordMedia } from "@shepherdjerred/streambot/history/types.ts";
import { MusicCatalog } from "@shepherdjerred/streambot/music/catalog.ts";
import {
  musicSource,
  MusicService,
} from "@shepherdjerred/streambot/music/service.ts";
import { SpotifyMetadata } from "@shepherdjerred/streambot/music/spotify.ts";
import { sourceIdentity } from "@shepherdjerred/streambot/sources/source.ts";
import {
  ChannelIdSchema,
  GuildIdSchema,
  UserIdSchema,
} from "@shepherdjerred/streambot/types/ids.ts";
import {
  COLD_START_RADIO_QUERIES,
  RadioCurator,
} from "@shepherdjerred/streambot/station/radio-curator.ts";
import { suggestRadioTracks } from "@shepherdjerred/streambot/station/radio-llm.ts";
import {
  buildYoutubeMixArgs,
  expandYoutubeMix,
  extractYoutubeVideoId,
} from "@shepherdjerred/streambot/station/youtube-mix.ts";

const GUILD = GuildIdSchema.parse("100000000000000010");
const CHANNEL = ChannelIdSchema.parse("100000000000000020");
const ALICE = UserIdSchema.parse("100000000000000001");
const BOB = UserIdSchema.parse("100000000000000002");
const CAROL = UserIdSchema.parse("100000000000000003");

function recordRun(input: {
  readonly store: MediaHistoryStore;
  readonly userId: string;
  readonly media: RecordMedia;
  readonly outcome: "completed" | "failed" | "skipped";
}): void {
  const scope = { guildId: GUILD, channelId: CHANNEL, userId: input.userId };
  const requestId = input.store.recordQueueRequest({
    scope,
    rawQuery: input.media.title,
    intent: inferMediaIntent({ query: input.media.title }),
    media: input.media,
  });
  input.store.recordPlaybackStart({ requestId, scope, media: input.media });
  input.store.finishStartedRequest(requestId, input.outcome);
}

describe("music taste profile aggregation", () => {
  test("blends room human listeners, boosts completions/favorites/playlists, and penalizes skips", () => {
    const store = new MediaHistoryStore(":memory:");
    try {
      const sharedSong: RecordMedia = {
        title: "Khruangbin — Time (You and I)",
        provider: "youtube",
        source: {
          kind: "url",
          url: "https://www.youtube.com/watch?v=fL9L9P9Q1aA",
          mode: "music",
        },
        durationSeconds: 320,
      };
      const skippedSong: RecordMedia = {
        title: "Noisy Track — Instant Skip",
        provider: "youtube",
        source: {
          kind: "url",
          url: "https://www.youtube.com/watch?v=sK1pP3dTrk1",
          mode: "music",
        },
        durationSeconds: 210,
      };
      const favoriteSong: RecordMedia = {
        title: "Daft Punk — Instant Crush",
        provider: "youtube",
        source: {
          kind: "url",
          url: "https://www.youtube.com/watch?v=a5uQMwRMHcs",
          mode: "music",
        },
        durationSeconds: 337,
      };
      const longVideo: RecordMedia = {
        title: "3 Hour Documentary",
        provider: "youtube",
        source: {
          kind: "url",
          url: "https://www.youtube.com/watch?v=d0cUm3ntAry",
          mode: "video",
        },
        durationSeconds: 10_800,
      };

      recordRun({
        store,
        userId: ALICE,
        media: sharedSong,
        outcome: "completed",
      });
      recordRun({
        store,
        userId: BOB,
        media: sharedSong,
        outcome: "completed",
      });
      recordRun({
        store,
        userId: ALICE,
        media: skippedSong,
        outcome: "skipped",
      });
      recordRun({
        store,
        userId: ALICE,
        media: longVideo,
        outcome: "completed",
      });
      store.addFavorite(BOB, favoriteSong);
      store.playlists.create({ userId: ALICE, guildId: GUILD }, "Chill Mix", [
        {
          title: "Gorillaz — On Melancholy Hill",
          source: {
            kind: "url",
            url: "https://www.youtube.com/watch?v=04mfKJWDSzI",
            mode: "music",
          },
        },
      ]);

      // Server listener Carol fills room fallback when room has < 5 distinct items.
      recordRun({
        store,
        userId: CAROL,
        media: {
          title: "Sade — Smooth Operator",
          provider: "youtube",
          source: {
            kind: "url",
            url: "https://www.youtube.com/watch?v=4TYv2PhG89A",
            mode: "music",
          },
          durationSeconds: 298,
        },
        outcome: "completed",
      });

      const profile = store.musicTasteProfile({
        listenerIds: [ALICE, BOB],
        ownerId: ALICE,
        guildId: GUILD,
        scope: "room",
        excludeIdentities: new Set(),
      });

      const titles = profile.familiarCandidates.map((item) => item.title);
      expect(titles[0]).toBe("Khruangbin — Time (You and I)");
      expect(titles).toContain("Daft Punk — Instant Crush");
      expect(titles).toContain("Gorillaz — On Melancholy Hill");
      expect(titles).toContain("Sade — Smooth Operator");
      expect(titles).not.toContain("Noisy Track — Instant Skip");
      expect(titles).not.toContain("3 Hour Documentary");
      expect(profile.skippedTitles).toContain("Noisy Track — Instant Skip");
      expect(profile.topArtists).toContain("Khruangbin");
    } finally {
      store.close();
    }
  });
});

describe("YouTube Mix, MusicBrainz artistRecordings, and LLM suggestions", () => {
  test("extracts YouTube video IDs and filters seed, adult, and excluded Mix entries", async () => {
    expect(
      extractYoutubeVideoId("https://www.youtube.com/watch?v=fL9L9P9Q1aA&t=10"),
    ).toBe("fL9L9P9Q1aA");
    expect(extractYoutubeVideoId("https://youtu.be/a5uQMwRMHcs")).toBe(
      "a5uQMwRMHcs",
    );
    expect(
      extractYoutubeVideoId("https://example.com/watch?v=a5uQMwRMHcs"),
    ).toBeNull();

    const args = buildYoutubeMixArgs("fL9L9P9Q1aA", 12);
    expect(args).toContain(
      "https://www.youtube.com/watch?v=fL9L9P9Q1aA&list=RDfL9L9P9Q1aA",
    );

    const excludedUrl = "https://www.youtube.com/watch?v=4TYv2PhG89A";
    const items = await expandYoutubeMix({
      ytDlpPath: "yt-dlp",
      videoId: "fL9L9P9Q1aA",
      limit: 10,
      excludeIdentities: new Set([`url:${excludedUrl}`]),
      signal: new AbortController().signal,
      run: () =>
        Promise.resolve({
          exitCode: 0,
          stderr: "",
          stdout: [
            "https://www.youtube.com/watch?v=fL9L9P9Q1aA\tSeed Song",
            "https://www.youtube.com/watch?v=a5uQMwRMHcs\tDaft Punk — Instant Crush",
            `${excludedUrl}\tSade — Smooth Operator`,
            "https://www.pornhub.com/view_video.php?viewkey=123\tBlocked Adult",
            "https://www.youtube.com/watch?v=04mfKJWDSzI\tChill 10 Hours Full Album",
            "https://www.youtube.com/watch?v=pFptt7Cargc\tTame Impala — Let It Happen",
          ].join("\n"),
        }),
    });

    expect(items.map((item) => item.title)).toEqual([
      "Daft Punk — Instant Crush",
      "Tame Impala — Let It Happen",
    ]);
  });

  test("queries MusicBrainz artistRecordings and handles LLM radio suggestions safely", async () => {
    const seenUrls: string[] = [];
    const catalog = new MusicCatalog(
      Object.assign(
        (input: string | URL | Request) => {
          const url =
            typeof input === "string"
              ? input
              : input instanceof URL
                ? input.href
                : input.url;
          seenUrls.push(url);
          return Promise.resolve(
            Response.json({
              recordings: [
                {
                  id: "11111111-1111-4111-8111-111111111111",
                  title: "Maria También",
                  length: 190_000,
                  "artist-credit": [{ name: "Khruangbin" }],
                },
              ],
            }),
          );
        },
        { preconnect: fetch.preconnect },
      ),
    );

    const tracks = await catalog.artistRecordings(
      "Khruangbin",
      new AbortController().signal,
      5,
    );
    expect(seenUrls[0]).toContain("recording?");
    expect(seenUrls[0]).toContain("dismax=true");
    expect(tracks[0]?.title).toBe("Maria También");

    // Without API key or runtime, returns [] gracefully.
    expect(
      await suggestRadioTracks({
        topArtists: ["Khruangbin"],
        topTracks: [],
        recentQueries: [],
        skippedTitles: [],
        excludeWorkKeys: new Set(),
        signal: new AbortController().signal,
      }),
    ).toEqual([]);

    const logs: unknown[] = [];
    const runtime = createLlmRuntime({
      service: "streambot",
      appName: "Streambot",
      credentials: { openai: { apiKey: "sk-test-radio" } },
      metricsRegister: new Registry(),
      logger: (entry) => {
        logs.push(entry);
      },
      fetch: () =>
        Promise.resolve(
          Response.json({
            id: "resp_radio_1",
            object: "response",
            created_at: 1_700_000_000,
            model: "gpt-6-luna",
            output: [
              {
                type: "message",
                id: "msg_1",
                status: "completed",
                role: "assistant",
                content: [
                  {
                    type: "output_text",
                    text: JSON.stringify({
                      tracks: [
                        { artist: "Air", title: "La Femme d'Argent" },
                        { artist: "Daft Punk", title: "Instant Crush" },
                      ],
                    }),
                    annotations: [],
                  },
                ],
              },
            ],
            usage: {
              input_tokens: 50,
              output_tokens: 25,
              total_tokens: 75,
            },
          }),
        ),
    });

    const suggested = await suggestRadioTracks({
      runtime,
      seed: "secret-mood-seed",
      topArtists: ["Khruangbin"],
      topTracks: ["Khruangbin — Time"],
      recentQueries: ["private user query"],
      skippedTitles: [],
      excludeWorkKeys: new Set([canonicalWorkKey("Daft Punk - Instant Crush")]),
      signal: new AbortController().signal,
    });
    expect(suggested).toEqual([{ artist: "Air", title: "La Femme d'Argent" }]);
    expect(JSON.stringify(logs)).not.toContain("private user query");
  });
});

describe("RadioCurator end-to-end curation", () => {
  test("deduplicates familiar + related sources, enforces seed steering, and falls back on cold start", async () => {
    const store = new MediaHistoryStore(":memory:");
    try {
      recordRun({
        store,
        userId: ALICE,
        media: {
          title: "Khruangbin — Time (You and I)",
          provider: "youtube",
          source: {
            kind: "url",
            url: "https://www.youtube.com/watch?v=fL9L9P9Q1aA",
            mode: "music",
          },
          durationSeconds: 320,
        },
        outcome: "completed",
      });

      const searchYoutube = vi.fn((query: string) =>
        Promise.resolve([
          {
            title: `${query} — Official Audio`,
            url: `https://www.youtube.com/watch?v=${query.replaceAll(/\W/gu, "").padEnd(11, "x").slice(0, 11)}`,
            channel: "Official Topic",
            durationSeconds: 240,
          },
          {
            title: "Too Long Live Mix",
            url: "https://www.youtube.com/watch?v=t00L0ngMix1",
            durationSeconds: 3600,
          },
        ]),
      );

      const catalog = new MusicCatalog(
        Object.assign(
          () =>
            Promise.resolve(
              Response.json({
                recordings: [
                  {
                    id: "22222222-2222-4222-8222-222222222222",
                    title: "People Everywhere",
                    length: 200_000,
                    "artist-credit": [{ name: "Khruangbin" }],
                  },
                ],
              }),
            ),
          { preconnect: fetch.preconnect },
        ),
      );
      const music = new MusicService(
        catalog,
        new SpotifyMetadata(),
        searchYoutube,
      );

      const curator = new RadioCurator({
        history: store,
        music,
        searchYoutube,
        random: () => 0.1,
        runMixSubprocess: () =>
          Promise.resolve({
            exitCode: 0,
            stderr: "",
            stdout:
              "https://www.youtube.com/watch?v=fL9L9P9Q1aA\tKhruangbin — Time (You and I)\n" +
              "https://www.youtube.com/watch?v=04mfKJWDSzI\tGorillaz — On Melancholy Hill\n",
          }),
      });

      const personalized = await curator.curate({
        guildId: GUILD,
        channelId: CHANNEL,
        station: {
          kind: "radio",
          scope: "room",
          ownerId: ALICE,
          recentIdentities: [],
          skippedIdentities: [],
        },
        listenerIds: [ALICE],
        excludeIdentities: new Set(),
        excludeWorkKeys: new Set(),
        count: 3,
        mode: "music",
        signal: new AbortController().signal,
      });

      expect(personalized).toHaveLength(3);
      expect(personalized[0]?.title).toBe("Khruangbin — Time (You and I)");
      expect(personalized.map((item) => item.title)).toContain(
        "Gorillaz — On Melancholy Hill",
      );
      const uniqueIdentities = new Set(
        personalized.map((item) => sourceIdentity(item.source)),
      );
      expect(uniqueIdentities.size).toBe(3);

      // Seeded steering
      const seeded = await curator.curate({
        guildId: GUILD,
        channelId: CHANNEL,
        station: {
          kind: "radio",
          scope: "mine",
          ownerId: ALICE,
          seed: "Synthwave Sunset",
          recentIdentities: [],
          skippedIdentities: [],
        },
        listenerIds: [ALICE],
        excludeIdentities: new Set(),
        excludeWorkKeys: new Set(),
        count: 2,
        mode: "music",
        signal: new AbortController().signal,
      });
      expect(seeded.length).toBeGreaterThan(0);
      expect(seeded[0]?.title).toContain("Synthwave Sunset");

      // Cold-start fallback on an empty store
      const coldStore = new MediaHistoryStore(":memory:");
      try {
        const coldCurator = new RadioCurator({
          history: coldStore,
          searchYoutube,
          random: () => 0,
        });
        const cold = await coldCurator.curate({
          guildId: GUILD,
          channelId: CHANNEL,
          station: {
            kind: "radio",
            scope: "room",
            ownerId: ALICE,
            recentIdentities: [],
            skippedIdentities: [],
          },
          listenerIds: [ALICE],
          excludeIdentities: new Set(),
          excludeWorkKeys: new Set(),
          count: 2,
          mode: "music",
          signal: new AbortController().signal,
        });
        expect(cold).toHaveLength(2);
        expect(cold[0]?.title).toContain(COLD_START_RADIO_QUERIES[0] ?? "");
        expect(musicSource).toBeDefined();
      } finally {
        coldStore.close();
      }
    } finally {
      store.close();
    }
  });
});
