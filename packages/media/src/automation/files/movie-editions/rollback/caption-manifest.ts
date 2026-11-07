import path from "node:path";
import type { PublicationContext } from "#automation/publication-proof/invocation.ts";
import type { MoviePublicationAssetV2 } from "#shared/movie-editions/publication-v2.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import { NativeSubtitleSnapshotSchema } from "#shared/native-subtitles.ts";
import { MovieRollbackCaptionManifestV1Schema } from "#shared/movie-editions/rollback/captions.ts";
import type { MovieRollbackCaptionManifestV1 } from "#shared/movie-editions/rollback/captions.ts";
import { FileGuardError } from "#automation/files/types.ts";
import {
  workerFilePath,
  storedFilePath,
} from "#automation/files/paths/locations.ts";
import { observePublicationPhysicalPath } from "#automation/publication-proof/participants.ts";

/** Every admitted successor sidecar has its own real operation and absent
 * destination; future rollback commands cannot borrow an older quarantine. */
export function movieRollbackCaptionReferencesV1(
  context: PublicationContext,
  admissionId: string,
  successor: MoviePublicationAssetV2,
) {
  return successor.subtitles
    .filter((row) => row.storageKind === "sidecar")
    .map((raw, index) => {
      const snapshot = NativeSubtitleSnapshotSchema.parse(raw);
      if (snapshot.path === null || snapshot.checksum === null)
        throw new FileGuardError("movie_rollback_successor_caption_unowned");
      const source = path.relative(
        context.roots.movies.library,
        workerFilePath(context, snapshot.path),
      );
      if (
        source === "" ||
        source === ".." ||
        source.startsWith(`..${path.sep}`) ||
        path.isAbsolute(source) ||
        storedFilePath(context, "movies", "library", source) !== snapshot.path
      )
        throw new FileGuardError(
          "movie_rollback_successor_caption_path_changed",
        );
      const operationId = `rollback-caption-${admissionId}-${String(index)}`;
      return {
        snapshot,
        operationId,
        source,
        target: `quarantine/${operationId}`,
      };
    });
}

/** Called only within the admission's complete native path-lock callback,
 * after the exact owner/SQL pair has been recaptured under producer locks. */
export async function captureMovieRollbackCaptionManifestV1(
  context: PublicationContext,
  input: {
    admissionId: string;
    scope: MovieEditionScope;
    successor: MoviePublicationAssetV2;
    parents: ReadonlyMap<
      string,
      MovieRollbackCaptionManifestV1["captions"][number]["parent"]
    >;
  },
) {
  const captions = [];
  for (const selected of movieRollbackCaptionReferencesV1(
    context,
    input.admissionId,
    input.successor,
  )) {
    const parent = input.parents.get(selected.snapshot.id);
    if (parent === undefined)
      throw new FileGuardError(
        "movie_rollback_successor_caption_parent_missing",
      );
    const source = await observePublicationPhysicalPath(context, {
      libraryKind: "movies",
      root: "library",
      path: selected.source,
    });
    const target = await observePublicationPhysicalPath(context, {
      libraryKind: "movies",
      root: "control",
      path: selected.target,
    });
    if (
      source.state !== "present" ||
      source.sha256 !== selected.snapshot.checksum ||
      target.state !== "absent"
    )
      throw new FileGuardError(
        "movie_rollback_successor_caption_identity_changed",
      );
    captions.push({
      operationId: selected.operationId,
      snapshot: selected.snapshot,
      parent,
      source,
      target,
      storedTargetPath: storedFilePath(
        context,
        "movies",
        "control",
        selected.target,
      ),
      workerSourcePath: path.join(
        context.roots.movies.library,
        selected.source,
      ),
      workerTargetPath: path.join(
        context.roots.movies.control,
        selected.target,
      ),
    });
  }
  return MovieRollbackCaptionManifestV1Schema.parse({
    schemaVersion: 1,
    admissionId: input.admissionId,
    scope: input.scope,
    assetId: input.successor.id,
    assetVersion: input.successor.version,
    assetChecksum: input.successor.checksum,
    ownershipEpoch: input.successor.ownershipEpoch,
    captions,
  });
}
