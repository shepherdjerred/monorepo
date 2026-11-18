import { createLlmRuntime } from "@shepherdjerred/llm-runtime";
import { describe, expect, test } from "vitest";
import { inferMediaIntent } from "@shepherdjerred/streambot/discovery/media-intent.ts";
import { MediaHistoryStore } from "@shepherdjerred/streambot/history/media-history.ts";
import type { PlexItemMetadata } from "@shepherdjerred/streambot/metadata/plex-catalog.ts";
import type { LibraryMetadataProvider } from "@shepherdjerred/streambot/metadata/plex.ts";
import type { LibraryEntry } from "@shepherdjerred/streambot/sources/library.ts";
import {
  sourceIdentity,
  type Source,
} from "@shepherdjerred/streambot/sources/source.ts";
import type {
  PersistedStation,
  TvPreset,
} from "@shepherdjerred/streambot/state/station-schema.ts";
import type { StationCurationContext } from "@shepherdjerred/streambot/station/station-types.ts";
import { createTvCurator } from "@shepherdjerred/streambot/station/tv-curator.ts";
import {
  ChannelIdSchema,
  GuildIdSchema,
  UserIdSchema,
} from "@shepherdjerred/streambot/types/ids.ts";
import { PlaybackChannelNumberSchema } from "@shepherdjerred/streambot/types/playback-channel.ts";

const GUILD_ID = GuildIdSchema.parse("111111111111111111");
const CHANNEL_ID = ChannelIdSchema.parse("222222222222222222");
const USER_A = UserIdSchema.parse("333333333333333333");
const USER_B = UserIdSchema.parse("444444444444444444");
const VIDEO_CHANNEL = PlaybackChannelNumberSchema.parse(2);

