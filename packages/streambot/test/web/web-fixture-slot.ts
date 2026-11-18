import { createActor } from "xstate";
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
import {
  sourceIdentity,
  type Source,
} from "@shepherdjerred/streambot/sources/source.ts";
import {
  appendStationRingBuffer,
  MAX_STATION_RECENT_IDENTITIES,
  MAX_STATION_SKIPPED_IDENTITIES,
  type PersistedStation,
} from "@shepherdjerred/streambot/state/station-schema.ts";
import type { CuratedStationItem } from "@shepherdjerred/streambot/station/station-types.ts";
import type {
  ChannelId,
  GuildId,
} from "@shepherdjerred/streambot/types/ids.ts";

const FIXTURE_RADIO_CATALOG: readonly {
  readonly id: string;
  readonly artist: string;
  readonly title: string;
  readonly videoId: string;
  readonly durationSeconds: number;
}[] = [
  {
    id: "fix-radio-1",
    artist: "Khruangbin",
    title: "Time (You and I)",
    videoId: "fL9L9P9Q1aA",
    durationSeconds: 321,
  },
  {
    id: "fix-radio-2",
    artist: "Daft Punk",
    title: "Instant Crush",
    videoId: "a5uQMwRMHcs",
    durationSeconds: 337,
  },
  {
    id: "fix-radio-3",
    artist: "Gorillaz",
    title: "On Melancholy Hill",
    videoId: "04mfKJWDSzI",
    durationSeconds: 233,
  },
  {
    id: "fix-radio-4",
    artist: "Tame Impala",
    title: "Let It Happen",
    videoId: "pFptt7Cargc",
    durationSeconds: 467,
  },
  {
    id: "fix-radio-5",
    artist: "Fleetwood Mac",
    title: "Dreams",
    videoId: "mrZRURcb1cM",
    durationSeconds: 257,
  },
  {
    id: "fix-radio-6",
    artist: "Sade",
    title: "Smooth Operator",
    videoId: "4TYv2PhG89A",
    durationSeconds: 298,
  },
];

const FIXTURE_TV_CATALOG: readonly {
  readonly presets: readonly string[];
  readonly title: string;
  readonly source: Source;
  readonly durationSeconds: number;
  readonly thumbnailUrl?: string;
}[] = [
  {
    presets: ["my-mix", "continue-series"],
    title: "Severance — Good News About Hell",
    source: {
      kind: "file",
      path: "/media/tv/severance/1-1.mkv",
      title: "Severance — Good News About Hell",
      mode: "video",
    },
    durationSeconds: 3420,
  },
  {
    presets: ["my-mix", "sitcoms", "continue-series"],
    title: "The Bear — System",
    source: {
      kind: "file",
      path: "/media/tv/the-bear/1-1.mkv",
      title: "The Bear — System",
      mode: "video",
    },
    durationSeconds: 1740,
  },
  {
    presets: ["my-mix", "movies"],
    title: "Spirited Away",
    source: {
      kind: "file",
      path: "/media/movies/spirited-away.mkv",
      title: "Spirited Away",
      mode: "video",
    },
    durationSeconds: 7500,
  },
  {
    presets: ["my-mix", "continue-series"],
    title: "Severance — Half Loop",
    source: {
      kind: "file",
      path: "/media/tv/severance/1-2.mkv",
      title: "Severance — Half Loop",
      mode: "video",
    },
    durationSeconds: 3180,
  },
  {
    presets: ["sitcoms"],
    title: "Abbott Elementary — Pilot",
    source: {
      kind: "file",
      path: "/media/tv/abbott-elementary/1-1.mkv",
      title: "Abbott Elementary — Pilot",
      mode: "video",
    },
    durationSeconds: 1320,
  },
  {
    presets: ["movies"],
    title: "Whiplash",
    source: {
      kind: "file",
      path: "/media/movies/whiplash.mkv",
      title: "Whiplash",
      mode: "video",
    },
    durationSeconds: 6360,
  },
  {
    presets: ["my-mix", "youtube"],
    title: "Defunctland — Disney's FastPass: A Complicated History",
    source: {
      kind: "url",
      url: "https://www.youtube.com/watch?v=9yjZpBq1XBE",
      title: "Defunctland — Disney's FastPass: A Complicated History",
      mode: "video",
    },
    durationSeconds: 6180,
    thumbnailUrl: "https://i.ytimg.com/vi/9yjZpBq1XBE/hqdefault.jpg",
  },
  {
    presets: ["youtube"],
    title: "Summoning Salt — Mario Kart 64 World Record History",
    source: {
      kind: "url",
      url: "https://www.youtube.com/watch?v=t36a3i2B2vE",
      title: "Summoning Salt — Mario Kart 64 World Record History",
      mode: "video",
    },
    durationSeconds: 3240,
    thumbnailUrl: "https://i.ytimg.com/vi/t36a3i2B2vE/hqdefault.jpg",
  },
];

