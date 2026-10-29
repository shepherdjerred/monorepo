import { z } from "zod";
import type { MediaIntent, Prisma } from "#generated/prisma/client.ts";
import type { MovieOperationV4 } from "#shared/movie-editions/automation-v4.ts";
import { readMovieChoice } from "#infrastructure/movie-editions/authority.ts";
import {
  lockMovieChoiceIdentities,
  type MovieChoiceAccess,
} from "#infrastructure/movie-editions/access.ts";
import type { MovieManagementInvocation } from "#infrastructure/movie-editions/management/invocation.ts";
import type { MovieChoiceFreshness } from "#infrastructure/movie-editions/freshness.ts";
import { readLibraryHandoffReceipt } from "#infrastructure/handoff/library-receipt.ts";
import { FileGuardError } from "#automation/files/types.ts";
import type { MovieRestoreSource } from "./restore-source.ts";

/** A restore needs current scoped consent, or the actual original library owner's still-active policy. */
export async function captureMovieRestoreDemand(
  tx: Prisma.TransactionClient,
  input: {
    command: MovieOperationV4;
    source: MovieRestoreSource;
    target: MediaIntent;
    access: MovieChoiceAccess;
  },
  invocation: MovieManagementInvocation,
) {
  await lockMovieChoiceIdentities(tx, { mediaIds: [input.command.mediaId] });
  const requests = await tx.mediaRequest.findMany({
    where: {
      mediaId: input.command.mediaId,
      edition: input.command.scope.edition,
      active: true,
      excluded: false,
      direct: true,
    },
    orderBy: { id: "asc" },
  });
  if (requests.length === 0)
    return captureLibraryRestoreDemand(tx, input, invocation);
  const guards: MovieChoiceFreshness[] = [];
  for (const request of requests) {
    const choice = await readMovieChoice(tx, {
      requestId: request.id,
      expectedScope: input.command.scope,
      access: input.access,
      budget: invocation.budget,
    });
    if (choice.status !== "authorized")
      throw new FileGuardError("movie_edition_choice_changed");
    guards.push(choice.freshness);
  }
  return {
    expiresAtMs: Math.min(...guards.map((guard) => guard.expiresAtMs)),
    assertActive: () => {
      for (const guard of guards) guard.assertActive();
    },
  };
}

async function captureLibraryRestoreDemand(
  tx: Prisma.TransactionClient,
  input: {
    command: MovieOperationV4;
    source: MovieRestoreSource;
    target: MediaIntent;
    access: MovieChoiceAccess;
  },
  invocation: MovieManagementInvocation,
) {
  const asset = await tx.libraryAsset.findUniqueOrThrow({
    where: { id: input.source.entry.assetId },
  });
  invocation.budget.consume(1);
  const marker = z
    .object({
      libraryAdoptionV2: z.object({
        schemaVersion: z.literal(2),
        planId: z.uuid(),
      }),
    })
    .parse(asset.properties).libraryAdoptionV2;
  const row = await tx.mediaHandoffReceipt.findUniqueOrThrow({
    where: { planId: marker.planId },
  });
  invocation.budget.consume(1);
  const original = await readLibraryHandoffReceipt(
    tx,
    row.id,
    invocation.budget,
  );
  await lockMovieChoiceIdentities(tx, {
    mediaIds: [input.command.mediaId],
    extraUserIds: [original.receipt.actorId],
  });
  const owner = await tx.mediaUser.findUniqueOrThrow({
    where: { id: original.receipt.actorId },
  });
  invocation.budget.consume(1);
  const scope = input.command.scope;
  const policies = original.selection.scope.media.filter(
    (policy) => policy.mediaId === scope.mediaId,
  );
  const policy = policies[0];
  if (
    owner.role !== "owner" ||
    owner.restricted ||
    policies.length !== 1 ||
    policy?.profileId == null ||
    !policy.monitored ||
    input.target.profileId !== policy.profileId ||
    original.receipt.recoveryEpoch !== input.source.receipt.recoveryEpoch ||
    !original.selection.scope.files.some(
      (file) =>
        file.assetId === asset.id &&
        file.edition === scope.edition &&
        file.mediaIds.length === 1 &&
        file.mediaIds[0] === scope.mediaId,
    )
  )
    throw new FileGuardError("library_management_unconfirmed");
  const plex = z
    .object({
      plex: z.array(
        z.object({
          mediaId: z.string(),
          edition: z.string(),
          sectionId: z.string(),
        }),
      ),
    })
    .parse(original.selection.networkEvidence).plex;
  if (
    !plex.some(
      (value) =>
        value.mediaId === scope.mediaId &&
        value.edition === scope.edition &&
        value.sectionId === input.access.movieSectionId,
    )
  )
    throw new FileGuardError("wrong_section");
  return {
    expiresAtMs: invocation.execution.expiresAtMs,
    assertActive: invocation.execution.assertActive,
  };
}
