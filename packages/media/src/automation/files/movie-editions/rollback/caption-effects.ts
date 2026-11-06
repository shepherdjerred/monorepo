import type { PublicationContext } from "#automation/publication-proof/invocation.ts";
import type { FileOperations } from "#filesystem/operations.ts";
import type { PublicationEffectState } from "#automation/publication-proof/effect-state.ts";
import { effectHash } from "#automation/publication-proof/effect-state.ts";
import type { MovieRollbackIntentV1 } from "#shared/movie-editions/rollback/physical.ts";
import type { MovieRollbackCaptionRecording } from "#automation/publication-proof/recording.ts";
import { publicationRecordStore } from "#filesystem/publication-proof/store.ts";
import { inspectPublicationRecords } from "#filesystem/publication-proof/records.ts";
import type { VerifiedFileProof } from "#filesystem/verification.ts";
import { FileGuardError } from "#automation/files/types.ts";
import { movieRollbackCaptionStateV1 } from "./caption-state.ts";
import {
  assertMovieRollbackCaptionPhysicalV1,
  captureMovieRollbackCaptionOutcomeV1,
} from "./caption-physical.ts";

/** A genuine separate B-caption quarantine namespace. Completed moves are
 * acknowledged by their actual chain and never re-run over restored A bytes. */
export async function prepareMovieRollbackCaptionEffectsV1(
  context: PublicationContext,
  intent: MovieRollbackIntentV1,
  assertInitialAuthority: () => void,
) {
  const { manifest, state } = movieRollbackCaptionStateV1(context, intent);
  if (state === null) return null;
  let assertActive = assertInitialAuthority;
  assertActive();
  const roots = context.roots.movies;
  const store = await publicationRecordStore(roots, {
    transitionId: intent.id,
    continuationId: null,
    assertActive: () => {
      assertActive();
    },
    ...(context.verifyPlexExclusion === undefined
      ? {}
      : { verifyPlexExclusion: context.verifyPlexExclusion }),
  });
  const observed = await inspectPublicationRecords(roots, {
    transitionId: intent.id,
    continuationId: null,
    maxRecords: manifest.captions.length * 3,
    maxRecordBytes: Buffer.byteLength(JSON.stringify(manifest)) * 64 + 262_144,
    checkpoint: async () => {
      assertActive();
      await context.checkpoint("movie-rollback-caption-record-verification");
    },
  });
  for (const { record, hash } of observed.records) {
    if (record.continuationId !== null || effectHash(record) !== hash)
      throw new FileGuardError(
        "movie_rollback_caption_record_identity_changed",
      );
    state.accept(record);
  }
  const added: VerifiedFileProof[] = [];
  const recording: MovieRollbackCaptionRecording = {
    kind: "movie_rollback_captions_v1",
    entryOperationId:
      intent.source.reference.intent.entries[0].entry.operationId,
    operationIds: manifest.captions.map((caption) => caption.operationId),
    acknowledge: async (event) => {
      assertActive();
      const record = state.record(event);
      state.validate(record);
      const saved = await store.append(record);
      added.push(saved.proof);
      state.accept(record);
      await context.checkpoint(
        `movie-rollback-caption-effect-ack:${event.step}`,
      );
    },
  };
  const assertCurrent = async (original: PublicationEffectState) => {
    assertActive();
    await observed.assertUnchanged(added);
    await assertMovieRollbackCaptionPhysicalV1(
      context,
      intent,
      state,
      original,
    );
    assertActive();
  };
  return {
    recording,
    bindAuthority: (guard: () => void) => {
      assertActive = () => {
        assertInitialAuthority();
        guard();
      };
    },
    beforeInverse: async (
      files: FileOperations,
      original: PublicationEffectState,
    ) => {
      await assertCurrent(original);
      while (state.next !== undefined) {
        const next = state.next;
        const caption = manifest.captions.find(
          (item) => item.operationId === next.operationId,
        );
        if (caption === undefined)
          throw new FileGuardError("movie_rollback_caption_operation_changed");
        const before = state.refs.length;
        await files.quarantine({
          operationId: caption.operationId,
          quarantineId: caption.operationId,
          libraryPath: caption.source.path,
          sha256: caption.source.sha256,
        });
        if (state.refs.length === before)
          throw new FileGuardError(
            "movie_rollback_caption_acknowledgement_missing",
          );
        await assertCurrent(original);
      }
    },
    outcome: async (original: PublicationEffectState) => {
      await assertCurrent(original);
      return captureMovieRollbackCaptionOutcomeV1(
        context,
        intent,
        state,
        original,
      );
    },
  };
}
