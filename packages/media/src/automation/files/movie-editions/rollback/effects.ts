import type { MovieRollbackIntentV1 } from "#shared/movie-editions/rollback/physical.ts";
import { PublicationEffectRefSchema } from "#shared/publication-proof/effects.ts";
import type { PublicationContext } from "#automation/publication-proof/invocation.ts";
import {
  preparePublicationStores,
  publicationRecording,
  withPublicationPaths,
  type MovieRollbackCaptionRecording,
} from "#automation/publication-proof/recording.ts";
import { executePublicationInverse } from "#automation/publication-proof/inverse.ts";
import { observePublicationParticipants } from "#automation/publication-proof/participants.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { FileGuardError } from "#automation/files/types.ts";
import type { MovieRollbackPhysicalV1 } from "#shared/movie-editions/rollback/physical.ts";
import type { FileOperations } from "#filesystem/operations.ts";
import type { PublicationEffectState } from "#automation/publication-proof/effect-state.ts";

type Evidence = Pick<
  MovieRollbackPhysicalV1,
  "effects" | "participants" | "journals" | "successorCaptions"
>;

/** Reuse the actual committed forward WAL and one separately owned inverse
 * namespace. No default compensation approval or outcome is manufactured. */
export async function prepareMovieRollbackEffectsV1(
  context: PublicationContext,
  intent: MovieRollbackIntentV1,
  captions?: {
    recording: MovieRollbackCaptionRecording;
    beforeInverse: (
      files: FileOperations,
      original: PublicationEffectState,
    ) => Promise<void>;
    bindAuthority: (guard: () => void) => void;
    outcome: (
      original: PublicationEffectState,
    ) => Promise<NonNullable<MovieRollbackPhysicalV1["successorCaptions"]>>;
  },
) {
  if (captions !== undefined && intent.invocation.mode !== "manual_verified")
    throw new FileGuardError("movie_rollback_caption_admission_mode_changed");
  const parent = intent.source.reference;
  const entry = parent.intent.entries[0].entry;
  const committed = await preparePublicationStores(context, {
    transitionId: parent.transitionId,
    plan: [entry],
  });
  const records = committed
    .flatMap((store) => store.observed.records)
    .sort((left, right) => left.record.ordinal - right.record.ordinal);
  const refs = records.map(({ record, hash }) =>
    PublicationEffectRefSchema.parse({
      ordinal: record.ordinal,
      libraryKind: record.libraryKind,
      effectHash: hash,
      operationId: record.effect.operationId,
      step: record.effect.step,
    }),
  );
  if (
    identityHash(refs) !== identityHash(intent.source.outcome.effects) ||
    records.some(
      ({ record }) =>
        record.continuationId !== null ||
        record.transitionId !== parent.transitionId ||
        record.intentHash !== parent.intentHash,
    )
  )
    throw new FileGuardError("movie_rollback_committed_wal_changed");
  const stores = await preparePublicationStores(context, {
    transitionId: parent.transitionId,
    continuationId: intent.id,
    plan: [entry],
  });
  const recording = publicationRecording(context, parent, stores, {
    inverse: { continuationId: intent.id },
    acknowledged: records.map(({ record }) => record),
    ...(captions === undefined
      ? {}
      : { movieRollbackCaptions: captions.recording }),
  });
  return {
    stores,
    execute: async <T>(input: {
      authorize: () => Promise<void>;
      assertActive: () => void;
      commit: (evidence: Evidence) => Promise<T>;
    }) => {
      for (const store of [...committed, ...stores])
        store.bindAuthority(input.assertActive);
      captions?.bindAuthority(input.assertActive);
      const operations = recording.operations(input.authorize);
      return withPublicationPaths(context, [entry], operations, async () => {
        for (const store of committed)
          await store.observed.assertUnchanged(store.added);
        if (captions !== undefined) {
          const selected = operations.find(
            (operation) => operation.kind === "movies",
          );
          if (selected === undefined)
            throw new Error("Manual rollback caption executor is missing");
          await captions.beforeInverse(selected.files, recording.state);
        }
        await recording.assertCurrent();
        await input.authorize();
        for (const action of recording.actions) {
          const selected = operations.find(
            (operation) => operation.kind === action.entry.libraryKind,
          );
          if (selected === undefined)
            throw new Error(
              "Movie rollback inverse has no actual Files executor",
            );
          await executePublicationInverse(selected.files, action);
        }
        if (recording.state.next !== undefined)
          throw new FileGuardError("movie_rollback_inverse_incomplete");
        await recording.assertCurrent();
        input.assertActive();
        const operationIds = [
          `recover-${entry.assetId}`,
          ...entry.previousSidecars.map(
            (sidecar) => `recover-${sidecar.quarantineId}`,
          ),
        ];
        const evidence = {
          effects: recording.state.refs,
          participants: await observePublicationParticipants(context, entry),
          journals: [...recording.state.journals.entries()]
            .filter(([key]) =>
              operationIds.some(
                (operationId) =>
                  key ===
                  JSON.stringify(["movies", `journal/${operationId}.json`]),
              ),
            )
            .map(([, journal]) => journal),
        };
        return input.commit({
          ...evidence,
          ...(captions === undefined
            ? {}
            : { successorCaptions: await captions.outcome(recording.state) }),
        });
      });
    },
  };
}
