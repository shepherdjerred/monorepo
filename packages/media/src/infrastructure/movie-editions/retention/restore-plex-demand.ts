import { z } from "zod";
import type { Prisma, MediaIntent } from "#generated/prisma/client.ts";
import type { MovieRestoreReceiptV1 } from "#shared/movie-editions/restore-v1.ts";
import { readMovieChoice } from "#infrastructure/movie-editions/authority.ts";
import {
  lockMovieChoiceIdentities,
  type MovieChoiceAccess,
} from "#infrastructure/movie-editions/access.ts";
import type { MovieManagementInvocation } from "#infrastructure/movie-editions/management/invocation.ts";
import type { MovieChoiceFreshness } from "#infrastructure/movie-editions/freshness.ts";
import { readLibraryHandoffReceipt } from "#infrastructure/handoff/library-receipt.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";

/** Fresh serving consent is independent of the completed physical restore's original invocation. */
export async function captureMovieRestorePlexDemand(
  tx: Prisma.TransactionClient,
  input: {
    receipt: MovieRestoreReceiptV1;
    target: MediaIntent;
    access: MovieChoiceAccess;
  },
  invocation: MovieManagementInvocation,
) {
  const scope = input.receipt.scope;
  await lockMovieChoiceIdentities(tx, { mediaIds: [scope.mediaId] });
  const requests = await tx.mediaRequest.findMany({
    where: {
      mediaId: scope.mediaId,
      edition: scope.edition,
      active: true,
      direct: true,
      excluded: false,
    },
    orderBy: { id: "asc" },
  });
  if (requests.length === 0)
    return captureLibraryRestorePlexDemand(tx, input, invocation);
  const guards: MovieChoiceFreshness[] = [];
  for (const request of requests) {
    const choice = await readMovieChoice(tx, {
      requestId: request.id,
      expectedScope: scope,
      access: input.access,
      budget: invocation.budget,
    });
    if (choice.status !== "authorized")
      throw new PlexBindingProtection("scope_changed");
    guards.push(choice.freshness);
  }
  return {
    expiresAtMs: Math.min(...guards.map((guard) => guard.expiresAtMs)),
    assertActive: () => {
      for (const guard of guards) guard.assertActive();
    },
  };
}

async function captureLibraryRestorePlexDemand(
  tx: Prisma.TransactionClient,
  input: {
    receipt: MovieRestoreReceiptV1;
    target: MediaIntent;
    access: MovieChoiceAccess;
  },
  invocation: MovieManagementInvocation,
) {
  const marker = z
    .object({
      libraryAdoptionV2: z.object({
        schemaVersion: z.literal(2),
        planId: z.uuid(),
      }),
    })
    .parse(input.receipt.after.properties).libraryAdoptionV2;
  const row = await tx.mediaHandoffReceipt.findUniqueOrThrow({
    where: { planId: marker.planId },
  });
  invocation.budget.consume(1);
  const original = await readLibraryHandoffReceipt(
    tx,
    row.id,
    invocation.budget,
  );
  const scope = input.receipt.scope;
  await lockMovieChoiceIdentities(tx, {
    mediaIds: [scope.mediaId],
    extraUserIds: [original.receipt.actorId],
  });
  const owner = await tx.mediaUser.findUniqueOrThrow({
    where: { id: original.receipt.actorId },
  });
  invocation.budget.consume(1);
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
    original.receipt.recoveryEpoch !== input.receipt.after.ownershipEpoch ||
    !original.selection.scope.files.some(
      (file) =>
        file.assetId === input.receipt.after.id &&
        file.edition === scope.edition &&
        file.mediaIds.length === 1 &&
        file.mediaIds[0] === scope.mediaId,
    )
  )
    throw new PlexBindingProtection("ownership_changed");
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
    throw new PlexBindingProtection("wrong_section");
  return {
    expiresAtMs: invocation.execution.expiresAtMs,
    assertActive: invocation.execution.assertActive,
  };
}
