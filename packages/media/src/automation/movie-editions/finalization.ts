import type { MediaAutomationContext } from "#automation/context.ts";
import { queueOperation, serializable } from "#automation/store.ts";
import { networkMovieAccess } from "#automation/editions/access.ts";
import { requireMovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import { lockMovieCommand } from "#infrastructure/movie-editions/locks.ts";
import { lockRuntimeAuthority } from "#infrastructure/handoff/authority.ts";
import { readMoviePlexReceiptV2 } from "#infrastructure/movie-editions/plex/receipt.ts";
import { readCurrentPlexBinding } from "#infrastructure/plex-binding/read.ts";
import {
  bindPlexTransactionDeadline,
  plexBindingFreshness,
} from "#infrastructure/plex-binding/freshness.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import {
  MovieAttemptOperationV4Schema,
  type MovieAttemptOperationV4,
} from "#shared/movie-editions/automation-v4.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { queueMovieSubtitleTargetsV4 } from "./subtitles/queue.ts";
import { queueMoviePublicationNoticesV4 } from "./notifications/producer.ts";
import { queueReadyMovieCaptionNoticesV4 } from "./notifications/captions.ts";

/** Logical completion uses the real immutable Plex publication, never a fabricated acquisition parent. */
export async function finalizeMovieAcquisitionV4(
  context: MediaAutomationContext,
  raw: MovieAttemptOperationV4,
  execution: PlexBindingExecution,
): Promise<void> {
  execution.assertActive();
  const input = MovieAttemptOperationV4Schema.parse(raw);
  const budget = new PublicationAuthorityReadBudget();
  const original = await readMoviePlexReceiptV2(context.db, input, budget);
  if (original === null) throw new PlexBindingProtection("missing_binding");
  const attempt = await context.db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: input.attemptId },
  });
  budget.consume(1);
  execution.assertActive();
  if (attempt.state === "completed") return;
  const invocation = plexBindingFreshness({
    observed: execution.observed,
    expiresAtMs: execution.expiresAtMs,
    guards: [execution],
  });
  const access = requireMovieChoiceAccess(
    (await networkMovieAccess(context, [input.scope.mediaId])) ?? {},
  );
  invocation.assertActive();
  await serializable(context.db, async (tx) => {
    const { target } = await lockMovieCommand(tx, input.scope);
    await tx.$queryRaw`SELECT id FROM "AcquisitionAttempt" WHERE id=${input.attemptId} FOR UPDATE`;
    const current = await tx.acquisitionAttempt.findUniqueOrThrow({
      where: { id: input.attemptId },
      include: { torrent: true },
    });
    budget.consume(1 + (current.torrent === null ? 0 : 1));
    const publication = await readMoviePlexReceiptV2(tx, input, budget);
    if (
      publication === null ||
      identityHash(publication) !== identityHash(original)
    )
      throw new Error("Movie finalization publication changed");
    execution.assertActive();
    if (current.state === "completed") return;
    if (
      current.state !== "imported" ||
      !(await lockRuntimeAuthority(tx, current.recoveryEpoch))
    )
      throw new PlexBindingProtection("ownership_changed");
    const lease = await tx.legacyWriterLease.findUniqueOrThrow({
      where: { id: "singleton" },
    });
    const freshness = plexBindingFreshness({
      observed: execution.observed,
      expiresAtMs: Math.min(invocation.expiresAtMs, lease.expiresAt.getTime()),
      guards: [invocation],
    });
    await bindPlexTransactionDeadline(tx, freshness);
    const group = publication.expected.newGroups[0];
    if (
      group === undefined ||
      target?.availability !== "available" ||
      target.automationEpoch !== current.recoveryEpoch
    )
      throw new PlexBindingProtection("scope_changed");
    // Reserve the one current pointer and its immutable association in this caller's allowance.
    budget.consume(2);
    const binding = await readCurrentPlexBinding(tx, {
      scope: { mediaId: input.scope.mediaId, edition: input.scope.edition },
      assetId: group.assetId,
      access: {
        serverMachineId: access.serverMachineId,
        sectionId: access.movieSectionId,
        sectionType: "movie",
      },
    });
    freshness.assertActive();
    if (binding.status !== "current")
      throw new PlexBindingProtection(binding.reason);
    if (identityHash(binding.association.group) !== identityHash(group))
      throw new PlexBindingProtection("binding_changed");
    if (
      current.torrent === null ||
      !current.torrent.owned ||
      current.torrent.ownershipEpoch !== current.recoveryEpoch
    )
      throw new Error("Movie finalization lost its actual owned transfer");
    await tx.acquisitionAttempt.update({
      where: { id: current.id },
      data: { state: "completed" },
    });
    await tx.acquisitionReservation.deleteMany({
      where: {
        attemptId: current.id,
        mediaId: input.scope.mediaId,
        edition: input.scope.edition,
      },
    });
    await queueOperation(tx, {
      key: `seed:${current.torrent.id}`,
      kind: "maintain_torrent",
      targetId: current.torrent.id,
      payload: { torrentId: current.torrent.id },
    });
    await queueMovieSubtitleTargetsV4(
      tx,
      {
        scope: input.scope,
        assetId: group.assetId,
        epoch: current.recoveryEpoch,
        access,
      },
      budget,
    );
    const notices = await queueMoviePublicationNoticesV4(
      tx,
      { input, access },
      budget,
    );
    const captionNotices = await queueReadyMovieCaptionNoticesV4(
      tx,
      {
        scope: input.scope,
        assetId: group.assetId,
        epoch: current.recoveryEpoch,
        access,
      },
      budget,
    );
    await tx.applicationEvent.upsert({
      where: { dedupeKey: `movie-finalized-v4:${current.id}` },
      update: {},
      create: {
        dedupeKey: `movie-finalized-v4:${current.id}`,
        mediaId: input.scope.mediaId,
        actorId: publication.command.userId,
        kind: "movie_acquisition_finalized_v4",
        payload: {
          schemaVersion: 4,
          operationId: input.operationId,
          attemptId: current.id,
          scope: input.scope,
          assetId: group.assetId,
          recoveryEpoch: current.recoveryEpoch,
        },
      },
    });
    for (const guard of notices.guards) guard.assertActive();
    for (const guard of captionNotices.guards) guard.assertActive();
    freshness.assertActive();
  });
  execution.assertActive();
}
