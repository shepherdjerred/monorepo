import type { z } from "zod";
import {
  PlaybackDecisionSchema,
  PlaybackQuerySchema,
  type NowPlayingSchema,
  type PlaybackHistorySchema,
  type PlaybackPeopleSchema,
  type PlaybackSessionViewSchema,
  type PlaybackStatisticsSchema,
} from "#shared/household/playback.ts";
import {
  HOUSEHOLD,
  KIDS,
  MEMBER,
  personaUser,
  type Persona,
} from "#testing/fixture-api/personas.ts";
import {
  HOUR,
  MINUTE,
  NOW,
  ago,
  fixtureId,
  pick,
} from "#testing/fixture-api/support.ts";
import { mediaReference } from "./artwork.ts";
import { TITLES, episodeItem, titleItem } from "./titles.ts";

type Session = z.input<typeof PlaybackSessionViewSchema>;
type History = z.input<typeof PlaybackHistorySchema>;
type Statistics = z.input<typeof PlaybackStatisticsSchema>;
type Ranking = Statistics["topTitles"][number];
type People = z.input<typeof PlaybackPeopleSchema>;
type NowPlaying = z.input<typeof NowPlayingSchema>;

/** An owner sees the whole household; a member sees only their own plays. */
export function playbackPeople(persona: Persona): People {
  const visible = persona === "owner" ? HOUSEHOLD : [MEMBER];
  return visible.map((user) => ({
    id: user.id,
    displayName: user.displayName,
  }));
}

type Watchable = readonly [
  title: string,
  seriesTitle: string | null,
  mediaType: "movie" | "episode",
  minutes: number,
];

const WATCHABLE: readonly Watchable[] = [
  ["Cold Harbor", "Severance", "episode", 76],
  ["Dune: Part Two", null, "movie", 166],
  ["Sleepytime", "Bluey", "episode", 7],
  ["Forks", "The Bear", "episode", 35],
  ["Crimson Sky", "Shōgun", "episode", 70],
  ["Oppenheimer", null, "movie", 180],
  ["The Dirt Under Your Nails", "Arcane", "episode", 50],
  ["Ozymandias", "Breaking Bad", "episode", 47],
  ["Spirited Away", null, "movie", 125],
  ["Connor's Wedding", "Succession", "episode", 62],
  ["Past Lives", null, "movie", 106],
  ["One Way Out", "Andor", "episode", 48],
  ["Long, Long Time", "The Last of Us", "episode", 76],
  ["The Grand Budapest Hotel", null, "movie", 100],
  ["Whiplash", null, "movie", 107],
  ["Baby Race", "Bluey", "episode", 7],
  ["Vichnaya Pamyat", "Chernobyl", "episode", 65],
  ["Mad Max: Fury Road", null, "movie", 120],
  ["Review", "The Bear", "episode", 21],
  ["Parasite", null, "movie", 133],
];

/**
 * The library title a play links to: the movie itself, or an episode of the
 * series. Null when the household holds no title by that name.
 */
function playedMedia(
  name: string,
  seriesTitle: string | null,
  sequence: number,
): Session["media"] {
  const title = TITLES.find(
    (candidate) => candidate.title === (seriesTitle ?? name),
  );
  if (title === undefined) {
    return null;
  }
  const [firstSeason] = title.seasons;
  return mediaReference(
    title,
    firstSeason === undefined
      ? titleItem(title)
      : episodeItem(title, 1, (sequence % firstSeason) + 1),
  );
}

const PLATFORMS = [
  "Apple TV",
  "LG webOS",
  "Chrome",
  "iOS",
  "Android TV",
  "Roku",
  "Plex for Mac",
];
const DECISIONS = [
  "direct_play",
  "direct_play",
  "direct_stream",
  "transcode",
  "direct_play",
  "unknown",
] as const;
/** Fraction of the runtime watched; anything from 85% counts as completed. */
const WATCHED_FRACTIONS = [1, 0.97, 0.34, 1, 0.92, 0.12, 1, 0.61];
const COMPLETION_FRACTION = 0.85;
const HISTORY_ROWS = 64;

function historyRow(index: number, persona: Persona): Session {
  const [title, seriesTitle, mediaType, minutes] = pick(
    WATCHABLE,
    index * 7 + (index % 3),
  );
  const person =
    persona === "owner" ? pick(HOUSEHOLD, index * 3 + (index % 2)) : MEMBER;
  const durationMs = minutes * MINUTE;
  const fraction = pick(WATCHED_FRACTIONS, index);
  const watchedMs = Math.round(durationMs * fraction);
  const started = NOW - (index * 9 + 3) * HOUR - (index % 5) * 17 * MINUTE;
  const stopped = new Date(started + watchedMs + 4 * MINUTE).toISOString();
  // A few Plex accounts are not mapped to a household member yet.
  const unmapped = persona === "owner" && index % 19 === 7;
  return {
    id: fixtureId(10, index + 1),
    title,
    seriesTitle,
    mediaType,
    userId: unmapped ? null : person.id,
    userName: unmapped ? null : person.displayName,
    platform: pick(PLATFORMS, index * 5 + 1),
    decision: pick(DECISIONS, index),
    startedAt: new Date(started).toISOString(),
    stoppedAt: stopped,
    lastSeenAt: stopped,
    durationMs,
    watchedMs,
    progressMs: watchedMs,
    completed: fraction >= COMPLETION_FRACTION,
    state: "stopped",
    // Older rows were imported from the previous history tool.
    source: index > 40 ? "tautulli" : "plex",
    // Some imported plays predate the Plex item the title has today.
    media:
      index > 40 && index % 3 === 0
        ? null
        : playedMedia(title, seriesTitle, index),
  };
}

