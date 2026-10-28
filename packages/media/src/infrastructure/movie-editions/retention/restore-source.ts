import { z } from "zod";
import { Prisma } from "#generated/prisma/client.ts";
import {
  MovieOperationV4Schema,
  type MovieOperationV4,
} from "#shared/movie-editions/automation-v4.ts";
import { MovieQuarantinePlexReceiptV2Schema } from "#shared/movie-editions/quarantine-v2.ts";
import { MovieRestoreManifestV1Schema } from "#shared/movie-editions/restore-v1.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { FileGuardError } from "#automation/files/types.ts";

export async function readMovieRestoreCommand(
  tx: Prisma.TransactionClient,
  input: MovieOperationV4,
  budget: PublicationAuthorityReadBudget,
) {
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: input.operationId },
  });
  budget.consume(1);
  const command = z
    .object({
      ...MovieOperationV4Schema.shape,
      kind: z.literal("restore_movie_edition_v4"),
      recoveryEpoch: z.int().nonnegative(),
    })
    .parse(operation.payload);
  if (
    operation.kind !== command.kind ||
    operation.targetId !== input.mediaId ||
    operation.id !== command.operationId ||
    identityHash(
      MovieOperationV4Schema.parse(
        z.object(MovieOperationV4Schema.shape).parse(command),
      ),
    ) !== identityHash(input)
  )
    throw new FileGuardError("restore_operation_invalid");
  return { operation, command };
}

/** Discovery fixes one original committed parent; final authority rereads it under the same exact scope locks. */
export async function readMovieRestoreSource(
  tx: Prisma.TransactionClient,
  input: MovieOperationV4,
  budget: PublicationAuthorityReadBudget,
) {
  const command = await readMovieRestoreCommand(tx, input, budget);
  const rows = await tx.retentionDecision.findMany({
    where: {
      mediaId: input.mediaId,
      edition: input.scope.edition,
      state: "quarantined",
      manifest: { not: Prisma.DbNull },
    },
    take: 2,
  });
  budget.consume(rows.length);
  const decision = rows[0];
  if (decision === undefined || rows.length !== 1)
    throw new FileGuardError("retention_decision_ambiguous");
  const parents = await tx.operation.findMany({
    where: {
      kind: "retain_movie_edition_v4",
      result: {
        path: ["movieQuarantinePlexReceiptV2", "decisionId"],
        equals: decision.id,
      },
    },
    take: 2,
  });
  budget.consume(parents.length);
  const parent = parents[0];
  if (parent === undefined || parents.length !== 1)
    throw new FileGuardError("reconciliation_required");
  const raw = z
    .object({ movieQuarantinePlexReceiptV2: z.json() })
    .parse(parent.result).movieQuarantinePlexReceiptV2;
  const receipt = MovieQuarantinePlexReceiptV2Schema.parse(raw);
  const manifest = MovieRestoreManifestV1Schema.parse(decision.manifest);
  const entry = manifest.assets[0];
  if (
    receipt.operationId !== parent.id ||
    receipt.decisionId !== decision.id ||
    identityHash(receipt.scope) !== identityHash(input.scope) ||
    receipt.recoveryEpoch !== command.command.recoveryEpoch ||
    receipt.manifestHash !== identityHash(decision.manifest) ||
    entry.assetId !== receipt.groups[0].assetId ||
    entry.assetVersion !== receipt.groups[0].assetVersion ||
    decision.version !== receipt.decisions[0].quarantinedVersion
  )
    throw new FileGuardError("restore_parent_changed");
  return {
    ...command,
    decision,
    parent,
    receipt,
    receiptHash: identityHash(raw),
    manifest,
    entry,
  };
}
export type MovieRestoreSource = Awaited<
  ReturnType<typeof readMovieRestoreSource>
>;
