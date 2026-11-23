import type { z } from "zod";
import type {
  MigrationRecordSchema,
  MigrationReportEntrySchema,
} from "#shared/migration.ts";
import { sha256 } from "#testing/fixture-api/support.ts";
import { titleNamed } from "#testing/fixture-api/fixtures/titles.ts";

export type SourceRecord = z.input<typeof MigrationRecordSchema>;
export type Entry = z.input<typeof MigrationReportEntrySchema>;

function movieRecord(sourceId: string, tmdb: number): SourceRecord {
  return {
    kind: "media",
    sourceId,
    mediaKind: "movie",
    externalIds: { tmdb },
    parentSourceId: null,
    season: null,
    episode: null,
    profileSourceId: "4",
    monitored: true,
  };
}

function fileRecord(
  sourceId: string,
  mediaSourceId: string,
  path: string,
): SourceRecord {
  return {
    kind: "file",
    sourceId,
    mediaSourceIds: [mediaSourceId],
    path,
    sizeBytes: 9_400_000_000,
    checksum: sha256(`file:${path}`),
    downloadHash: null,
    qualitySourceId: null,
  };
}

type EntryOptions = {
  mapped?: readonly { mediaId: string; title: string }[];
  confidence?: Entry["confidence"];
  state?: Entry["state"];
  reasons?: readonly string[];
};

export function entry(record: SourceRecord, options: EntryOptions = {}) {
  const targets = options.mapped ?? [];
  const provenanceKey = sha256(`provenance:${record.kind}:${record.sourceId}`);
  return {
    sourceRecord: record,
    mappedMedia: targets.map((item) => ({ ...item })),
    provenanceKey,
    sourceId: record.sourceId,
    kind: record.kind,
    observationHash: sha256(`observation:${provenanceKey}`),
    mediaIds: targets.map((item) => item.mediaId),
    confidence: options.confidence ?? "exact",
    state: options.state ?? "adoptable_evidence_ready",
    reasons: [...(options.reasons ?? [])],
    owned: false as const,
  };
}

export function mapped(name: string) {
  const title = titleNamed(name);
  return { mediaId: title.id, title: title.title };
}

/** The records of a movie library capture: each movie and the file it is in. */
export function movieEntries() {
  const movies = [
    ["Dune", 438_631, "Dune (2021)/Dune (2021) Bluray-1080p.mkv"],
    [
      "Blade Runner 2049",
      335_984,
      "Blade Runner 2049 (2017)/Blade Runner 2049 (2017) Remux-1080p.mkv",
    ],
    [
      "The Godfather",
      238,
      "The Godfather (1972)/The Godfather (1972) Bluray-1080p.mkv",
    ],
  ] as const;
  return movies.flatMap(([name, tmdb, path], index) => {
    const media = mapped(name);
    const sourceId = `movie-${String(index + 1)}`;
    return [
      entry(movieRecord(sourceId, tmdb), { mapped: [media] }),
      entry(
        fileRecord(
          `movie-file-${String(index + 1)}`,
          sourceId,
          `/movies/${path}`,
        ),
        {
          mapped: [media],
        },
      ),
    ];
  });
}

/**
 * The records of a TV capture: a series, one season, and `episodes` episodes
 * with the file each is in. More than 25 episodes make the file picker page.
 */
export function seriesEntries(episodes: number) {
  const series = mapped("The Bear");
  const seriesRecord: SourceRecord = {
    kind: "media",
    sourceId: "series-1",
    mediaKind: "series",
    externalIds: { tvdb: 403_294 },
    parentSourceId: null,
    season: null,
    episode: null,
    profileSourceId: "4",
    monitored: true,
  };
  const seasonRecord: SourceRecord = {
    ...seriesRecord,
    sourceId: "season-1",
    mediaKind: "season",
    externalIds: {},
    parentSourceId: "series-1",
    season: 1,
    profileSourceId: null,
  };
  const leaves = Array.from({ length: episodes }, (_, index) => {
    const number = index + 1;
    const record: SourceRecord = {
      ...seasonRecord,
      sourceId: `episode-${String(number)}`,
      mediaKind: "episode",
      parentSourceId: "season-1",
      episode: number,
    };
    const label = `S01E${String(number).padStart(2, "0")}`;
    return [
      entry(record, { mapped: [series] }),
      entry(
        fileRecord(
          `episode-file-${String(number)}`,
          record.sourceId,
          `/tv/The Bear/Season 01/The Bear - ${label} - WEBDL-1080p.mkv`,
        ),
        { mapped: [series] },
      ),
    ];
  }).flat();
  return [
    entry(seriesRecord, { mapped: [series] }),
    entry(seasonRecord, { mapped: [series] }),
    ...leaves,
  ];
}

/** Captured requests that cannot be tied to a household member are protected. */
export function requestEntries() {
  return [
    ["Oppenheimer", 872_585, "unmapped_requester"],
    ["The Social Network", 37_799, "requester_mapping_unverified"],
  ].map(([name, tmdb, reason], index) =>
    entry(
      {
        kind: "request",
        sourceId: `request-${String(index + 1)}`,
        requesterSourceId: `user-${String(index + 1)}`,
        plexAccountId: null,
        requesterMappingEvidenceHash: null,
        externalIds: { tmdb: Number(tmdb) },
        scope: "movie",
        seasons: [],
        active: true,
      },
      {
        mapped: [mapped(String(name))],
        state: "protected",
        reasons: [String(reason)],
        confidence: "ambiguous",
      },
    ),
  );
}

/** A sentence that explains a record the capture could not resolve. */
export function unresolved() {
  return [
    entry(
      {
        kind: "subtitle_preference",
        sourceId: "pref-1",
        mediaSourceId: "movie-1",
        languages: ["en", "zh"],
        hearingImpaired: null,
        forced: null,
      },
      {
        mapped: [mapped("Dune")],
        state: "protected_exact",
        reasons: ["generic_chinese_unresolved"],
      },
    ),
    entry(
      {
        kind: "subtitle",
        sourceId: "subtitle-1",
        mediaSourceId: "movie-1",
        path: "/movies/Dune (2021)/Dune (2021).en.srt",
        language: "en",
        checksum: sha256("subtitle-1"),
        provenance: "provider",
      },
      { mapped: [mapped("Dune")] },
    ),
    entry(
      {
        kind: "torrent",
        sourceId: "torrent-1",
        infoHash: "a".repeat(40),
        wireId: "a".repeat(40),
        infoHashV1: "a".repeat(40),
        infoHashV2: null,
        category: "movies",
        tags: [],
        savePath: "/downloads/movies",
        progress: 1,
        ratioLimit: -2,
        seedingTimeLimitMinutes: -2,
        inactiveSeedingTimeLimitMinutes: -2,
        effectiveRatioLimit: -1,
        effectiveSeedingTimeLimitMinutes: -1,
        effectiveInactiveSeedingTimeLimitMinutes: -1,
        ratio: { kind: "finite", value: 1.8 },
        seededSeconds: 200_000,
        shareLimitAction: "Default",
        automaticManagement: false,
        forceStarted: false,
        managerAssociations: [],
      },
      {
        state: "protected",
        reasons: ["torrent_is_a_legacy_source"],
        confidence: "unknown",
      },
    ),
  ];
}