function matchingRows(parameters: URLSearchParams, persona: Persona) {
  const query = PlaybackQuerySchema.parse(Object.fromEntries(parameters));
  const search = (query.search ?? "").toLowerCase();
  const rows = Array.from({ length: HISTORY_ROWS }, (_, index) =>
    historyRow(index, persona),
  ).filter(
    (row) =>
      `${row.seriesTitle ?? ""} ${row.title}`.toLowerCase().includes(search) &&
      (query.userId === undefined || row.userId === query.userId) &&
      (query.from === undefined || row.startedAt >= query.from) &&
      (query.to === undefined || row.startedAt < query.to),
  );
  return { rows, cursor: query.cursor ?? null, limit: query.limit };
}

export function playbackHistory(
  parameters: URLSearchParams,
  persona: Persona,
): History {
  const { rows, cursor, limit } = matchingRows(parameters, persona);
  let start = 0;
  if (cursor !== null) {
    const position = rows.findIndex((row) => row.id === cursor);
    if (position === -1) {
      throw new Error(`Playback cursor names an unknown play ${cursor}`);
    }
    start = position + 1;
  }
  const items = rows.slice(start, start + limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor:
      last !== undefined && start + limit < rows.length ? last.id : null,
  };
}

/** The visible history is one page of a much longer one; totals reflect that. */
const VOLUME = 23;

function ranking(
  rows: readonly Session[],
  label: (row: Session) => string,
): Ranking[] {
  const groups = new Map<string, Ranking>();
  for (const row of rows) {
    const key = label(row);
    const group = groups.get(key) ?? { label: key, plays: 0, watchedMs: 0 };
    groups.set(key, {
      label: key,
      plays: group.plays + VOLUME,
      watchedMs: group.watchedMs + row.watchedMs * VOLUME,
    });
  }
  return [...groups.values()]
    .sort(
      (left, right) =>
        right.plays - left.plays || right.watchedMs - left.watchedMs,
    )
    .slice(0, 8);
}

export function playbackStatistics(
  parameters: URLSearchParams,
  persona: Persona,
): Statistics {
  const minimumPlayMs = 120_000;
  const rows = matchingRows(parameters, persona).rows.filter(
    (row) => row.watchedMs >= minimumPlayMs,
  );
  return {
    plays: rows.length * VOLUME,
    watchedMs: rows.reduce((sum, row) => sum + row.watchedMs, 0) * VOLUME,
    completedPlays: rows.filter((row) => row.completed).length * VOLUME,
    topTitles: ranking(rows, (row) => row.seriesTitle ?? row.title),
    topUsers: ranking(rows, (row) => row.userName ?? "Unmapped account"),
    topPlatforms: ranking(rows, (row) => row.platform),
    decisions: PlaybackDecisionSchema.options.map((decision) => ({
      decision,
      plays: rows.filter((row) => row.decision === decision).length * VOLUME,
    })),
    minimumPlayMs,
    completionPercent: 85,
  };
}

function liveSession(
  sequence: number,
  session: Pick<
    Session,
    "title" | "seriesTitle" | "mediaType" | "userId" | "userName"
  > &
    Pick<Session, "platform" | "decision" | "state"> & {
      startedMinutesAgo: number;
      runtimeMinutes: number;
    },
): Session {
  const { startedMinutesAgo, runtimeMinutes, ...view } = session;
  const watchedMs = Math.round(startedMinutesAgo * 0.9) * MINUTE;
  return {
    ...view,
    id: fixtureId(10, sequence),
    startedAt: ago(startedMinutesAgo * MINUTE),
    stoppedAt: null,
    lastSeenAt: ago(20_000),
    durationMs: runtimeMinutes * MINUTE,
    watchedMs,
    progressMs: watchedMs + MINUTE,
    completed: false,
    source: "plex",
    media: playedMedia(view.title, view.seriesTitle, sequence),
  };
}

/** One stream for the viewer; the owner also sees a paused transcode. */
export function nowPlaying(persona: Persona): NowPlaying {
  const user = personaUser(persona);
  return {
    observedAt: ago(20_000),
    stale: false,
    items: [
      liveSession(9001, {
        title: "Chikhai Bardo",
        seriesTitle: "Severance",
        mediaType: "episode",
        userId: user.id,
        userName: user.displayName,
        platform: "Apple TV",
        decision: "direct_play",
        state: "playing",
        startedMinutesAgo: 31,
        runtimeMinutes: 51,
      }),
      ...(persona === "owner"
        ? [
            liveSession(9002, {
              title: "Spirited Away",
              seriesTitle: null,
              mediaType: "movie",
              userId: KIDS.id,
              userName: KIDS.displayName,
              platform: "LG webOS",
              decision: "transcode",
              state: "paused",
              startedMinutesAgo: 74,
              runtimeMinutes: 125,
            }),
          ]
        : []),
    ],
  };
}
