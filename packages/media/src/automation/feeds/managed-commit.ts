import type { Prisma } from "#generated/prisma/client.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { queueOperation } from "#automation/store.ts";
import { movieManagementContext } from "#automation/movie-editions/management-context.ts";
import { acquisitionInvocation } from "#automation/acquisition-management/invocation.ts";
import { readLibraryMovieManagement } from "#infrastructure/movie-editions/management/authority.ts";
import { readLibrarySeriesManagement } from "#infrastructure/acquisition-identity/library-management.ts";
import { assertCurrentMovieAssessment } from "#infrastructure/movie-editions/release-assessment.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { MediaError } from "#application/errors.ts";
import { MovieEditionScopeSchema } from "#shared/movie-editions/registry.ts";
import type { FeedMatchTarget, selectFeedCandidateV1 } from "./selection.ts";
import {
  bindPlexTransactionDeadline,
  plexBindingFreshness,
} from "#infrastructure/plex-binding/freshness.ts";
import type { PlexBindingFreshness } from "#shared/plex-binding/contract.ts";

type ManagedSelection = Extract<
  NonNullable<Awaited<ReturnType<typeof selectFeedCandidateV1>>>,
  { protocol: "library-movie-v4" | "library-episode" }
>;
const hash = (value: unknown) => identityHash(nativeJson(value));
function changed(): never {
  throw new MediaError(
    "library_management_unconfirmed",
    "Feed acquisition needs its unchanged current library approval",
    409,
  );
}

/** Exact target/runtime locks are held; a feed observation never creates requester consent. */
export async function queueManagedFeedMatchV1(
  tx: Prisma.TransactionClient,
  initial: MediaAutomationContext,
  input: {
    key: string;
    current: Pick<
      FeedMatchTarget,
      | "mediaId"
      | "edition"
      | "editionRootId"
      | "generation"
      | "automationEpoch"
      | "profileId"
    >;
    selected: ManagedSelection;
  },
) {
  const { current, selected } = input;
  const context = movieManagementContext(initial);
  if (selected.protocol === "library-movie-v4") {
    const scope = MovieEditionScopeSchema.parse({
      mediaId: current.mediaId,
      rootMediaId: current.editionRootId,
      edition: current.edition,
    });
    const grant = await readLibraryMovieManagement(
      tx,
      { scope, epoch: current.automationEpoch, access: selected.access },
      context.movieManagement,
    );
    if (grant === null || hash(grant.proof) !== hash(selected.management))
      changed();
    await assertCurrentMovieAssessment(
      tx,
      selected.selected.assessment,
      scope,
      selected.selected.releaseId,
    );
    await bindManagedFeedDeadline(tx, context, grant.freshness);
    await queueOperation(tx, {
      key: input.key,
      kind: "reconcile_movie_edition_v4",
      targetId: current.mediaId,
      userId: grant.proof.actorId,
      budget: context.movieManagement.budget,
      payload: {
        schemaVersion: 4,
        mediaId: current.mediaId,
        scope,
        generation: current.generation,
        releaseId: selected.selected.releaseId,
        cursor: null,
        libraryManagementReceiptId: grant.proof.receiptId,
      },
    });
    grant.freshness.assertActive();
  } else {
    const configured = await acquisitionInvocation(context, {
      mediaId: current.mediaId,
    });
    const invocation = configured.libraryManagement;
    if (invocation === undefined)
      throw new Error("Episode feed commit lost its original invocation");
    const grant = await readLibrarySeriesManagement(
      tx,
      {
        mediaIds: [current.mediaId],
        epoch: current.automationEpoch,
        access: selected.access,
      },
      invocation,
    );
    if (grant === null || hash(grant.proof) !== hash(selected.management))
      changed();
    const profile = await tx.qualityProfile.findUniqueOrThrow({
      where: { id: selected.selected.profileId },
    });
    if (
      profile.id !== current.profileId ||
      profile.version !== selected.selected.profileVersion
    )
      changed();
    await bindManagedFeedDeadline(tx, context, grant.freshness);
    await queueOperation(tx, {
      key: input.key,
      kind: "reconcile_media",
      targetId: current.mediaId,
      budget: invocation.budget,
      payload: {
        mediaId: current.mediaId,
        generation: current.generation,
        releaseId: selected.selected.id,
        cursor: null,
      },
    });
    grant.freshness.assertActive();
  }
  selected.freshness.assertActive();
}

async function bindManagedFeedDeadline(
  tx: Prisma.TransactionClient,
  context: ReturnType<typeof movieManagementContext>,
  grant: PlexBindingFreshness,
) {
  const execution = context.movieManagement.execution;
  const writer = await tx.legacyWriterLease.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  const freshness = plexBindingFreshness({
    observed: execution.observed,
    expiresAtMs: Math.min(
      execution.expiresAtMs,
      grant.expiresAtMs,
      writer.expiresAt.getTime(),
    ),
    guards: [execution, grant],
  });
  await bindPlexTransactionDeadline(tx, freshness);
}
