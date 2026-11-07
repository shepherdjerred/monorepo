import { z } from "zod";
import {
  MovieEditionScopeSchema,
  MovieEditionHashSchema as Hash,
} from "#shared/movie-editions/registry.ts";
import {
  MoviePublicationAssetV2Schema,
  MoviePublicationIntentRefV2Schema,
  MoviePublicationOutcomeV2Schema,
  MoviePublicationReferenceV2Schema,
} from "#shared/movie-editions/publication-v2.ts";
import {
  PlexAccessSchema,
  PlexBindingSnapshotSchema,
  PlexPointerExpectedSchema,
  PlexPartIdentitySchema,
} from "#shared/plex-binding/contract.ts";
import { PlexDecimalIdSchema } from "#shared/plex-events/contract.ts";
import { PublicationParticipantSchema } from "#shared/publication-proof/intent.ts";
import {
  PublicationJournalSchema,
  PublicationEffectRefSchema,
} from "#shared/publication-proof/effects.ts";
import {
  MovieRollbackInvocationV1Schema,
  type MovieRollbackInvocationV1,
} from "./operation.ts";
import { MovieRollbackPlaybackReferenceV1Schema } from "./playback-reference.ts";
import {
  MovieRollbackCaptionManifestV1Schema,
  MovieRollbackCaptionOutcomeV1Schema,
} from "./captions.ts";

function rollbackCommandMatches(intent: {
  operationId: string;
  invocation: MovieRollbackInvocationV1;
  cleanup: unknown;
  rejection: unknown;
  playback?: unknown;
  captionManifest?: unknown;
  captionManifestRaw?: unknown;
  successorGrantRaw?: unknown;
}) {
  return intent.invocation.mode === "manual_verified"
    ? intent.invocation.command.operationId === intent.operationId &&
        intent.invocation.command.sourceAttemptId ===
          intent.invocation.source.attemptId &&
        intent.cleanup !== null &&
        intent.rejection === null &&
        intent.playback !== undefined &&
        intent.captionManifest !== undefined &&
        intent.captionManifestRaw !== undefined &&
        intent.successorGrantRaw !== undefined
    : intent.operationId === intent.invocation.source.operationId &&
        intent.rejection !== null &&
        intent.playback === undefined &&
        intent.captionManifest === undefined &&
        intent.captionManifestRaw === undefined &&
        intent.successorGrantRaw === undefined;
}

export const MovieRollbackOriginalItemV1Schema = z.strictObject({
  binding: PlexBindingSnapshotSchema,
  ratingKey: PlexDecimalIdSchema,
  part: PlexPartIdentitySchema.pick({ id: true, file: true }),
});

