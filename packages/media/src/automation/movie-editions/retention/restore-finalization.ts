import { z } from "zod";
import type { MediaAutomationContext } from "#automation/context.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import {
  MovieOperationV4Schema,
  type MovieOperationV4,
} from "#shared/movie-editions/automation-v4.ts";
import { MovieEditionHashSchema } from "#shared/movie-editions/registry.ts";
import { movieManagementContext } from "#automation/movie-editions/management-context.ts";
import { serializable } from "#automation/store.ts";
import { networkMovieAccess } from "#automation/editions/access.ts";
import { requireMovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import { lockMovieCommand } from "#infrastructure/movie-editions/locks.ts";
import { lockRuntimeAuthority } from "#infrastructure/handoff/authority.ts";
import { readMovieRestorePlexReceiptV1 } from "#infrastructure/movie-editions/retention/restore-plex-receipt.ts";
import { readCurrentPlexBinding } from "#infrastructure/plex-binding/read.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import {
  bindPlexTransactionDeadline,
  plexBindingFreshness,
} from "#infrastructure/plex-binding/freshness.ts";
import { queueMovieSubtitleTargetsV4 } from "#automation/movie-editions/subtitles/queue.ts";
import { queueMovieRestorationNoticesV4 } from "#automation/movie-editions/notifications/restoration.ts";

const FinalizedSchema = z.strictObject({
  input: MovieOperationV4Schema,
  assetId: z.uuid(),
  publicationHash: MovieEditionHashSchema,
});

/** Restoration completes captions and personal notices without touching transfer or acquisition history. */
export async function finalizeMovieRestorationV4(
  base: MediaAutomationContext,
  raw: MovieOperationV4,
  execution: PlexBindingExecution,
): Promise<void> {
  execution.assertActive();
  const input = MovieOperationV4Schema.parse(raw);
  const context = movieManagementContext({
    ...base,
    plexBindingExecution: () => execution,
  });
  const { budget } = context.movieManagement;
  const receipt = await readMovieRestorePlexReceiptV1(
    context.db,
    input,
    budget,
  );
  if (receipt === null) throw new PlexBindingProtection("missing_binding");
  const group = receipt.expected.newGroups[0];
  const payload = FinalizedSchema.parse({
    input,
    assetId: group.assetId,
    publicationHash: identityHash(receipt),
  });
  const key = `movie-restoration-finalized-v4:${input.operationId}`;
  const prior = await context.db.applicationEvent.findUnique({
    where: { dedupeKey: key },
  });
  execution.assertActive();
  if (prior !== null) {
    if (
      prior.kind !== "movie_restoration_finalized_v4" ||
      identityHash(FinalizedSchema.parse(prior.payload)) !==
        identityHash(payload)
    )
      throw new Error(
        "Movie restoration finalization changed its original publication",
      );
    return;
  }
  const access = requireMovieChoiceAccess(
    (await networkMovieAccess(context, [input.mediaId])) ?? {},
  );
  execution.assertActive();
  await serializable(context.db, async (tx) => {
    const { target } = await lockMovieCommand(tx, input.scope);
    if (
      target?.generation !== input.generation ||
      target.availability !== "available" ||
      !target.desiredPresence ||
      target.intentionallyRemovedAt !== null ||
      target.automationEpoch !== group.ownershipEpoch ||
      !(await lockRuntimeAuthority(tx, group.ownershipEpoch))
    )
      throw new PlexBindingProtection("scope_changed");
    const current = await readMovieRestorePlexReceiptV1(tx, input, budget);
    if (identityHash(current) !== identityHash(receipt))
      throw new Error(
        "Movie restoration finalization lost its immutable Plex completion",
      );
    const lease = await tx.legacyWriterLease.findUniqueOrThrow({
      where: { id: "singleton" },
    });
    const freshness = plexBindingFreshness({
      observed: execution.observed,
      expiresAtMs: Math.min(execution.expiresAtMs, lease.expiresAt.getTime()),
      guards: [execution],
    });
    await bindPlexTransactionDeadline(tx, freshness);
    const binding = await readCurrentPlexBinding(
      tx,
      {
        scope: { mediaId: input.mediaId, edition: input.scope.edition },
        assetId: group.assetId,
        access: {
          serverMachineId: access.serverMachineId,
          sectionId: access.movieSectionId,
          sectionType: "movie",
        },
      },
      budget,
    );
    if (binding.status !== "current")
      throw new PlexBindingProtection(binding.reason);
    if (
      identityHash(binding.snapshot) !== identityHash(receipt.binding) ||
      identityHash(binding.association.group) !== identityHash(group)
    )
      throw new PlexBindingProtection("binding_changed");
    await queueMovieSubtitleTargetsV4(
      tx,
      {
        scope: input.scope,
        assetId: group.assetId,
        epoch: group.ownershipEpoch,
        access,
      },
      budget,
    );
    const notices = await queueMovieRestorationNoticesV4(
      tx,
      { input, access },
      budget,
    );
    const configured = requireMovieChoiceAccess(
      (await networkMovieAccess(context, [input.mediaId])) ?? {},
    );
    freshness.assertActive();
    if (identityHash(configured) !== identityHash(access))
      throw new PlexBindingProtection("wrong_section");
    await tx.applicationEvent.upsert({
      where: { dedupeKey: key },
      update: {},
      create: {
        dedupeKey: key,
        mediaId: input.mediaId,
        actorId: receipt.command.userId,
        kind: "movie_restoration_finalized_v4",
        payload,
      },
    });
    for (const guard of notices.guards) guard.assertActive();
    freshness.assertActive();
  });
  execution.assertActive();
}