function tvEntry(
  series: string,
  season: number,
  episode: number,
  path?: string,
): LibraryEntry {
  const padS = String(season).padStart(2, "0");
  const padE = String(episode).padStart(2, "0");
  const title = `${series} - S${padS}E${padE}`;
  const fullPath = path ?? `/media/tv/${series}/Season ${padS}/${title}.mkv`;
  return {
    title,
    path: fullPath,
    relativePath: fullPath.replace(/^\/media\/tv\//u, ""),
    library: "tv",
    series,
    season,
    episode,
  };
}

function movieEntry(title: string, path?: string): LibraryEntry {
  const fullPath = path ?? `/media/movies/${title}.mkv`;
  return {
    title,
    path: fullPath,
    relativePath: fullPath.replace(/^\/media\/movies\//u, ""),
    library: "movies",
  };
}

function fakePlex(
  items: Readonly<Record<string, PlexItemMetadata>>,
): LibraryMetadataProvider {
  const map = new Map<string, PlexItemMetadata>(Object.entries(items));
  return {
    metadataForPath: async (p) => map.get(p) ?? null,
    cachedMetadataForPath: (p) => map.get(p) ?? null,
    ensureIndexed: async () => map,
  };
}

function recordPlay(
  history: MediaHistoryStore,
  input: {
    readonly userId?: string;
    readonly provider: "local" | "youtube";
    readonly title: string;
    readonly source: Source;
    readonly channel?: string;
    readonly durationSeconds?: number;
    readonly outcome?: "completed" | "skipped";
    readonly nowMs: number;
  },
): void {
  const scope = {
    guildId: GUILD_ID,
    channelId: CHANNEL_ID,
    userId: input.userId ?? USER_A,
  };
  const media = {
    provider: input.provider,
    title: input.title,
    source: input.source,
    ...(input.channel === undefined ? {} : { channel: input.channel }),
    ...(input.durationSeconds === undefined
      ? {}
      : { durationSeconds: input.durationSeconds }),
  };
  const requestId = history.recordQueueRequest({
    scope,
    rawQuery: input.title,
    intent: inferMediaIntent({ query: input.title }),
    media,
    nowMs: input.nowMs,
  });
  history.recordPlaybackStart({
    requestId,
    scope,
    media,
    nowMs: input.nowMs,
  });
  history.finishStartedRequest(requestId, input.outcome ?? "completed");
}

function buildContext(options: {
  readonly preset?: TvPreset;
  readonly seed?: string;
  readonly count?: number;
  readonly excludeIdentities?: readonly string[];
  readonly skippedIdentities?: readonly string[];
}): StationCurationContext {
  const station: PersistedStation = {
    kind: "tv",
    scope: "room",
    ownerId: USER_A,
    ...(options.preset === undefined ? {} : { tvPreset: options.preset }),
    ...(options.seed === undefined ? {} : { seed: options.seed }),
    recentIdentities: [],
    skippedIdentities: [...(options.skippedIdentities ?? [])],
  };
  return {
    guildId: GUILD_ID,
    channelId: CHANNEL_ID,
    playbackChannel: VIDEO_CHANNEL,
    station,
    listenerIds: [USER_A, USER_B],
    excludeIdentities: new Set(options.excludeIdentities),
    excludeWorkKeys: new Set(),
    count: options.count ?? 3,
    mode: "video",
    signal: new AbortController().signal,
  };
}

describe("createTvCurator", () => {
  test("continue-series rolls S01Efinal -> S02E01 and falls back to unstarted shows when active series finish", async () => {
    const history = new MediaHistoryStore(":memory:");
    try {
      const bear108 = tvEntry("The Bear", 1, 8);
      const bear201 = tvEntry("The Bear", 2, 1);
      const severance101 = tvEntry("Severance", 1, 1);
      const severance102 = tvEntry("Severance", 1, 2);
      const entries = [bear108, bear201, severance101, severance102];

      recordPlay(history, {
        provider: "local",
        title: bear108.title,
        source: { kind: "file", path: bear108.path, title: bear108.title },
        nowMs: 1000,
      });

      const curator = createTvCurator({
        history,
        libraryEntries: () => entries,
        rng: () => 0,
      });

      const batch = await curator.curate(
        buildContext({
          preset: "continue-series",
          count: 2,
          excludeIdentities: [
            sourceIdentity({
              kind: "file",
              path: bear108.path,
              title: bear108.title,
            }),
          ],
        }),
      );

      expect(batch.map((item) => item.title)).toEqual([
        "The Bear - S02E01",
        "Severance - S01E01",
      ]);
      expect(batch.every((item) => item.source.mode === "video")).toBe(true);
    } finally {
      history.close();
    }
  });

  test("sitcoms filters Plex Comedy/Animation episodes <=45m and falls back cleanly for local-only libraries", async () => {
    const history = new MediaHistoryStore(":memory:");
    try {
      const office = tvEntry("The Office", 2, 1);
      const archer = tvEntry("Archer", 1, 1);
      const longComedy = tvEntry("Special Hour", 1, 1);
      const drama = tvEntry("Succession", 1, 1);
      const entries = [office, archer, longComedy, drama];

      const plex = fakePlex({
        [office.path]: {
          sectionType: "show",
          durationSeconds: 22 * 60,
          genres: ["Comedy"],
        },
        [archer.path]: {
          sectionType: "show",
          durationSeconds: 21 * 60,
          genres: ["Animation"],
        },
        [longComedy.path]: {
          sectionType: "show",
          durationSeconds: 58 * 60,
          genres: ["Comedy"],
        },
        [drama.path]: {
          sectionType: "show",
          durationSeconds: 60 * 60,
          genres: ["Drama"],
        },
      });

      const indexedCurator = createTvCurator({
        history,
        libraryEntries: () => entries,
        plexMetadata: plex,
        rng: () => 0,
      });
      const sitcoms = await indexedCurator.curate(
        buildContext({ preset: "sitcoms", count: 4 }),
      );
      expect(sitcoms.map((item) => item.title).toSorted()).toEqual([
        "Archer - S01E01",
        "The Office - S02E01",
      ]);

      // Local-only library without Plex metadata still rotates comedy-cued / episodic files.
      const localCurator = createTvCurator({
        history,
        libraryEntries: () => [
          {
            ...office,
            library: "comedy-sitcoms",
          },
          drama,
        ],
        rng: () => 0,
      });
      const localPicks = await localCurator.curate(
        buildContext({ preset: "sitcoms", count: 1 }),
      );
      expect(localPicks[0]?.title).toBe("The Office - S02E01");
    } finally {
      history.close();
    }
  });

  test("movies filters non-episodic Plex movies and ranks unseen + genre affinity + seed matches", async () => {
    const history = new MediaHistoryStore(":memory:");
    try {
      const heat = movieEntry("Heat (1995)");
      const thief = movieEntry("Thief (1981)");
      const notebook = movieEntry("The Notebook (2004)");
      const bladeRunner = movieEntry("Blade Runner 2049 (2017)");
      const tvSpecial = movieEntry("Short TV Bonus", "/media/tv/Bonus.mkv");
      const episode = tvEntry("Andor", 1, 1);
      const entries = [heat, thief, notebook, bladeRunner, tvSpecial, episode];

      recordPlay(history, {
        provider: "local",
        title: heat.title,
        source: { kind: "file", path: heat.path, title: heat.title },
        nowMs: 2000,
      });

      const plex = fakePlex({
        [heat.path]: {
          sectionType: "movie",
          durationSeconds: 170 * 60,
          genres: ["Crime", "Thriller"],
        },
        [thief.path]: {
          sectionType: "movie",
          durationSeconds: 123 * 60,
          genres: ["Crime", "Thriller"],
        },
        [notebook.path]: {
          sectionType: "movie",
          durationSeconds: 123 * 60,
          genres: ["Romance"],
        },
        [bladeRunner.path]: {
          sectionType: "movie",
          durationSeconds: 164 * 60,
          genres: ["Sci-Fi"],
        },
        [tvSpecial.path]: {
          sectionType: "show",
          durationSeconds: 20 * 60,
          genres: ["Crime"],
        },
      });

      const curator = createTvCurator({
        history,
        libraryEntries: () => entries,
        plexMetadata: plex,
        rng: () => 0.1,
      });

      const byAffinity = await curator.curate(
        buildContext({ preset: "movies", count: 3 }),
      );
      // Unseen Crime/Thriller movie (`Thief`) outranks unseen non-matching genres and already-seen `Heat`, and excludes TV specials/episodes.
      expect(byAffinity[0]?.title).toBe("Thief (1981)");
      expect(byAffinity.map((item) => item.title)).not.toContain(
        "Short TV Bonus",
      );
      expect(byAffinity.map((item) => item.title)).not.toContain(
        "Andor - S01E01",
      );

      const seeded = await curator.curate(
        buildContext({ preset: "movies", seed: "sci-fi", count: 1 }),
      );
      expect(seeded[0]?.title).toBe("Blade Runner 2049 (2017)");
    } finally {
      history.close();
    }
  });
});

describe("createTvCurator youtube preset", () => {
  test("youtube curates watchable video URLs, filters music.youtube.com and Topic audio, and uses Mix/seed/LLM", async () => {
    const history = new MediaHistoryStore(":memory:");
    try {
      const watchedUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
      const musicUrl = "https://music.youtube.com/watch?v=aaaaaaaaaaa";
      const topicUrl = "https://www.youtube.com/watch?v=bbbbbbbbbbb";

      recordPlay(history, {
        provider: "youtube",
        title: "Speedrun World Record Progression",
        source: {
          kind: "url",
          url: watchedUrl,
          title: "Speedrun World Record Progression",
        },
        channel: "Summoning Salt",
        durationSeconds: 1800,
        nowMs: 1000,
      });
      recordPlay(history, {
        provider: "youtube",
        title: "Synth Track",
        source: { kind: "url", url: musicUrl, title: "Synth Track" },
        channel: "Artist",
        durationSeconds: 210,
        nowMs: 1100,
      });
      recordPlay(history, {
        provider: "youtube",
        title: "Album Cut",
        source: { kind: "url", url: topicUrl, title: "Album Cut" },
        channel: "Band - Topic",
        durationSeconds: 240,
        nowMs: 1200,
      });

      const logs: unknown[] = [];
      const fakeLlm = createLlmRuntime({
        service: "streambot-test",
        appName: "streambot",
        credentials: { openai: { apiKey: "test-key" } },
        logger: (record) => {
          logs.push(record);
        },
        fetch: async () =>
          Response.json({
            id: "resp_1",
            object: "response",
            created_at: 1,
            model: "gpt-5.4-nano",
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
                      queries: ["retro console architecture documentary"],
                    }),
                    annotations: [],
                  },
                ],
              },
            ],
            usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
          }),
      });

      const curator = createTvCurator({
        history,
        libraryEntries: () => [],
        fetchMix: async ({ videoId }) =>
          videoId === "dQw4w9WgXcQ"
            ? [
                {
                  url: "https://music.youtube.com/watch?v=ccccccccccc",
                  title: "Music Track",
                },
                {
                  url: "https://www.youtube.com/watch?v=eeeeeeeeeee",
                  title: "Audio Track (Official Audio)",
                },
                {
                  url: "https://www.youtube.com/watch?v=fffffffffff",
                  title: "Mario 64 A-Button Challenge Explained",
                  channel: "Bismuth",
                },
              ]
            : [],
        discovery: {
          searchYoutube: async (query) =>
            query.includes("retro")
              ? [
                  {
                    url: "https://youtu.be/ggggggggggg",
                    title: "PS2 Hardware Deep Dive",
                    channel: "Modern Vintage Gamer",
                  },
                ]
              : [
                  {
                    url: "https://www.youtube.com/watch?v=hhhhhhhhhhh",
                    title: "Punch-Out World Record History",
                    channel: "Summoning Salt",
                  },
                ],
        },
        llm: fakeLlm,
      });

      const results = await curator.curate(
        buildContext({
          preset: "youtube",
          count: 4,
          excludeIdentities: [`url:${watchedUrl}`],
        }),
      );

      expect(results.map((item) => item.title)).toEqual([
        "Mario 64 A-Button Challenge Explained",
        "Punch-Out World Record History",
        "PS2 Hardware Deep Dive",
      ]);
      expect(
        results.every(
          (item) => item.source.kind === "url" && item.source.mode === "video",
        ),
      ).toBe(true);
    } finally {
      history.close();
    }
  });
});