export const MovieRollbackIntentV1Schema = z
  .strictObject({
    schemaVersion: z.literal(1),
    id: z.uuid(),
    transactionId: z.string().regex(/^[1-9]\d*$/u),
    operationId: z.uuid(),
    scope: MovieEditionScopeSchema,
    invocation: MovieRollbackInvocationV1Schema,
    command: z.strictObject({
      kind: z.enum([
        "reconcile_movie_edition_v4",
        "acquire_movie_edition_v4",
        "rollback_movie_edition_v1",
      ]),
      targetId: z.uuid(),
      userId: z.uuid().nullable(),
      payloadHash: Hash,
      payloadRaw: z.string().min(1),
    }),
    source: z.strictObject({
      state: z.enum(["imported", "completed"]),
      reference: MoviePublicationIntentRefV2Schema,
      outcome: MoviePublicationOutcomeV2Schema,
      outcomeHash: Hash,
      attemptHash: Hash,
      attemptRaw: z.string().min(1),
      commandHash: Hash,
      commandRaw: z.string().min(1),
      commandPayloadRaw: z.string().min(1),
    }),
    rejection: z
      .strictObject({ eventId: z.uuid(), receiptHash: Hash })
      .nullable(),
    playback: MovieRollbackPlaybackReferenceV1Schema.optional(),
    captionManifest: MovieRollbackCaptionManifestV1Schema.optional(),
    captionManifestRaw: z.string().min(1).optional(),
    successorGrantRaw: z.string().min(1).optional(),
    predecessor: MoviePublicationAssetV2Schema,
    successor: MoviePublicationAssetV2Schema,
    successorGrant: MoviePublicationReferenceV2Schema.nullable(),
    originalItem: MovieRollbackOriginalItemV1Schema,
    originalAccess: PlexAccessSchema,
    pointer: PlexPointerExpectedSchema,
    access: z.strictObject({
      serverMachineId: z.string().min(1),
      movieSectionId: z.string().min(1),
    }),
    authority: z.strictObject({
      generation: z.int().nonnegative(),
      recoveryEpoch: z.int().nonnegative(),
      identityHash: Hash,
      identityRaw: z.string().min(1),
      birthHash: Hash,
      birthRaw: z.string().min(1),
      generationsHash: Hash,
      generationsRaw: z.string().min(1),
      profileId: z.uuid(),
      profileVersion: z.int().nonnegative(),
    }),
    cleanup: z
      .strictObject({
        id: z.uuid(),
        version: z.int().nonnegative(),
        expiresAt: z.iso.datetime(),
      })
      .nullable(),
    observedAt: z.iso.datetime(),
    sdkExpiresAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    admittedAt: z.iso.datetime(),
    owner: z.strictObject({
      workflowId: z.string().min(1),
      runId: z.string().min(1),
      activityId: z.string().min(1),
    }),
  })
  .superRefine((intent, ctx) => {
    const entry = intent.source.reference.intent.entries[0];
    const source = intent.invocation.source;
    if (
      intent.source.outcome.kind !== "published" ||
      intent.source.reference.intent.attemptId !== source.attemptId ||
      source.scope.mediaId !== intent.scope.mediaId ||
      source.scope.edition !== intent.scope.edition ||
      intent.source.outcome.transitionId !==
        intent.source.reference.transitionId ||
      intent.source.outcome.intentHash !== intent.source.reference.intentHash ||
      intent.predecessor.id !== entry.entry.previousAssetId ||
      intent.successor.id !== entry.entry.assetId ||
      intent.predecessor.state !== "superseded" ||
      intent.successor.state !== "published" ||
      intent.predecessor.version !== (entry.entry.previousVersion ?? -2) + 1 ||
      !rollbackCommandMatches(intent)
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Movie rollback lost its exact source, physical pair or real command",
      });
  });

/** Actual inverse completion; the original published outcome remains unchanged. */
export const MovieRollbackPhysicalV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  transactionId: z.string().regex(/^[1-9]\d*$/u),
  operationId: z.uuid(),
  intentId: z.uuid(),
  intentHash: Hash,
  scope: MovieEditionScopeSchema,
  predecessor: MoviePublicationAssetV2Schema,
  successor: MoviePublicationAssetV2Schema,
  bindingRaw: z.string().min(1),
  bindingHash: Hash,
  physicalEvidenceRaw: z.string().min(1),
  physicalEvidenceHash: Hash,
  retiredPointer: PlexPointerExpectedSchema,
  effects: z.array(PublicationEffectRefSchema).min(1).max(1000),
  participants: z.array(PublicationParticipantSchema).min(1).max(1000),
  journals: z.array(PublicationJournalSchema).min(1).max(202),
  playback: MovieRollbackPlaybackReferenceV1Schema.optional(),
  successorCaptions: MovieRollbackCaptionOutcomeV1Schema.optional(),
  observedAt: z.iso.datetime(),
  sdkExpiresAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  committedAt: z.iso.datetime(),
});
export const MovieRollbackIntentEnvelopeV1Schema = z.strictObject({
  intent: MovieRollbackIntentV1Schema,
  intentHash: Hash,
  raw: z.string().min(1),
});
export const MovieRollbackPhysicalEnvelopeV1Schema = z.strictObject({
  receipt: MovieRollbackPhysicalV1Schema,
  receiptHash: Hash,
  raw: z.string().min(1),
});
export type MovieRollbackIntentV1 = z.infer<typeof MovieRollbackIntentV1Schema>;
export type MovieRollbackPhysicalV1 = z.infer<
  typeof MovieRollbackPhysicalV1Schema
>;
