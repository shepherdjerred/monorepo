import type { Availability, MediaItem } from "#shared/contract.ts";
import {
  NOW,
  fixtureId,
  parseFixtureId,
  versionOf,
} from "#testing/fixture-api/support.ts";

/**
 * The household library: sixty titles covering every availability state, with
 * production-like spread (long titles, several languages, long-running series).
 */
export type Title = {
  id: string;
  index: number;
  kind: "movie" | "series";
  title: string;
  year: number;
  availability: Availability;
  tmdbId: number;
  language: string;
  /** Episode count per season; empty for a movie. */
  seasons: readonly number[];
};

type MovieSeed = readonly [
  title: string,
  year: number,
  availability: Availability,
  tmdbId: number,
  language: string,
];
type SeriesSeed = readonly [...MovieSeed, seasons: readonly number[]];

const MOVIES: readonly MovieSeed[] = [
  ["Dune: Part Two", 2024, "available", 693_134, "en"],
  ["Anora", 2024, "searching", 1_064_213, "en"],
  ["Dune", 2021, "available", 438_631, "en"],
  ["Oppenheimer", 2023, "wanted", 872_585, "en"],
  ["Blade Runner 2049", 2017, "available", 335_984, "en"],
  ["Blade Runner", 1982, "available", 78, "en"],
  ["The Godfather", 1972, "available", 238, "en"],
  ["Parasite", 2019, "available", 496_243, "ko"],
  ["Spirited Away", 2001, "available", 129, "ja"],
  ["Everything Everywhere All at Once", 2022, "available", 545_611, "en"],
  ["Mad Max: Fury Road", 2015, "available", 76_341, "en"],
  ["The Grand Budapest Hotel", 2014, "available", 120_467, "en"],
  ["Interstellar", 2014, "available", 157_336, "en"],
  ["Arrival", 2016, "downloading", 329_865, "en"],
  [
    "The Lord of the Rings: The Fellowship of the Ring",
    2001,
    "available",
    120,
    "en",
  ],
  ["The Matrix", 1999, "available", 603, "en"],
  ["Alien", 1979, "available", 348, "en"],
  ["Past Lives", 2023, "available", 666_277, "en"],
  ["The Holdovers", 2023, "quarantined", 840_430, "en"],
  ["Poor Things", 2023, "available", 792_307, "en"],
  ["Anatomy of a Fall", 2023, "importing", 915_935, "fr"],
  ["Spider-Man: Across the Spider-Verse", 2023, "available", 569_094, "en"],
  ["Top Gun: Maverick", 2022, "available", 361_743, "en"],
  ["Knives Out", 2019, "available", 546_554, "en"],
  ["Get Out", 2017, "available", 419_430, "en"],
  ["Moonlight", 2016, "removed", 376_867, "en"],
  ["Whiplash", 2014, "available", 244_786, "en"],
  ["In the Mood for Love", 2000, "available", 843, "cn"],
  ["Your Name.", 2016, "available", 372_058, "ja"],
  ["Princess Mononoke", 1997, "validating", 128, "ja"],
  ["Heat", 1995, "available", 949, "en"],
  ["The Thing", 1982, "available", 1091, "en"],
  ["No Country for Old Men", 2007, "available", 6977, "en"],
  ["There Will Be Blood", 2007, "available", 7345, "en"],
  ["The Social Network", 2010, "wanted", 37_799, "en"],
  ["Portrait of a Lady on Fire", 2019, "available", 531_428, "fr"],
];
const SERIES: readonly SeriesSeed[] = [
  ["Severance", 2022, "downloading", 95_396, "en", [9, 10]],
  ["The Bear", 2022, "available", 136_315, "en", [8, 10, 10, 10]],
  ["Shōgun", 2024, "available", 126_308, "en", [10]],
  ["Andor", 2022, "importing", 83_867, "en", [12, 12]],
  ["Succession", 2018, "available", 76_331, "en", [10, 10, 9, 10]],
  ["Breaking Bad", 2008, "available", 1396, "en", [7, 13, 13, 13, 16]],
  [
    "Better Call Saul",
    2015,
    "available",
    60_059,
    "en",
    [10, 10, 10, 10, 10, 13],
  ],
  ["The Wire", 2002, "available", 1438, "en", [13, 12, 12, 13, 10]],
  ["Chernobyl", 2019, "available", 87_108, "en", [5]],
  ["Fleabag", 2016, "available", 67_070, "en", [6, 6]],
  ["Slow Horses", 2022, "searching", 95_480, "en", [6, 6, 6, 6, 6, 6]],
  ["The Last of Us", 2023, "validating", 100_088, "en", [9, 7]],
  ["Frieren: Beyond Journey's End", 2023, "wanted", 209_867, "ja", [28, 12]],
  ["Attack on Titan", 2013, "available", 1429, "ja", [25, 12, 22, 30]],
  ["Cowboy Bebop", 1998, "available", 30_991, "ja", [26]],
  ["Bluey", 2018, "available", 82_728, "en", [52, 52, 50]],
  ["Ted Lasso", 2020, "downloading", 97_546, "en", [10, 12, 12]],
  ["Hacks", 2021, "available", 105_248, "en", [10, 8, 9, 10]],
  ["Dark", 2017, "wanted", 70_523, "de", [10, 8, 8]],
  ["Arcane", 2021, "available", 94_605, "en", [9, 9]],
  ["The Expanse", 2015, "available", 63_639, "en", [10, 13, 13, 10, 10, 6]],
  ["Mr. Robot", 2015, "available", 62_560, "en", [10, 12, 10, 13]],
  ["Twin Peaks", 1990, "removed", 1920, "en", [8, 22, 18]],
  ["Silo", 2023, "quarantined", 125_988, "en", [10, 10, 10]],
];

