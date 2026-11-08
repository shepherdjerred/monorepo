import type { Prisma } from "#generated/prisma/client.ts";
import { z } from "zod";
import type { MovieRollbackRetryOperationV1 } from "#shared/movie-editions/rollback/retry.ts";
import type { MovieRollbackExecution } from "#shared/movie-editions/rollback/execution.ts";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import type { MovieManagementInvocation } from "#infrastructure/movie-editions/management/invocation.ts";
import { lockMovieCommand } from "#infrastructure/movie-editions/locks.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { plexBindingFreshness } from "#infrastructure/plex-binding/freshness.ts";
import { FileGuardError } from "#automation/files/types.ts";
import { readMovieRollbackRetryCommandV1 } from "./retry-command-records.ts";
import { readMovieRollbackRetryParentV1 } from "./retry-parent.ts";
import { readMovieRollbackHandoffV1 } from "./handoff-records.ts";
import { captureMovieRollbackRetryContextV1 } from "./retry-context.ts";
import { readMovieRollbackPlexV1 } from "#infrastructure/movie-editions/rollback/records.ts";

/** Canonical → original rollback → new command → complete assets is the same
 * producer lock order used by the inverse. Only the grant phase writes here. */
export async function captureMovieRollbackHandoffV1(
  tx: Prisma.TransactionClient,
  input: {
    input: MovieRollbackRetryOperationV1;
    owner: MovieRollbackExecution;
    access: MovieChoiceAccess;
    invocation: MovieManagementInvocation;
  },
) {
  const { invocation } = input;
  const locked = await lockMovieCommand(tx, input.input.scope);
  invocation.budget.consume(locked.target === null ? 1 : 2);
  await tx.$queryRaw`SELECT o.id FROM "Operation" o WHERE o.id=${input.input.resume.operationId} FOR UPDATE`;
  await tx.$queryRaw`SELECT o.id FROM "Operation" o WHERE o.id=${input.input.operationId} FOR UPDATE`;
  const command = await readMovieRollbackRetryCommandV1(
    tx,
    input.input,
    invocation.budget,
  );
  const parent = await readMovieRollbackRetryParentV1(
    tx,
    input.input,
    invocation.budget,
  );
  if (
    identityHash(command.payload.invocation) !==
    identityHash(parent.intent.invocation)
  )
    throw new Error(
      "Movie rollback retry invocation differs from its actual admitted source",
    );
  if (
    z
      .object({ movieRollbackPlexV1: z.unknown().optional() })
      .nullable()
      .parse(parent.operation.result)?.movieRollbackPlexV1 !== undefined
  ) {
    if (
      (await readMovieRollbackPlexV1(
        tx,
        parent.intent.invocation,
        invocation.budget,
      )) === null
    )
      throw new Error(
        "Completed rollback retry lost its actual serving receipt",
      );
    return { status: "completed" as const, parent, command };
  }
  const current = await readMovieRollbackHandoffV1(
    tx,
    parent,
    invocation.budget,
  );
  if (current?.command.operation.id === command.operation.id) {
    if (
      current.handoff.owner.workflowId !== input.owner.workflowId ||
      current.handoff.owner.runId !== input.owner.runId
    )
      throw new FileGuardError("movie_rollback_execution_owner_changed");
    return { status: "owned" as const, parent, command, current };
  }
  const captured = await captureMovieRollbackRetryContextV1(tx, {
    parent,
    actorId: command.payload.actorId,
    access: input.access,
    invocation,
  });
  if (
    identityHash(captured.expected) !==
    identityHash(command.payload.retry.expected)
  )
    throw new FileGuardError("movie_rollback_handoff_review_changed");
  const writer = await tx.legacyWriterLease.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  invocation.budget.consume(1);
  if (
    writer.revokedAt !== null ||
    writer.recoveryEpoch !== parent.intent.authority.recoveryEpoch ||
    writer.observedAt.getTime() > Date.now()
  )
    throw new FileGuardError("runtime_protected");
  const freshness = plexBindingFreshness({
    observed: invocation.execution.observed,
    expiresAtMs: Math.min(
      invocation.execution.expiresAtMs,
      captured.authority.freshness.expiresAtMs,
      writer.expiresAt.getTime(),
    ),
    guards: [invocation.execution, captured.authority.freshness],
  });
  freshness.assertActive();
  return {
    status: "prepared" as const,
    parent,
    command,
    captured,
    freshness,
    writerExpiresAtMs: writer.expiresAt.getTime(),
  };
}
