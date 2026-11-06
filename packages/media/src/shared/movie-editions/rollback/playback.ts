import { z } from "zod";
import { MovieEditionHashSchema as Hash } from "#shared/movie-editions/registry.ts";
import { MovieRollbackOperationV1Schema } from "./operation.ts";
import { MovieRollbackExpectedV1Schema } from "./manual-command.ts";
import { PlexServingExpectedProtocolSchema } from "#shared/plex-binding/library.ts";
import { MovieServingPlexV2Schema } from "#shared/movie-editions/plex-v2.ts";
import {
  PlexBindingSnapshotSchema,
  PlexMovieAssociationV2Schema,
} from "#shared/plex-binding/contract.ts";

/** Actual Network metadata verification followed by sessions-last observation.
 * Files can consume this bounded receipt, never refresh it or infer absence. */
const MovieRollbackPlaybackBodyV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.uuid(),
  transactionId: z.string().regex(/^[1-9]\d*$/u),
  input: MovieRollbackOperationV1Schema,
  command: z.strictObject({
    actorId: z.uuid(),
    payloadHash: Hash,
    payloadRaw: z.string().min(1),
  }),
  phase: z.enum(["admission", "physical"]),
  admission: z
    .strictObject({ intentId: z.uuid(), intentHash: Hash })
    .nullable(),
  review: MovieRollbackExpectedV1Schema,
  reviewHash: Hash,
  reviewRaw: z.string().min(1),
  successorPublicationHash: Hash,
  expected: PlexServingExpectedProtocolSchema.nullable(),
  serving: MovieServingPlexV2Schema.nullable(),
  association: PlexMovieAssociationV2Schema,
  binding: PlexBindingSnapshotSchema,
  paths: z.array(z.string().min(1)).min(1).max(1000),
  pathsHash: Hash,
  pathsRaw: z.string().min(1),
  sessions: z.strictObject({
    state: z.literal("clear"),
    pathsHash: Hash,
    checkedAt: z.iso.datetime(),
  }),
  sdk: z.strictObject({
    observedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
  }),
  writerExpiresAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  completedAt: z.iso.datetime(),
});
type PlaybackBody = z.infer<typeof MovieRollbackPlaybackBodyV1Schema>;

function playbackClockMatches(guard: PlaybackBody) {
  const observed = Date.parse(guard.sdk.observedAt);
  const expires = Date.parse(guard.expiresAt);
  return !(
    Date.parse(guard.sessions.checkedAt) < observed ||
    Date.parse(guard.completedAt) < Date.parse(guard.sessions.checkedAt) ||
    Date.parse(guard.completedAt) >= expires ||
    expires >
      Math.min(
        observed + 60_000,
        Date.parse(guard.sdk.expiresAt),
        Date.parse(guard.writerExpiresAt),
      )
  );
}

function playbackSourceMatches(guard: PlaybackBody) {
  const group = guard.association.group;
  return !(
    guard.review.recoveryEpoch !== group.ownershipEpoch ||
    guard.binding.scope.mediaId !== guard.input.scope.mediaId ||
    guard.binding.scope.edition !== guard.input.scope.edition ||
    group.canonicalRootId !== guard.input.scope.rootMediaId ||
    group.edition !== guard.input.scope.edition ||
    group.assetId !== guard.review.successor.id ||
    group.assetVersion !== guard.review.successor.version ||
    group.checksum !== guard.review.successor.checksum
  );
}

function playbackPhaseMatches(guard: PlaybackBody) {
  if (guard.phase === "physical")
    return (
      guard.admission !== null &&
      guard.expected === null &&
      guard.serving === null
    );
  if (
    guard.admission !== null ||
    guard.expected === null ||
    guard.serving === null
  )
    return false;
  const verification = guard.serving.verification;
  return (
    Date.parse(verification.startedAt) >= Date.parse(guard.sdk.observedAt) &&
    Date.parse(guard.sessions.checkedAt) >=
      Date.parse(verification.completedAt) &&
    Date.parse(guard.expiresAt) <= Date.parse(verification.expiresAt) &&
    guard.expected.recoveryEpoch === guard.review.recoveryEpoch &&
    guard.expected.newGroups.length === 1 &&
    guard.expected.newGroups[0].assetId === guard.review.successor.id
  );
}

export const MovieRollbackPlaybackV1Schema =
  MovieRollbackPlaybackBodyV1Schema.superRefine((guard, ctx) => {
    if (
      !playbackClockMatches(guard) ||
      !playbackSourceMatches(guard) ||
      !playbackPhaseMatches(guard) ||
      (guard.phase === "admission" &&
        Date.parse(guard.expiresAt) >
          Date.parse(guard.review.cleanup.expiresAt)) ||
      guard.sessions.pathsHash !== guard.pathsHash ||
      new Set(guard.paths).size !== guard.paths.length
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Movie rollback playback guard changed its real source, phase or original deadlines",
      });
  });
export const MovieRollbackPlaybackEnvelopeV1Schema = z.strictObject({
  guard: MovieRollbackPlaybackV1Schema,
  guardHash: Hash,
  raw: z.string().min(1),
});
export type MovieRollbackPlaybackV1 = z.infer<
  typeof MovieRollbackPlaybackV1Schema
>;