export const TITLES: readonly Title[] = [
  ...MOVIES.map(([title, year, availability, tmdbId, language]) => ({
    kind: "movie" as const,
    title,
    year,
    availability,
    tmdbId,
    language,
    seasons: [],
  })),
  ...SERIES.map(([title, year, availability, tmdbId, language, seasons]) => ({
    kind: "series" as const,
    title,
    year,
    availability,
    tmdbId,
    language,
    seasons,
  })),
].map((title, index) => ({ ...title, index, id: fixtureId(2, index + 1) }));

export function titleNamed(name: string): Title {
  const found = TITLES.find((title) => title.title === name);
  if (found === undefined) {
    throw new Error(`Unknown fixture title ${name}`);
  }
  return found;
}

/** Titles whose pages carry the richest state; browser tests open these. */
export const FEATURED = {
  /** Available movie with an upgrade in flight, a pin, and caption gaps. */
  movie: titleNamed("Dune: Part Two"),
  /** Requested movie that has only failed and cancelled attempts. */
  searchingMovie: titleNamed("Anora"),
  quarantinedMovie: titleNamed("The Holdovers"),
  /** Series mid-download: a finished season and an airing one. */
  series: titleNamed("Severance"),
  /** A title the viewer may protect but not inspect. */
  protectionOnly: titleNamed("Bluey"),
  /** Anime with absolute numbering to review. */
  numbering: titleNamed("Frieren: Beyond Journey's End"),
} as const;

/**
 * Titles the owner holds for good. The featured movie is one the owner also
 * follows; the other two are held and nothing else.
 */
const OWNER_KEPT: ReadonlySet<string> = new Set(
  [FEATURED.movie, titleNamed("Dune"), titleNamed("Breaking Bad")].map(
    (title) => title.id,
  ),
);

export function ownerKeeps(title: Title): boolean {
  return OWNER_KEPT.has(title.id);
}

export function seasonId(title: Title, season: number): string {
  return fixtureId(3, title.index * 100 + season);
}

