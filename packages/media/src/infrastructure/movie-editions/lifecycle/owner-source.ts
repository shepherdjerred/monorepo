import { z } from "zod";
import type { Operation } from "#generated/prisma/client.ts";
import type { MovieOperationV4 } from "#shared/movie-editions/lifecycle/automation-v4.ts";
import {
  MovieOwnerRemovalV1Schema,
  MovieOwnerRestoreV1Schema,
} from "#shared/movie-editions/lifecycle/owner-lifecycle-v1.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { FileGuardError } from "#automation/files/types.ts";
import { MovieEditionScopeSchema } from "#shared/movie-editions/registry.ts";

/** Caller supplies the actual queried command, under its required operation lock. */
export function readMovieOwnerLifecycleSourceV1(
  operation: Operation,
  input: MovieOperationV4,
  action: "remove" | "restore",
) {
  const header = z
    .object({
      ownerRemovalV1: z.unknown().optional(),
      ownerRestoreV1: z.unknown().optional(),
    })
    .parse(operation.payload);
  const raw =
    action === "remove" ? header.ownerRemovalV1 : header.ownerRestoreV1;
  if (raw === undefined) return null;
  if (
    header.ownerRemovalV1 !== undefined &&
    header.ownerRestoreV1 !== undefined
  )
    throw new Error("Owner movie command has conflicting action sources");
  const source =
    action === "remove"
      ? MovieOwnerRemovalV1Schema.parse(raw)
      : MovieOwnerRestoreV1Schema.parse(raw);
  const command = z
    .object({
      schemaVersion: z.literal(4),
      operationId: z.uuid(),
      mediaId: z.uuid(),
      generation: z.int().nonnegative(),
      recoveryEpoch: z.int().nonnegative(),
      scope: MovieEditionScopeSchema,
    })
    .parse(operation.payload);
  if (
    operation.id !== input.operationId ||
    operation.id !== command.operationId ||
    operation.kind !==
      (action === "remove"
        ? "retain_movie_edition_v4"
        : "restore_movie_edition_v4") ||
    operation.targetId !== input.mediaId ||
    operation.userId !== source.actorId ||
    command.mediaId !== input.mediaId ||
    command.generation !== input.generation ||
    source.applied.generation !== input.generation ||
    source.applied.recoveryEpoch !== command.recoveryEpoch ||
    identityHash(command.scope) !== identityHash(input.scope) ||
    identityHash(source.request.scope) !== identityHash(input.scope) ||
    source.applied.mediaVersion !== source.request.expected.mediaVersion + 1 ||
    source.applied.targetVersion !== source.request.expected.targetVersion + 1
  )
    throw new FileGuardError("movie_owner_action_changed");
  return source;
}