function curateFixtureTvItems(
  station: PersistedStation,
  exclude: ReadonlySet<string>,
  count: number,
): readonly CuratedStationItem[] {
  const preset = station.tvPreset ?? "my-mix";
  const seed = station.seed?.trim().toLowerCase() ?? "";
  const matchingPreset = FIXTURE_TV_CATALOG.filter((entry) =>
    entry.presets.includes(preset),
  );
  const ordered =
    seed === ""
      ? matchingPreset
      : matchingPreset.toSorted(
          (left, right) =>
            Number(!left.title.toLowerCase().includes(seed)) -
            Number(!right.title.toLowerCase().includes(seed)),
        );
  const results: CuratedStationItem[] = [];
  for (const entry of ordered) {
    if (results.length >= count) break;
    if (exclude.has(sourceIdentity(entry.source))) continue;
    results.push({
      title: entry.title,
      source: entry.source,
      durationSeconds: entry.durationSeconds,
      ...(entry.thumbnailUrl === undefined
        ? {}
        : { thumbnailUrl: entry.thumbnailUrl }),
    });
  }
  return results;
}

function curateFixtureTracks(
  station: PersistedStation,
  exclude: ReadonlySet<string>,
  count: number,
): readonly CuratedStationItem[] {
  if (station.kind === "tv") {
    return curateFixtureTvItems(station, exclude, count);
  }
  const results: CuratedStationItem[] = [];
  for (const [index, entry] of FIXTURE_RADIO_CATALOG.entries()) {
    if (results.length >= count) break;
    const displayTitle =
      station.seed === undefined
        ? `${entry.artist} — ${entry.title}`
        : `${station.seed} · ${entry.artist} — ${entry.title}`;
    const url =
      station.seed === undefined
        ? `https://www.youtube.com/watch?v=${entry.videoId}`
        : `https://www.youtube.com/watch?v=${entry.videoId}&seed=${encodeURIComponent(station.seed)}&n=${String(index)}`;
    const source: Source = {
      kind: "url",
      url,
      mode: "music",
      music: {
        provider: "musicbrainz",
        id: entry.id,
        title: entry.title,
        artists: [entry.artist],
        durationSeconds: entry.durationSeconds,
        canonicalUrl: `https://musicbrainz.org/recording/${entry.id}`,
      },
    };
    if (exclude.has(sourceIdentity(source))) continue;
    results.push({
      title: displayTitle,
      source,
      durationSeconds: entry.durationSeconds,
      thumbnailUrl: `https://i.ytimg.com/vi/${entry.videoId}/hqdefault.jpg`,
    });
  }
  return results;
}

export type FixtureSlotOptions = {
  readonly guildId: GuildId;
  readonly channelId: ChannelId;
  readonly resolveSource: (source: Source) => ResolvedSource;
  readonly joinVoice?: (input: {
    guildId: GuildId;
    channelId: ChannelId;
  }) => Promise<{ guildId: GuildId; channelId: ChannelId }>;
  readonly initialPosition?: number;
  readonly events?: PlaybackEvent[];
  readonly includeSubtitles?: boolean;
};