export function episodeId(
  title: Title,
  season: number,
  episode: number,
): string {
  return fixtureId(4, title.index * 10_000 + season * 100 + episode);
}

type Airing = {
  series: string;
  season: number;
  firstEpisode: number;
  /** Day of the current month the first listed episode airs; then weekly. */
  startDay: number;
  episodes: readonly string[];
};

/** Episodes airing this month. The calendar and the episode pages share them. */
export const AIRINGS: readonly Airing[] = [
  {
    series: "Slow Horses",
    season: 6,
    firstEpisode: 3,
    startDay: 4,
    episodes: ["Tall Tales", "Missiles", "Circus", "Scars"],
  },
  {
    series: "The Bear",
    season: 4,
    firstEpisode: 7,
    startDay: 1,
    episodes: ["Bears", "Green", "Tonnato", "Goodbye"],
  },
  {
    series: "Frieren: Beyond Journey's End",
    season: 2,
    firstEpisode: 5,
    startDay: 6,
    episodes: [
      "The Northern Lands",
      "Flowers",
      "The Hero's Party",
      "A Long Rest",
    ],
  },
  {
    series: "Silo",
    season: 3,
    firstEpisode: 1,
    startDay: 13,
    episodes: ["The Engineer", "Order", "Solo"],
  },
  {
    series: "Hacks",
    season: 4,
    firstEpisode: 9,
    startDay: 5,
    episodes: ["Heaven", "The Roast of Deborah Vance"],
  },
  {
    series: "Ted Lasso",
    season: 3,
    firstEpisode: 11,
    startDay: 3,
    episodes: ["Mom City", "So Long, Farewell"],
  },
  {
    series: "Severance",
    season: 2,
    firstEpisode: 9,
    startDay: 12,
    episodes: ["The After Hours", "Cold Harbor"],
  },
];

export type AiringEpisode = {
  title: Title;
  season: number;
  episode: number;
  name: string;
  /** Day of the current month. */
  day: number;
  availability: Availability;
};

const TODAY = new Date(NOW).getDate();
/** Every month has a 28th, so the schedule never spills into the next one. */
const LAST_SCHEDULED_DAY = 28;

function airingAvailability(day: number): Availability {
  if (day < TODAY) {
    return "available";
  }
  return day === TODAY ? "downloading" : "wanted";
}

export const AIRING_EPISODES: readonly AiringEpisode[] = AIRINGS.flatMap(
  (airing) => {
    const title = titleNamed(airing.series);
    return airing.episodes.flatMap((name, offset) => {
      const day = airing.startDay + offset * 7;
      return day > LAST_SCHEDULED_DAY
        ? []
        : [
            {
              title,
              season: airing.season,
              episode: airing.firstEpisode + offset,
              name,
              day,
              availability: airingAvailability(day),
            },
          ];
    });
  },
);

type EpisodeOverride = { title: string; availability: Availability };

const SEVERANCE_SEASON_TWO: readonly EpisodeOverride[] = [
  { title: "Hello, Ms. Cobel", availability: "available" },
  { title: "Goodbye, Mrs. Selvig", availability: "available" },
  { title: "Who Is Alive?", availability: "available" },
  { title: "Woe's Hollow", availability: "available" },
  { title: "Trojan's Horse", availability: "available" },
  { title: "Attila", availability: "available" },
  { title: "Chikhai Bardo", availability: "importing" },
  { title: "Sweet Vitriol", availability: "downloading" },
  { title: "The After Hours", availability: "searching" },
  { title: "Cold Harbor", availability: "wanted" },
];

const EPISODE_OVERRIDES = new Map<string, EpisodeOverride>([
  ...SEVERANCE_SEASON_TWO.map((override, index): [string, EpisodeOverride] => [
    episodeId(FEATURED.series, 2, index + 1),
    override,
  ]),
  // An airing date decides availability, so it wins over the static list.
  ...AIRING_EPISODES.map((airing): [string, EpisodeOverride] => [
    episodeId(airing.title, airing.season, airing.episode),
    { title: airing.name, availability: airing.availability },
  ]),
]);

