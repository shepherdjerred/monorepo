import type { PublicationContext } from "#automation/publication-proof/invocation.ts";
import type { PublicationEffectState } from "#automation/publication-proof/effect-state.ts";
import { physicalKey } from "#automation/publication-proof/effect-state.ts";
import { observePublicationPhysicalPath } from "#automation/publication-proof/participants.ts";
import { assertPublicationJournalIdentity } from "#filesystem/publication-proof/journal.ts";
import type { MovieRollbackCaptionIORefV1 } from "#shared/movie-editions/rollback/caption-io.ts";
import type { MovieRollbackIntentV1 } from "#shared/movie-editions/rollback/physical.ts";
import { MovieRollbackCaptionOutcomeV1Schema } from "#shared/movie-editions/rollback/captions.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { FileGuardError } from "#automation/files/types.ts";

type MovieRollbackCaptionStateV1 =
  PublicationEffectState<MovieRollbackCaptionIORefV1>;

/** Once original inverse ACKs exist, their real later A path states supersede
 * the earlier B-quarantine source absence at a shared caption pathname. */
export async function assertMovieRollbackCaptionPhysicalV1(
  context: PublicationContext,
  intent: MovieRollbackIntentV1,
  state: MovieRollbackCaptionStateV1,
  original: PublicationEffectState,
) {
  const prefix = intent.source.outcome.effects;
  if (
    identityHash(original.refs.slice(0, prefix.length)) !== identityHash(prefix)
  )
    throw new FileGuardError("movie_rollback_original_effect_prefix_changed");
  const inverseStarted = original.refs.length > prefix.length;
  if (inverseStarted && state.next !== undefined)
    throw new FileGuardError("movie_rollback_caption_chain_precedes_inverse");
  for (const expected of state.physical.values()) {
    const later = inverseStarted
      ? original.physical.get(physicalKey("movies", expected))
      : undefined;
    const actual = await observePublicationPhysicalPath(context, {
      libraryKind: "movies",
      root: expected.root,
      path: expected.path,
    });
    if (identityHash(actual) !== identityHash(later ?? expected))
      throw new FileGuardError(
        "movie_rollback_caption_physical_prefix_changed",
      );
  }
  for (const journal of state.journals.values())
    await assertPublicationJournalIdentity(context.roots.movies, journal);
}

export async function captureMovieRollbackCaptionOutcomeV1(
  context: PublicationContext,
  intent: MovieRollbackIntentV1,
  state: MovieRollbackCaptionStateV1,
  original: PublicationEffectState,
) {
  const manifest = intent.captionManifest;
  if (manifest === undefined || state.next !== undefined)
    throw new FileGuardError("movie_rollback_caption_chain_incomplete");
  await assertMovieRollbackCaptionPhysicalV1(context, intent, state, original);
  const targets = [];
  const closedSources = [];
  for (const caption of manifest.captions) {
    const target = await observePublicationPhysicalPath(context, {
      libraryKind: "movies",
      root: "control",
      path: caption.target.path,
    });
    if (
      target.state !== "present" ||
      target.sha256 !== caption.source.sha256 ||
      target.sizeBytes !== caption.source.sizeBytes ||
      target.identity.device !== caption.source.identity.device ||
      target.identity.inode !== caption.source.identity.inode
    )
      throw new FileGuardError(
        "movie_rollback_retained_caption_identity_changed",
      );
    targets.push({
      assetId: manifest.assetId,
      subtitleId: caption.snapshot.id,
      libraryKind: "movies",
      role: "quarantine",
      physical: target,
    });
    closedSources.push({
      subtitleId: caption.snapshot.id,
      physical: await observePublicationPhysicalPath(context, {
        libraryKind: "movies",
        root: "library",
        path: caption.source.path,
      }),
    });
  }
  return MovieRollbackCaptionOutcomeV1Schema.parse({
    schemaVersion: 1,
    manifestHash: identityHash(manifest),
    effects: state.refs,
    targets,
    closedSources,
    journals: [...state.journals.values()],
  });
}
