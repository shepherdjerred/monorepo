import { readRuntimeProof } from "#infrastructure/handoff/runtime-proof.ts";
import type { Prisma } from "#generated/prisma/client.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import { MediaError } from "#application/errors.ts";
import {
  selectMovieRetryV4,
  movieRetrySelectionDetails,
} from "#infrastructure/movie-editions/lifecycle/retry/retry-selection.ts";
import { movieRetryAuthorityV4 } from "#infrastructure/movie-editions/lifecycle/retry/retry-authority.ts";
import { assertNoPendingMovieRetryV4 } from "#infrastructure/movie-editions/lifecycle/retry/retry-command.ts";
import { lockMovieCommand } from "#infrastructure/movie-editions/locks.ts";
import { lockRuntimeAuthority } from "#infrastructure/handoff/authority.ts";
import { assertNoPublicationCompensationFence } from "#infrastructure/native-compensation/fence.ts";
import { networkMovieAccess } from "#automation/editions/access.ts";
import { requireMovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import { queueOperation, serializable } from "#automation/store.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import {
  bindPlexTransactionDeadline,
  plexBindingFreshness,
} from "#infrastructure/plex-binding/freshness.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { movieRetryTerminalV1 } from "./terminal.ts";
import { refreshMovieAttemptRequesterAccessV4 } from "#automation/movie-editions/requester-access.ts";
import {
  PLEX_EXCLUSION_PROOF_REQUIRED,
  PlexExclusionProofError,
  requireLibraryPlexExclusionDatabaseProof,
} from "#automation/plex-exclusion/proof.ts";

function requiresMovieRetryExclusionProof(
  selected: Awaited<ReturnType<typeof selectMovieRetryV4>>,
): boolean {
  return (
    selected.kind === "initial" ||
    (selected.kind === "continuation" &&
      selected.capture.continuation.phase === "prepared")
  );
}

