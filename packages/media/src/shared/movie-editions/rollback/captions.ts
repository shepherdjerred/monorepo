import { z } from "zod";
import {
  MovieEditionHashSchema as Hash,
  MovieEditionScopeSchema,
} from "#shared/movie-editions/registry.ts";
import { NativeSubtitleSnapshotSchema } from "#shared/native-subtitles.ts";
import {
  PhysicalPathStateSchema,
  PublicationEffectRefSchema,
  PublicationJournalSchema,
} from "#shared/publication-proof/effects.ts";
import { PublicationParticipantSchema } from "#shared/publication-proof/intent.ts";
import { MovieReplacementSourceV2Schema } from "#shared/movie-editions/subtitle-replacement-v2.ts";
import { MoviePublicationReferenceV2Schema } from "#shared/movie-editions/publication-v2.ts";

export const MovieRollbackCaptionManifestV1Schema = z
  .strictObject({
    schemaVersion: z.literal(1),
    admissionId: z.uuid(),
    scope: MovieEditionScopeSchema,
    assetId: z.uuid(),
    assetVersion: z.int().nonnegative(),
    assetChecksum: Hash,
    ownershipEpoch: z.int().nonnegative(),
    captions: z
      .array(
        z.strictObject({
          operationId: z.string().regex(/^[\w-]{1,100}$/u),
          snapshot: NativeSubtitleSnapshotSchema,
          parent: z.strictObject({
            source: MovieReplacementSourceV2Schema,
            publication: MoviePublicationReferenceV2Schema,
          }),
          source: PhysicalPathStateSchema.options[0],
          target: PhysicalPathStateSchema.options[1],
          storedTargetPath: z.string().min(1).max(4096),
          workerSourcePath: z.string().min(1).max(4096),
          workerTargetPath: z.string().min(1).max(4096),
        }),
      )
      .max(64),
  })
  .superRefine((manifest, ctx) => {
    if (
      new Set(manifest.captions.map((caption) => caption.snapshot.id)).size !==
        manifest.captions.length ||
      manifest.captions.some(
        (caption, index) =>
          caption.operationId !==
            `rollback-caption-${manifest.admissionId}-${String(index)}` ||
          caption.snapshot.assetId !== manifest.assetId ||
          caption.snapshot.storageKind !== "sidecar" ||
          caption.snapshot.videoVersion !== manifest.assetVersion ||
          caption.snapshot.videoChecksum !== manifest.assetChecksum ||
          caption.snapshot.ownershipEpoch !== manifest.ownershipEpoch ||
          caption.snapshot.path === null ||
          caption.source.root !== "library" ||
          caption.source.sha256 !== caption.snapshot.checksum ||
          caption.target.root !== "control" ||
          caption.target.path !== `quarantine/${caption.operationId}`,
      )
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Movie rollback caption manifest lost its exact current owned successor caption",
      });
  });

/** A separate genuine quarantine chain; the old video publication effect chain
 * remains literal. Closed source paths may later hold restored A's own captions. */
export const MovieRollbackCaptionOutcomeV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  manifestHash: Hash,
  effects: z.array(PublicationEffectRefSchema).max(192),
  targets: z.array(PublicationParticipantSchema).max(64),
  closedSources: z
    .array(
      z.strictObject({
        subtitleId: z.uuid(),
        physical: PhysicalPathStateSchema,
      }),
    )
    .max(64),
  journals: z.array(PublicationJournalSchema).max(64),
});
export type MovieRollbackCaptionManifestV1 = z.infer<
  typeof MovieRollbackCaptionManifestV1Schema
>;
export type MovieRollbackCaptionOutcomeV1 = z.infer<
  typeof MovieRollbackCaptionOutcomeV1Schema
>;