export function titleItem(title: Title): MediaItem {
  return {
    id: title.id,
    kind: title.kind,
    title: title.title,
    year: title.year,
    parentId: null,
    seasonNumber: null,
    episodeNumber: null,
    availability: title.availability,
    catalogState: title === FEATURED.numbering ? "pending" : "ready",
    version: versionOf(title.id),
  };
}

function seasonAvailability(title: Title, season: number): Availability {
  if (title === FEATURED.series) {
    return season === 1 ? "available" : "downloading";
  }
  if (season === title.seasons.length) {
    return title.availability;
  }
  return title.availability === "wanted" || title.availability === "searching"
    ? title.availability
    : "available";
}

export function seasonItem(title: Title, season: number): MediaItem {
  const id = seasonId(title, season);
  return {
    id,
    kind: "season",
    title: `Season ${String(season)}`,
    year: title.year + Math.max(0, season - 1),
    parentId: title.id,
    seasonNumber: season,
    episodeNumber: null,
    availability: seasonAvailability(title, season),
    catalogState: "ready",
    version: versionOf(id),
  };
}

export function episodeItem(
  title: Title,
  season: number,
  episode: number,
): MediaItem {
  const id = episodeId(title, season, episode);
  const override = EPISODE_OVERRIDES.get(id);
  return {
    id,
    kind: "episode",
    title: override?.title ?? `Episode ${String(episode)}`,
    year: title.year + Math.max(0, season - 1),
    parentId: seasonId(title, season),
    seasonNumber: season,
    episodeNumber: episode,
    availability: override?.availability ?? seasonAvailability(title, season),
    catalogState: "ready",
    version: versionOf(id),
  };
}

/** A media item with the title it belongs to and its direct children. */
export type ResolvedMedia = {
  item: MediaItem;
  title: Title;
  children: MediaItem[];
};

function resolveSeason(sequence: number): ResolvedMedia | null {
  const title = TITLES[Math.floor(sequence / 100)];
  const season = sequence % 100;
  const episodes = title?.seasons[season - 1];
  if (title === undefined || episodes === undefined) {
    return null;
  }
  return {
    item: seasonItem(title, season),
    title,
    children: Array.from({ length: episodes }, (_, index) =>
      episodeItem(title, season, index + 1),
    ),
  };
}

function resolveEpisode(sequence: number): ResolvedMedia | null {
  const title = TITLES[Math.floor(sequence / 10_000)];
  const season = Math.floor((sequence % 10_000) / 100);
  const episode = sequence % 100;
  const episodes = title?.seasons[season - 1];
  const exists =
    title !== undefined &&
    episodes !== undefined &&
    episode >= 1 &&
    episode <= episodes;
  return exists
    ? { item: episodeItem(title, season, episode), title, children: [] }
    : null;
}

function resolveTitle(sequence: number): ResolvedMedia | null {
  const title = TITLES[sequence - 1];
  return title === undefined
    ? null
    : {
        item: titleItem(title),
        title,
        children: title.seasons.map((_, index) => seasonItem(title, index + 1)),
      };
}

/** Find a title, season, or episode by identifier; null when none exists. */
export function resolveMedia(id: string): ResolvedMedia | null {
  const parsed = parseFixtureId(id);
  if (parsed === null) {
    return null;
  }
  switch (parsed.namespace) {
    case 2:
      return resolveTitle(parsed.sequence);
    case 3:
      return resolveSeason(parsed.sequence);
    case 4:
      return resolveEpisode(parsed.sequence);
    default:
      return null;
  }
}

export function resolveMovie(id: string): ResolvedMedia | null {
  const resolved = resolveMedia(id);
  return resolved?.item.kind === "movie" ? resolved : null;
}