async function readPriorExclusionBlockedMovieRetriesV4(
  tx: Prisma.TransactionClient,
  current: Awaited<ReturnType<typeof selectMovieRetryV4>>["source"],
  budget: PublicationAuthorityReadBudget,
): Promise<{ count: number; reconcilingIds: string[] }> {
  const excludedIds =
    current.attempt.coordinatorOperationId === null
      ? [current.attempt.operationId]
      : [current.attempt.operationId, current.attempt.coordinatorOperationId];
  const rows = await tx.operation.findMany({
    where: {
      id: { notIn: excludedIds },
      kind: "reconcile_movie_edition_v4",
      status: { in: ["reconciling", "completed"] },
      result: { path: ["reason"], equals: PLEX_EXCLUSION_PROOF_REQUIRED },
      OR: ["movieRetryV1", "movieRetryV2"].map((marker) => ({
        AND: [
          {
            payload: {
              path: [marker, "attemptId"],
              equals: current.attempt.id,
            },
          },
          {
            payload: {
              path: [marker, "previousCoordinatorOperationId"],
              equals: current.operation.id,
            },
          },
        ],
      })),
    },
    select: { id: true, status: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: budget.take,
  });
  budget.consume(rows.length);
  return {
    count: rows.length,
    reconcilingIds: rows
      .filter((row) => row.status === "reconciling")
      .map((row) => row.id),
  };
}

async function completeSupersededBlockedMovieRetriesV4(
  tx: Prisma.TransactionClient,
  reconcilingIds: readonly string[],
  queuedOperationId: string,
): Promise<void> {
  const patch = JSON.stringify({
    supersededByOperationId: queuedOperationId,
  });
  for (const id of reconcilingIds) {
    if (id === queuedOperationId) {
      continue;
    }
    await tx.$executeRaw`UPDATE "Operation" SET status = 'completed'::"OperationStatus", result = COALESCE(result, '{}'::jsonb) || ${patch}::jsonb, "updatedAt" = NOW() WHERE id = ${id} AND status = 'reconciling'::"OperationStatus"`;
  }
}

/** Real movie identity selects this route for default and named attempts; ordinary recovery remains literal. */
export async function queueTerminalMovieRetryV4(
  context: MediaAutomationContext,
  input: { attemptId: string; scope: MovieEditionScope },
) {
  const invocation = context.movieManagement;
  if (invocation === undefined)
    throw new Error(
      "Movie retry sweep requires its original invocation and allowance",
    );
  const { execution, budget } = invocation;
  execution.assertActive();
  try {
    const selected = await selectMovieRetryV4(
      context.db,
      { scope: input.scope, mode: "automatic" },
      budget,
    );
    const source = selected.source;
    if (source.attempt.id !== input.attemptId) return;
    if (requiresMovieRetryExclusionProof(selected)) {
      await requireLibraryPlexExclusionDatabaseProof(context.db, "movies");
    }
    const terminal = await movieRetryTerminalV1(
      context,
      {
        attemptId: source.attempt.id,
        previousCoordinatorOperationId: source.operation.id,
        reservedWithoutTorrent:
          source.attempt.state === "reserved" &&
          source.attempt.torrent === null,
      },
      execution,
    );
    if (terminal === null) return;
    if (source.attempt.state !== "completed")
      await refreshMovieAttemptRequesterAccessV4(
        context,
        input.scope,
        source.attempt,
      );
    const access = requireMovieChoiceAccess(
      (await networkMovieAccess(context, [input.scope.mediaId])) ?? {},
    );
    execution.assertActive();
    await serializable(context.db, async (tx) => {
      await lockMovieCommand(tx, input.scope);
      await assertNoPublicationCompensationFence(tx, {
        mediaIds: [input.scope.mediaId],
      });
      if (!(await lockRuntimeAuthority(tx, source.attempt.recoveryEpoch)))
        return;
      const currentSelection = await selectMovieRetryV4(
        tx,
        { scope: input.scope, mode: "automatic" },
        budget,
      );
      const current = currentSelection.source;
      if (
        identityHash(currentSelection.capture) !==
        identityHash(selected.capture)
      )
        return;
      if (requiresMovieRetryExclusionProof(currentSelection)) {
        await requireLibraryPlexExclusionDatabaseProof(tx, "movies");
      }
      const authority = await movieRetryAuthorityV4(tx, {
        scope: input.scope,
        source: current,
        access,
        invocation,
        budget,
        ...(current.attempt.state === "completed"
          ? { purpose: "completed_ack" as const }
          : {}),
      });
      await assertNoPendingMovieRetryV4(tx, current, budget);
      const blocked = await readPriorExclusionBlockedMovieRetriesV4(
        tx,
        current,
        budget,
      );
      const lease = await readRuntimeProof(tx);
      const freshness = plexBindingFreshness({
        observed: execution.observed,
        expiresAtMs: Math.min(
          execution.expiresAtMs,
          lease.expiresAt.getTime(),
          authority.expiresAtMs,
        ),
        guards: [execution, authority],
      });
      await bindPlexTransactionDeadline(tx, freshness);
      const configured = requireMovieChoiceAccess(
        (await networkMovieAccess(context, [input.scope.mediaId])) ?? {},
      );
      freshness.assertActive();
      if (identityHash(configured) !== identityHash(access))
        throw new MediaError(
          "plex_scope_unconfigured",
          "Movie retry configured library changed",
          409,
        );
      const baseKey = `movie-retry-recover-v4:${source.attempt.id}:${source.operation.id}:${terminal.root.runId}:${terminal.child?.runId ?? "unstarted"}`;
      const queuedOperationId = await queueOperation(tx, {
        key:
          blocked.count === 0
            ? baseKey
            : `${baseKey}:blocked:${String(blocked.count)}`,
        kind: "reconcile_movie_edition_v4",
        targetId: input.scope.mediaId,
        createdAt: new Date(),
        availableAt: new Date(),
        payload: {
          schemaVersion: 4,
          scope: input.scope,
          mediaId: input.scope.mediaId,
          generation: current.generation,
          ...movieRetrySelectionDetails(currentSelection),
        },
      });
      await completeSupersededBlockedMovieRetriesV4(
        tx,
        blocked.reconcilingIds,
        queuedOperationId,
      );
      freshness.assertActive();
    });
    execution.assertActive();
  } catch (error) {
    execution.assertActive();
    execution.signal.throwIfAborted();
    if (
      !(error instanceof MediaError) &&
      !(error instanceof PlexExclusionProofError)
    )
      throw error;
  }
}