export function createFixtureSlot(options: FixtureSlotOptions) {
  let position = options.initialPosition ?? 0;
  let subtitleBusy = false;
  let refilling = false;
  const actor = createActor(
    createPlaybackMachine({
      joinVoice:
        options.joinVoice ??
        ((input) =>
          Promise.resolve({
            guildId: input.guildId,
            channelId: input.channelId,
          })),
      leaveVoice: () => Promise.resolve(),
      resolveSource: (input) =>
        Promise.resolve(options.resolveSource(input.source)),
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
    {
      input: {
        guildId: options.guildId,
        channelId: options.channelId,
        idleTimeoutMs: 60_000,
      },
    },
  );
  actor.start();

  const slot: {
    readonly actor: typeof actor;
    station: PersistedStation | undefined;
    readonly handle: SessionHandle;
    readonly startStation: (
      station: PersistedStation,
    ) => Promise<readonly CuratedStationItem[]>;
    readonly stopStation: () => PersistedStation | null;
  } = {
    actor,
    station: undefined,
    handle: EMPTY_HANDLE,
    startStation: async (nextStation) => {
      slot.station = nextStation;
      const allAdded: CuratedStationItem[] = [];
      for (let pass = 0; pass < 2; pass += 1) {
        const batch = refillSlot();
        allAdded.push(...batch);
        await Promise.resolve();
      }
      return allAdded;
    },
    stopStation: () => {
      const previous = slot.station;
      slot.station = undefined;
      if (previous === undefined) return null;
      const recent = new Set<string>(previous.recentIdentities);
      const queue = actor.getSnapshot().context.queue;
      for (let index = queue.length - 1; index >= 0; index -= 1) {
        const item = queue[index];
        if (item !== undefined && recent.has(sourceIdentity(item.source))) {
          actor.send({ type: "REMOVE", index: index + 1 });
        }
      }
      return previous;
    },
  };

  function refillSlot(): readonly CuratedStationItem[] {
    if (refilling || slot.station === undefined) return [];
    refilling = true;
    try {
      const context = actor.getSnapshot().context;
      const needed = 2 - context.queue.length;
      if (needed <= 0) return [];
      const exclude = new Set<string>([
        ...slot.station.recentIdentities,
        ...slot.station.skippedIdentities,
        ...(context.current === null
          ? []
          : [sourceIdentity(context.current.source)]),
        ...context.queue.map((entry) => sourceIdentity(entry.source)),
      ]);
      const items = curateFixtureTracks(slot.station, exclude, needed);
      for (const item of items) {
        const identity = sourceIdentity(item.source);
        slot.station = {
          ...slot.station,
          recentIdentities: appendStationRingBuffer(
            slot.station.recentIdentities,
            identity,
            MAX_STATION_RECENT_IDENTITIES,
          ),
        };
        actor.send({
          type: "ADD",
          source: item.source,
          requesterId: slot.station.ownerId,
          queuedAt: Date.now(),
          display: {
            title: item.title,
            ...(item.thumbnailUrl === undefined
              ? {}
              : { thumbnailUrl: item.thumbnailUrl }),
          },
        });
      }
      return items;
    } finally {
      refilling = false;
    }
  }

  actor.subscribe(() => {
    if (
      slot.station !== undefined &&
      actor.getSnapshot().context.queue.length < 2
    ) {
      refillSlot();
    }
  });

  const handle: SessionHandle = {
    ...EMPTY_HANDLE,
    station: () => slot.station ?? null,
    dispatch: (event) => {
      options.events?.push(event);
      if (
        event.type === "STOP" ||
        event.type === "LEAVE" ||
        event.type === "CLEAR"
      ) {
        slot.station = undefined;
      } else if (event.type === "SKIP" && slot.station !== undefined) {
        const current = actor.getSnapshot().context.current;
        if (current !== null) {
          slot.station = {
            ...slot.station,
            skippedIdentities: appendStationRingBuffer(
              slot.station.skippedIdentities,
              sourceIdentity(current.source),
              MAX_STATION_SKIPPED_IDENTITIES,
            ),
          };
        }
      }
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
    ...(options.includeSubtitles === true
      ? {
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
                kind: "sidecar" as const,
                file: "/private/arrival.en.srt",
                lang: "en",
                modifier: null,
              },
              {
                kind: "embedded" as const,
                subtitleIndex: 0,
                codec: "subrip",
                lang: "fr",
                modifier: null,
              },
            ]),
        }
      : {}),
  };

  return Object.assign(slot, { handle });
}
