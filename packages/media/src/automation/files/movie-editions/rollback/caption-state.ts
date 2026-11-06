import path from "node:path";
import type { PublicationContext } from "#automation/publication-proof/invocation.ts";
import { PublicationEffectState } from "#automation/publication-proof/effect-state.ts";
import type { PublicationStep } from "#automation/publication-proof/steps.ts";
import { MovieRollbackCaptionIORefV1Schema } from "#shared/movie-editions/rollback/caption-io.ts";
import type { MovieRollbackIntentV1 } from "#shared/movie-editions/rollback/physical.ts";
import type { MovieRollbackCaptionManifestV1 } from "#shared/movie-editions/rollback/captions.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { FileGuardError } from "#automation/files/types.ts";
import {
  workerFilePath,
  storedFilePath,
} from "#automation/files/paths/locations.ts";

/** Metadata and native before identities must belong to the SAME admitted B.
 * The strict current physical grant has already closed each installation source. */
export function movieRollbackCaptionStateV1(
  context: PublicationContext,
  intent: MovieRollbackIntentV1,
) {
  const manifest = rollbackCaptionManifest(intent);
  const sidecars = intent.successor.subtitles.filter(
    (row) => row.storageKind === "sidecar",
  );
  if (
    sidecars.length !== manifest.captions.length ||
    manifest.captions.some(
      (caption) =>
        !sidecars.some(
          (row) => identityHash(row) === identityHash(caption.snapshot),
        ) ||
        caption.snapshot.path === null ||
        workerFilePath(context, caption.snapshot.path) !==
          path.join(context.roots.movies.library, caption.source.path) ||
        caption.workerSourcePath !==
          path.join(context.roots.movies.library, caption.source.path) ||
        caption.workerTargetPath !==
          path.join(context.roots.movies.control, caption.target.path) ||
        storedFilePath(context, "movies", "control", caption.target.path) !==
          caption.storedTargetPath,
    )
  )
    throw new FileGuardError("movie_rollback_caption_inventory_changed");
  if (manifest.captions.length === 0) return { manifest, state: null };
  const mechanical = MovieRollbackCaptionIORefV1Schema.parse({
    kind: "movie_rollback_captions_v1",
    transitionId: intent.id,
    intentHash: identityHash(intent),
    scope: intent.scope,
    assetId: manifest.assetId,
    participants: manifest.captions.flatMap((caption) => [
      {
        assetId: manifest.assetId,
        subtitleId: caption.snapshot.id,
        libraryKind: "movies",
        role: "sidecar",
        physical: caption.source,
      },
      {
        assetId: manifest.assetId,
        subtitleId: caption.snapshot.id,
        libraryKind: "movies",
        role: "quarantine",
        physical: caption.target,
      },
    ]),
    journals: [],
  });
  return {
    manifest,
    state: new PublicationEffectState(
      mechanical,
      rollbackCaptionSteps(context, intent, manifest),
    ),
  };
}

function rollbackCaptionManifest(intent: MovieRollbackIntentV1) {
  const manifest = intent.captionManifest;
  const grant = intent.successorGrant;
  if (
    manifest === undefined ||
    grant === null ||
    intent.invocation.mode !== "manual_verified" ||
    manifest.admissionId !== intent.id ||
    manifest.assetId !== intent.successor.id ||
    manifest.assetVersion !== intent.successor.version ||
    manifest.assetChecksum !== intent.successor.checksum ||
    manifest.ownershipEpoch !== intent.successor.ownershipEpoch ||
    identityHash(manifest.scope) !== identityHash(intent.scope) ||
    grant.assetId !== manifest.assetId ||
    grant.assetVersion !== manifest.assetVersion ||
    identityHash(grant.scope) !== identityHash(intent.scope)
  )
    throw new FileGuardError("movie_rollback_caption_admission_changed");
  return manifest;
}

function rollbackCaptionSteps(
  context: PublicationContext,
  intent: MovieRollbackIntentV1,
  manifest: MovieRollbackCaptionManifestV1,
): PublicationStep[] {
  return manifest.captions.flatMap((caption): PublicationStep[] => {
    const source = { root: "library" as const, path: caption.source.path };
    const target = { root: "control" as const, path: caption.target.path };
    const base = {
      entryOperationId:
        intent.source.reference.intent.entries[0].entry.operationId,
      operationId: caption.operationId,
      assetId: manifest.assetId,
      subtitleId: caption.snapshot.id,
      libraryKind: "movies" as const,
      completionPaths: [source, target],
      manifest: {
        version: 1 as const,
        operationId: caption.operationId,
        kind: "quarantine" as const,
        source: path.join(context.roots.movies.library, source.path),
        target: path.join(context.roots.movies.control, target.path),
        sha256: caption.source.sha256,
        previousSha256: null,
        phase: "prepared" as const,
      },
    };
    return [
      { ...base, step: "move_link", primitive: "link", source, target },
      {
        ...base,
        step: "move_unlink",
        primitive: "unlink",
        source,
        target: null,
      },
      {
        ...base,
        step: "journal_complete",
        primitive: "journal_complete",
        source: null,
        target: null,
      },
    ];
  });
}
