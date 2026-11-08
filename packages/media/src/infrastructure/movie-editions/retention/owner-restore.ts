import type {
  MediaIntent,
  Operation,
  Prisma,
} from "#generated/prisma/client.ts";
import type { MovieOperationV4 } from "#shared/movie-editions/lifecycle/automation-v4.ts";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import type { MovieManagementInvocation } from "#infrastructure/movie-editions/management/invocation.ts";
import { readMovieOwnerLifecycleSourceV1 } from "#infrastructure/movie-editions/lifecycle/owner-source.ts";
import { captureMovieOwnerPermissionV1 } from "#infrastructure/movie-editions/lifecycle/owner-permission.ts";
import { FileGuardError } from "#automation/files/types.ts";

/** A distinct explicit Restore authorizes the current owner; old personal/library sources remain independent. */
export async function captureExplicitOwnerMovieRestoreV1(
  tx: Prisma.TransactionClient,
  input: {
    operation: Operation;
    command: MovieOperationV4;
    target: MediaIntent;
    access: MovieChoiceAccess;
  },
  invocation: MovieManagementInvocation,
) {
  const source = readMovieOwnerLifecycleSourceV1(
    input.operation,
    input.command,
    "restore",
  );
  if (source === null) return null;
  if (
    input.target.version !== source.applied.targetVersion ||
    input.target.generation !== source.applied.generation ||
    input.target.automationEpoch !== source.applied.recoveryEpoch ||
    !input.target.desiredPresence ||
    !input.target.monitoring ||
    input.target.intentionallyRemovedAt !== null
  )
    throw new FileGuardError("movie_owner_action_changed");
  return captureMovieOwnerPermissionV1(tx, source.actorId, {
    access: input.access,
    invocation,
  });
}
