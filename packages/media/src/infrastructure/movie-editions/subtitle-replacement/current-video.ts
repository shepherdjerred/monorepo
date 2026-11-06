import type { LibraryAsset } from "#generated/prisma/client.ts";
import type { MoviePublicationAssetV2 } from "#shared/movie-editions/publication-v2.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";

type Coverage = { mediaId: string; edition: string; current: boolean };
type Video = Pick<
  LibraryAsset,
  | "id"
  | "version"
  | "edition"
  | "editionRootId"
  | "owned"
  | "ownershipEpoch"
  | "state"
  | "path"
  | "sourcePath"
  | "checksum"
  | "sizeBytes"
  | "properties"
  | "supersededByAssetId"
> & { coverage: Coverage[] };

/** This caption-only action preserves all video facts and grants no timestamp or rollback renewal. */
export function assertMovieReplacementVideoV2(
  current: Video & { coverage: Coverage[] },
  parent: MoviePublicationAssetV2,
  scope: MovieEditionScope,
) {
  if (
    identityHash(nativeJson(binding(current))) !==
      identityHash(nativeJson(binding(parent))) ||
    identityHash(parent.scope) !== identityHash(scope)
  )
    throw new Error(
      "Movie caption replacement changed its exact actual video parent",
    );
}

function binding(asset: Video | MoviePublicationAssetV2) {
  return {
    id: asset.id,
    version: asset.version,
    edition: asset.edition,
    editionRootId: asset.editionRootId,
    owned: asset.owned,
    ownershipEpoch: asset.ownershipEpoch,
    state: asset.state,
    path: asset.path,
    sourcePath: asset.sourcePath,
    checksum: asset.checksum,
    sizeBytes: asset.sizeBytes.toString(),
    properties: asset.properties,
    supersededByAssetId: asset.supersededByAssetId,
    coverage: asset.coverage.map(({ mediaId, edition, current }) => ({
      mediaId,
      edition,
      current,
    })),
  };
}
