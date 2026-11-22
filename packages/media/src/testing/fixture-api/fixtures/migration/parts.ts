import type { z } from "zod";
import type { NativeLifecycleDetailSchema } from "#shared/native-recovery/lifecycle.ts";
import type { NativeSubtitleSnapshotSchema } from "#shared/native-subtitles.ts";
import {
  HOUR,
  ahead,
  fixtureId,
  sha256,
} from "#testing/fixture-api/support.ts";
import type { NATIVE_REVIEW_STATES } from "#client/native-recovery/vocabulary.ts";
import type { Title } from "#testing/fixture-api/fixtures/titles.ts";

export type Detail = z.input<typeof NativeLifecycleDetailSchema>;
type Subtitle = z.input<typeof NativeSubtitleSnapshotSchema>;

/** The runtime a restored household reproves its files against. */
export const RUNTIME = {
  mode: "active",
  recoveryEpoch: 1,
  version: 12,
} as const;
export const RESTORE_OPERATION_ID = fixtureId(33, 1);

/** Where a prepared review stands: the states the page words, which are the server's. */
export type ReviewState = (typeof NATIVE_REVIEW_STATES)[number];

/** The fields every prepared review carries, whatever it is a review of. */
export function reviewFrame(
  id: string,
  state: ReviewState,
  seed: string,
): Pick<
  Detail,
  "id" | "state" | "version" | "plan" | "planHash" | "expiresAt" | "receiptId"
> {
  return {
    id,
    state,
    version: 4,
    plan: null,
    planHash: state === "preparing" ? null : sha256(`native-plan:${seed}`),
    expiresAt: state === "preparing" ? null : ahead(20 * HOUR),
    receiptId: state === "applied" ? fixtureId(33, 900) : null,
  };
}

export function scopeMedia(title: Title) {
  return {
    id: title.id,
    title: title.title,
    kind: "movie" as const,
    version: 3,
    tmdbId: title.tmdbId,
    externalIds: {},
    seasonNumber: null,
    episodeNumber: null,
    parent: null,
    intent: null,
    profile: null,
  };
}

function storageRoot(rootPath: "/data/movies" | "/data/tv", sequence: number) {
  return {
    rootPath,
    pvcUid: `pvc-${String(sequence)}`,
    volumeName: `volume-${String(sequence)}`,
    volumePath: `/volumes/${String(sequence)}`,
    receipt: {
      kind: "native" as const,
      id: fixtureId(33, 800 + sequence),
      planHash: sha256(`root:${rootPath}`),
    },
  };
}

/** The two approved storage roots every review checks against. */
export function storageRoots() {
  return [storageRoot("/data/movies", 1), storageRoot("/data/tv", 2)];
}

/** An installed or quarantined subtitle of a video, with provenance left out. */
export function subtitleOf(input: {
  id: string;
  assetId: string;
  path: string;
  checksum: string;
  videoChecksum: string;
  quality: Subtitle["qualityStatus"];
  hearingImpaired: boolean;
}) {
  return {
    id: input.id,
    assetId: input.assetId,
    version: 1,
    ownershipEpoch: 0,
    qualityStatus: input.quality,
    storageKind: "sidecar" as const,
    language: "en",
    providerId: "opensubtitles",
    path: input.path,
    checksum: input.checksum,
    videoChecksum: input.videoChecksum,
    videoVersion: 2,
    forced: false,
    hearingImpaired: input.hearingImpaired,
    streamIndex: null,
    codec: null,
    provenance: {},
    matchingEvidence: {},
    contentChecksum: null,
  };
}

/** The household facts every scope carries; the page never reads them. */
export function emptyHousehold() {
  return { household: {}, lifecycle: {}, torrents: [] };
}

const IDENTITY = {
  device: "2049",
  inode: "7001",
  mtimeNs: "1700000000000000000",
  ctimeNs: "1700000000000000000",
  ancestors: [{ path: "/data/movies", device: "2049", inode: "2" }],
};

/**
 * One file an upgrade replaced: the successor it published, the predecessor it
 * superseded with one installed subtitle, and where the predecessor stands on
 * disk. Used by the reviews that restore predecessors.
 */
export function publicationEntry(input: {
  namespace: number;
  index: number;
  mediaId: string;
  libraryKind: "movies" | "tv";
  oldPath: string;
  newPath: string;
  oldQuality: Subtitle["qualityStatus"];
}) {
  const successor = fixtureId(input.namespace, 100 + input.index);
  const predecessor = fixtureId(input.namespace, 200 + input.index);
  const oldChecksum = sha256(`publication-old:${input.oldPath}`);
  const root = input.libraryKind === "movies" ? "/data/movies/" : "/data/tv/";
  return {
    entry: {
      assetId: successor,
      mediaIds: [input.mediaId],
      generations: {},
      libraryKind: input.libraryKind,
      downloadPath: `/downloads/${String(input.index)}.mkv`,
      libraryPath: input.newPath,
      checksum: sha256(`publication-new:${input.newPath}`),
      sizeBytes: "21000000000",
      properties: {},
      operationId: `publish-${String(input.index + 1)}`,
      previousAssetId: predecessor,
      previousChecksum: oldChecksum,
      previousVersion: 2,
      previousSidecars: [],
      embeddedSubtitles: [],
    },
    entryHash: sha256(
      `publication-entry:${String(input.namespace)}:${String(input.index)}`,
    ),
    predecessor: {
      id: predecessor,
      version: 2,
      edition: "default" as const,
      editionRootId: input.mediaId,
      owned: true as const,
      ownershipEpoch: 0,
      state: "superseded" as const,
      path: input.oldPath,
      sourcePath: null,
      checksum: oldChecksum,
      sizeBytes: "9400000000",
      properties: {},
      supersededByAssetId: successor,
      plexPublishedAt: null,
      rollbackExpiresAt: null,
      coverage: [
        { mediaId: input.mediaId, edition: "default" as const, current: false },
      ],
      subtitles: [
        {
          ...subtitleOf({
            id: fixtureId(input.namespace, 300 + input.index),
            assetId: predecessor,
            path: input.oldPath.replace(".mkv", ".en.srt"),
            checksum: sha256(`publication-subtitle:${input.oldPath}`),
            videoChecksum: oldChecksum,
            quality: input.oldQuality,
            hearingImpaired: false,
          }),
          state: "installed" as const,
        },
      ],
      subtitleHistory: [],
    },
    originalGrant: null,
    participants: [
      {
        assetId: predecessor,
        subtitleId: null,
        libraryKind: input.libraryKind,
        role: "video" as const,
        physical: {
          state: "present" as const,
          root: "library" as const,
          path: input.oldPath.replace(root, `${input.libraryKind}/`),
          sha256: oldChecksum,
          sizeBytes: "9400000000",
          identity: IDENTITY,
        },
      },
    ],
    journals: [],
  };
}
