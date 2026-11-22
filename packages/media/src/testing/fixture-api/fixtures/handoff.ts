import type { z } from "zod";
import type { HandoffPlanDetailSchema } from "#client/library-import/plan-detail.ts";
import type {
  LibraryHandoffScopeV3Schema,
  FinishedLibraryHandoffV3Schema,
} from "#shared/handoff/library-v3.ts";
import { PROFILE_IDS } from "#testing/fixture-api/fixtures/profiles.ts";
import {
  HOUR,
  ago,
  ahead,
  fixtureId,
  sha256,
} from "#testing/fixture-api/support.ts";
import { BUNDLE_IDS, CAPTURES } from "./migration.ts";
import { movieEntries, seriesEntries } from "./migration-entries.ts";
import { titleNamed } from "./titles.ts";

type HandoffDetail = z.input<typeof HandoffPlanDetailSchema>;
type HandoffScope = z.input<typeof LibraryHandoffScopeV3Schema>;
type FinishedPlan = z.input<typeof FinishedLibraryHandoffV3Schema>;

/** A review of a plan that has been prepared, by what the page shows of it. */
export const HANDOFF_IDS = {
  awaitingReview: fixtureId(32, 1),
  preparing: fixtureId(32, 2),
  applying: fixtureId(32, 3),
  applied: fixtureId(32, 4),
  expired: fixtureId(32, 5),
  cancelled: fixtureId(32, 6),
} as const;

type HandoffSeed = {
  state: HandoffDetail["state"];
  plan: boolean;
  expiresInHours: number | null;
  receipt: boolean;
};

const HANDOFFS: Readonly<Record<string, HandoffSeed>> = {
  [HANDOFF_IDS.awaitingReview]: {
    state: "awaiting_review",
    plan: true,
    expiresInHours: 20,
    receipt: false,
  },
  [HANDOFF_IDS.preparing]: {
    state: "preparing",
    plan: false,
    expiresInHours: null,
    receipt: false,
  },
  [HANDOFF_IDS.applying]: {
    state: "applying",
    plan: true,
    expiresInHours: 20,
    receipt: false,
  },
  [HANDOFF_IDS.applied]: {
    state: "applied",
    plan: true,
    expiresInHours: 20,
    receipt: true,
  },
  [HANDOFF_IDS.expired]: {
    state: "awaiting_review",
    plan: true,
    expiresInHours: -3,
    receipt: false,
  },
  [HANDOFF_IDS.cancelled]: {
    state: "cancelled",
    plan: false,
    expiresInHours: null,
    receipt: false,
  },
};

