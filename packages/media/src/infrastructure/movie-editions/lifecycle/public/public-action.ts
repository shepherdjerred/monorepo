import type { Prisma } from "#generated/prisma/client.ts";
import type { MediaActor } from "#application/auth.ts";
import { MediaError } from "#application/errors.ts";
import type { MovieLifecycleCommandV4 } from "#shared/movie-editions/lifecycle/lifecycle-v4.ts";
import {
  lockMovieCommand,
  movieCommandConflict,
} from "#infrastructure/movie-editions/locks.ts";
import { commandAutomationEpoch } from "#infrastructure/handoff/authority.ts";
import { invalidateMovieRetentionV4 } from "#infrastructure/movie-editions/lifecycle/invalidate.ts";
import {
  applyMovieHoldV4,
  authorizeMovieActionV4,
} from "./public-action-authority.ts";
import {
  bindPlexTransactionDeadline,
  plexBindingFreshness,
} from "#infrastructure/plex-binding/freshness.ts";
import { readMovieActionDemandV4 } from "./public-demand.ts";
import {
  validateMovieActionFilesV4,
  movieActionIntentV4,
  movieActionOperationV4,
} from "./public-action-plan.ts";

type ActionContext = Parameters<typeof authorizeMovieActionV4>[3] & {
  keepDays: number;
};

export async function applyMovieActionV4(
  tx: Prisma.TransactionClient,
  actor: MediaActor,
  input: MovieLifecycleCommandV4,
  context: Omit<ActionContext, "externalIds">,
) {
  const action = input.command.action;
  const protectionOnly = ["keep", "pin", "unpin"].includes(action);
  const { media, target } = await lockMovieCommand(
    tx,
    input.scope,
    protectionOnly ? { personalProtection: true } : undefined,
  );
  if (
    target === null ||
    media.version !== input.expected.mediaVersion ||
    target.version !== input.expected.targetVersion
  )
    throw movieCommandConflict();
  const epoch = await commandAutomationEpoch(tx);
  const renewal = ["remove", "restore", "select_release"].includes(action);
  if (renewal && epoch < 0)
    throw new MediaError(
      "runtime_protected",
      "Media automation is paused",
      409,
    );
  const authority = await authorizeMovieActionV4(tx, actor, input, {
    ...context,
    externalIds: media.externalIds,
  });
  await bindPlexTransactionDeadline(tx, authority.freshness);
  const current = await tx.assetCoverage.findMany({
    where: { mediaId: media.id, edition: input.scope.edition, current: true },
    include: { asset: true },
    take: 2,
  });
  if (current.length > 1)
    throw new Error("Movie action has multiple current video assets");
  const asset = current[0]?.asset;
  await validateMovieActionFilesV4(tx, input, asset, context.invocation.budget);
  const demand = await actionDemandV4(tx, input, {
    target,
    epoch,
    assetState: asset?.state,
    context,
  });
  const freshness = plexBindingFreshness({
    observed: context.invocation.execution.observed,
    expiresAtMs: Math.min(
      authority.freshness.expiresAtMs,
      demand?.expiresAtMs ?? Infinity,
    ),
    guards: [authority.freshness, ...(demand === null ? [] : [demand])],
  });
  await bindPlexTransactionDeadline(tx, freshness);
  await applyMovieHoldV4(tx, actor, input, context.keepDays);
  const updated = await tx.mediaItem.update({
    where: { id: media.id },
    data: { version: { increment: 1 } },
  });
  const intent = await tx.mediaIntent.update({
    where: {
      mediaId_edition: { mediaId: media.id, edition: input.scope.edition },
    },
    data: movieActionIntentV4(action, epoch),
  });
  await invalidateMovieRetentionV4(tx, input.scope);
  const applied = {
    mediaVersion: updated.version,
    targetVersion: intent.version,
  };
  const source = {
    actorId: actor.id,
    applied: {
      ...applied,
      generation: intent.generation,
      recoveryEpoch: epoch,
    },
  };
  // A hold has no authority to manufacture demand or make owner-only quarantined bytes playable.
  const restoreForHold =
    ["keep", "pin"].includes(action) &&
    asset?.state === "quarantined" &&
    demand !== null;
  freshness.assertActive();
  return {
    applied,
    freshness,
    command: movieActionOperationV4(input, source, {
      owner: authority.owner,
      restoreForHold,
    }),
  };
}

async function actionDemandV4(
  tx: Prisma.TransactionClient,
  input: MovieLifecycleCommandV4,
  current: {
    target: Awaited<ReturnType<typeof lockMovieCommand>>["target"];
    epoch: number;
    assetState: string | undefined;
    context: Omit<ActionContext, "externalIds">;
  },
) {
  const action = input.command.action;
  const holdRestore =
    ["keep", "pin"].includes(action) && current.assetState === "quarantined";
  if (
    current.target === null ||
    current.context.movieAccess === null ||
    current.epoch < 0 ||
    (!holdRestore && action !== "select_release")
  )
    return null;
  const demand = await readMovieActionDemandV4(
    tx,
    {
      scope: input.scope,
      target: current.target,
      epoch: current.epoch,
      access: current.context.movieAccess,
    },
    current.context.invocation.budget,
  );
  if (action !== "select_release") return demand;
  if (demand === null)
    throw new MediaError(
      "request_required",
      "Select a release only for current personal or approved library demand",
      409,
    );
  const reservation = await tx.acquisitionReservation.findUnique({
    where: {
      mediaId_edition: {
        mediaId: input.scope.mediaId,
        edition: input.scope.edition,
      },
    },
  });
  if (reservation !== null)
    throw new MediaError(
      "native_operation_unsettled",
      "Finish or recover the current acquisition before selecting a different release",
      409,
    );
  return demand;
}