describe("createTvCurator my-mix preset", () => {
  test("my-mix blends ~40% episodic, ~30% movies, ~30% youtube, steers by seed, and honors exclusions", async () => {
    const history = new MediaHistoryStore(":memory:");
    try {
      const ep1 = tvEntry("Star Trek", 1, 1);
      const ep2 = tvEntry("Star Trek", 1, 2);
      const ep3 = tvEntry("Star Trek", 1, 3);
      const ep4 = tvEntry("Star Trek", 1, 4);
      const ep5 = tvEntry("Star Trek", 1, 5);
      const mv1 = movieEntry("Interstellar (2014)");
      const mv2 = movieEntry("Arrival (2016)");
      const mv3 = movieEntry("Dune (2021)");
      const entries = [ep1, ep2, ep3, ep4, ep5, mv1, mv2, mv3];

      recordPlay(history, {
        provider: "local",
        title: ep1.title,
        source: { kind: "file", path: ep1.path, title: ep1.title },
        nowMs: 1000,
      });
      recordPlay(history, {
        provider: "youtube",
        title: "NASAJPL Mars Rover Landing",
        source: {
          kind: "url",
          url: "https://www.youtube.com/watch?v=11111111111",
          title: "NASAJPL Mars Rover Landing",
        },
        channel: "NASA",
        nowMs: 1200,
      });

      const curator = createTvCurator({
        history,
        libraryEntries: () => entries,
        fetchMix: async () => [
          {
            url: "https://www.youtube.com/watch?v=22222222222",
            title: "James Webb Telescope First Images",
            channel: "NASA",
          },
          {
            url: "https://www.youtube.com/watch?v=33333333333",
            title: "Voyager Golden Record Documentary",
            channel: "PBS",
          },
        ],
        rng: () => 0.2,
      });

      const tenPack = await curator.curate(
        buildContext({
          count: 10,
          excludeIdentities: [
            sourceIdentity({ kind: "file", path: ep1.path, title: ep1.title }),
          ],
          skippedIdentities: [
            sourceIdentity({ kind: "file", path: ep2.path, title: ep2.title }),
          ],
        }),
      );

      expect(tenPack).toHaveLength(9);
      const titles = tenPack.map((item) => item.title);
      expect(titles).not.toContain(ep1.title);
      expect(titles).not.toContain(ep2.title);
      expect(titles.filter((t) => t.startsWith("Star Trek"))).toHaveLength(3);
      expect(titles.filter((t) => t.includes("(20"))).toHaveLength(3);
      expect(tenPack.filter((item) => item.source.kind === "url")).toHaveLength(
        3,
      );

      // Seed steering prioritizes matching items across lanes first.
      const seeded = await curator.curate(
        buildContext({ seed: "Arrival", count: 2 }),
      );
      expect(seeded[0]?.title).toBe("Arrival (2016)");
    } finally {
      history.close();
    }
  });
});
