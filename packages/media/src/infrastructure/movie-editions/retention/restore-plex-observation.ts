import type { z } from "zod";
import type { MovieServingPlexV2Schema } from "#shared/movie-editions/plex-v2.ts";
import type {
  MovieRestorePlexExpectedV1,
  MovieRestorePlexReceiptV1,
} from "#shared/movie-editions/restore-plex-v1.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";

export function assertMovieRestorePlexObservation(
  expected: MovieRestorePlexExpectedV1,
  observation: z.infer<typeof MovieServingPlexV2Schema>,
  expiresAtMs: number,
) {
  const association = observation.associations[0];
  const target = expected.targets[0];
  if (
    association.item.ratingKey !== expected.originalItem.ratingKey ||
    association.item.media[0].parts[0].id !== expected.originalItem.part.id ||
    association.item.media[0].parts[0].file !==
      expected.originalItem.part.file ||
    identityHash(association.group) !== identityHash(expected.newGroups[0]) ||
    identityHash(association.scope) !== identityHash(target.scope) ||
    association.editionRootId !== target.editionRootId ||
    association.canonicalIdentityHash !== target.canonicalIdentityHash ||
    association.numberingHash !== target.numberingHash ||
    identityHash(association.definition) !== identityHash(target.definition) ||
    identityHash(expected.access) !== identityHash([association.access]) ||
    Date.parse(observation.verification.expiresAt) > expiresAtMs
  )
    throw new Error(
      "Movie restore Plex observation differs from captured exact authority",
    );
  return association;
}

/** Fresh rebind clocks and retained physical publication clocks are independent immutable facts. */
export function assertMovieRestorePlexReceiptV1(
  receipt: MovieRestorePlexReceiptV1,
) {
  const verification = receipt.observation.verification;
  const association = assertMovieRestorePlexObservation(
    receipt.expected,
    receipt.observation,
    Math.min(
      Date.parse(receipt.sdk.expiresAt),
      Date.parse(receipt.writerExpiresAt),
    ),
  );
  const expected = receipt.expected;
  if (
    receipt.publication.operationId !== receipt.input.operationId ||
    receipt.publication.assetId !== association.group.assetId ||
    receipt.publication.assetVersion !== association.group.assetVersion ||
    identityHash(receipt.publication.scope) !==
      identityHash(receipt.input.scope) ||
    identityHash(expected.parents[0].reference) !==
      identityHash(receipt.publication) ||
    expected.parents[0].recoveryEpoch !== expected.recoveryEpoch ||
    expected.recoveryEpoch !== association.group.ownershipEpoch ||
    expected.targets[0].generation !== receipt.input.generation ||
    expected.previous[0].evidence !== null ||
    receipt.binding.revision !== expected.previous[0].revision + 1 ||
    receipt.binding.associationHash !== identityHash(association) ||
    identityHash(receipt.binding.scope) !== identityHash(association.scope)
  )
    throw new Error(
      "Movie restore Plex completion lost its exact source or binding",
    );
  const started = Date.parse(verification.startedAt),
    completed = Date.parse(verification.completedAt),
    expires = Date.parse(verification.expiresAt);
  if (
    started < Date.parse(receipt.sdk.observedAt) ||
    completed < started ||
    Date.parse(receipt.reboundAt) < completed ||
    Date.parse(receipt.committedAt) < Date.parse(receipt.reboundAt) ||
    Date.parse(receipt.committedAt) >= expires
  )
    throw new Error(
      "Movie restore Plex completion original verification clock changed",
    );
}