function handoffScope(): HandoffScope {
  const movie = titleNamed("Dune");
  const series = titleNamed("The Bear");
  const movieEntry = movieEntries()[1];
  const episodeEntry = seriesEntries(2)[3];
  if (movieEntry === undefined || episodeEntry === undefined) {
    throw new Error("The migration fixtures lost a record");
  }
  const file = (
    sequence: number,
    mediaId: string,
    path: string,
    libraryKind: "movies" | "tv",
  ) => ({
    provenanceKey: sha256(`handoff-file-${String(sequence)}`),
    captureId: CAPTURES.radarr.captureId,
    mediaIds: [mediaId],
    sourcePath: path,
    canonicalPath: path
      .replace("/movies", "/data/movies")
      .replace("/tv", "/data/tv"),
    libraryKind,
    sizeBytes: "9400000000",
    capturedChecksum: sha256(`file:${path}`),
    qualitySourceId: null,
    existingAssetId: null,
    existingAssetVersion: null,
    assetId: fixtureId(32, 100 + sequence),
  });
  const movieFile = file(
    1,
    movie.id,
    "/movies/Dune (2021)/Dune (2021) Bluray-1080p.mkv",
    "movies",
  );
  const tvFile = file(
    2,
    series.id,
    "/tv/The Bear/Season 01/The Bear - S01E01 - WEBDL-1080p.mkv",
    "tv",
  );
  return {
    schemaVersion: 3,
    request: {
      schemaVersion: 3,
      bundleReviewId: BUNDLE_IDS.approved,
      bundleReviewVersion: 4,
      bundleHash: sha256(`bundle-manifest:${BUNDLE_IDS.approved}`),
      reportHash: sha256("bundle-4"),
      recoveryEpoch: 1,
      runtimeVersion: 12,
      purpose: "migration",
      activation: "extend",
      plexEditionLabels: "update_in_place",
      selected: [
        {
          provenanceKey: movieEntry.provenanceKey,
          evidenceHash: movieEntry.observationHash,
        },
        {
          provenanceKey: episodeEntry.provenanceKey,
          evidenceHash: episodeEntry.observationHash,
        },
      ],
      subtitlePolicies: [],
      profiles: [
        {
          captureId: CAPTURES.radarr.captureId,
          sourceProfileId: "4",
          profileId: PROFILE_IDS.captured,
          version: 1,
          snapshotHash: sha256("radarr-snapshot"),
        },
      ],
      movies: [
        {
          provenanceKey: movieFile.provenanceKey,
          edition: "directors_cut",
          resolution: {
            kind: "owner_review",
            reason: "Filename names the Director's Cut",
          },
        },
      ],
      seriesMonitoring: [
        {
          schemaVersion: 1,
          seriesId: series.id,
          title: series.title,
          provenanceKey: sha256("series-monitoring"),
          includeFutureEpisodes: true,
          includeSpecials: false,
        },
      ],
    },
    media: [
      {
        mediaId: movie.id,
        version: 3,
        generation: null,
        profileId: PROFILE_IDS.captured,
        profileVersion: 1,
        monitored: true,
      },
      {
        mediaId: series.id,
        version: 2,
        generation: null,
        profileId: null,
        profileVersion: null,
        monitored: true,
      },
    ],
    claims: [],
    files: [
      {
        ...movieFile,
        edition: "directors_cut",
        classification: {
          schemaVersion: 1,
          parserVersion: "cut-markers-v2",
          provenanceKey: movieFile.provenanceKey,
          observationHash: sha256("classification-observation"),
          canonicalDigest: sha256("classification-canonical"),
          texts: [],
          issues: [],
          conclusion: { kind: "named", cut: "directors_cut" },
          resolution: {
            kind: "owner_review",
            reason: "Filename names the Director's Cut",
          },
          definition: {
            definitionVersion: 0,
            definitionDigest: sha256("definition-directors-cut"),
          },
        },
      },
      { ...tvFile, edition: "default", classification: null },
    ],
    subtitles: [],
    subtitlePolicies: [],
    protected: [
      {
        provenanceKey: sha256("protected-torrent"),
        reason: "torrent_is_a_legacy_source",
      },
    ],
    targets: [],
  };
}

function finishedPlan(): FinishedPlan {
  const movie = titleNamed("Dune");
  const asset = fixtureId(32, 101);
  return {
    schemaVersion: 3,
    scopeHash: sha256("handoff-scope"),
    network: {},
    files: {},
    plexEdits: [
      {
        schemaVersion: 1,
        assetId: asset,
        scope: {
          rootMediaId: movie.id,
          mediaId: movie.id,
          edition: "directors_cut",
        },
        identity: {
          serverMachineId: "fixture-plex",
          sectionId: "1",
          ratingKey: "4210",
          mediaId: movie.id,
          partId: 1,
          canonicalPath:
            "/data/movies/Dune (2021)/Dune (2021) Bluray-1080p.mkv",
          sizeBytes: "9400000000",
          title: movie.title,
          year: movie.year,
          guid: null,
          guids: ["tmdb://438631"],
        },
        identityHash: sha256("plex-identity"),
        beforeEditionTitle: null,
        targetEditionTitle: "Director's Cut",
      },
    ],
  };
}

/** A plan for the owner to review, or the state one is in while it is not ready. */
export function handoffDetail(id: string): HandoffDetail | null {
  const seed = HANDOFFS[id];
  if (seed === undefined) return null;
  const hours = seed.expiresInHours;
  return {
    id,
    state: seed.state,
    version: 3,
    scope: handoffScope(),
    plan: seed.plan ? finishedPlan() : null,
    planHash: seed.plan ? sha256(`plan:${id}`) : null,
    expiresAt:
      hours === null
        ? null
        : hours >= 0
          ? ahead(hours * HOUR)
          : ago(-hours * HOUR),
    receiptId: seed.receipt ? fixtureId(32, 900) : null,
  };
}
