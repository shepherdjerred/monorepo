import { z } from "zod";
import type { Operation, Prisma } from "#generated/prisma/client.ts";
import type { MovieRemovalCompletionV4 } from "#shared/movie-editions/removal-v4.ts";
import { MovieQuarantinePlexReceiptV2Schema } from "#shared/movie-editions/quarantine-v2.ts";
import { RemovalPlanSchema } from "#automation/files/types.ts";
import { moviePurgeCommand } from "#automation/movie-editions/retention/purge-parent.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";

/** Literal committed database history only. Network never inspects removal paths or journals. */
export async function readMovieRemovalSourceV4(
  tx: Prisma.TransactionClient,
  input: MovieRemovalCompletionV4,
  budget: PublicationAuthorityReadBudget,
) {
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: input.operationId },
  });
  budget.consume(1);
  const command = moviePurgeCommand(operation, input);
  const decision = await tx.retentionDecision.findUniqueOrThrow({
    where: { id: input.decisionId },
  });
  budget.consume(1);
  const quarantine = await removalQuarantineCommand(
    tx,
    { input, operation },
    budget,
  );
  const receipt = MovieQuarantinePlexReceiptV2Schema.parse(
    z
      .object({ movieQuarantinePlexReceiptV2: z.json() })
      .parse(quarantine.result).movieQuarantinePlexReceiptV2,
  );
  const original = moviePurgeCommand(quarantine, {
    ...input,
    operationId: quarantine.id,
  });
  const manifest = RemovalPlanSchema.parse(decision.manifest);
  const entry = manifest.assets[0];
  if (
    receipt.operationId !== quarantine.id ||
    receipt.decisionId !== decision.id ||
    identityHash(receipt.scope) !== identityHash(input.scope) ||
    receipt.recoveryEpoch !== command.recoveryEpoch ||
    original.recoveryEpoch !== command.recoveryEpoch ||
    original.generation !== command.generation ||
    decision.generation !== command.generation ||
    decision.mediaId !== input.scope.mediaId ||
    decision.edition !== input.scope.edition ||
    receipt.committedAt !== decision.quarantinedAt?.toISOString() ||
    decision.purgeAfter?.getTime() !==
      Date.parse(receipt.committedAt) + 7 * 86_400_000 ||
    identityHash(manifest) !== receipt.manifestHash
  )
    throw new Error(
      "Movie removal notice lost its literal quarantine or command parent",
    );
  assertRemovalManifest({
    input,
    receipt,
    entry,
    manifest,
    generation: command.generation,
  });
  if (input.stage === "purged") {
    const terminal = z
      .object({ purgeOperationId: z.uuid() })
      .parse(decision.evidence);
    if (
      decision.state !== "purged" ||
      terminal.purgeOperationId !== operation.id
    )
      throw new Error(
        "Movie removal notice has no actual completed purge command",
      );
  }
  return {
    decision,
    receipt,
    command,
    eventKind:
      input.stage === "quarantined"
        ? ("files_quarantined" as const)
        : ("files_purged" as const),
    sourceHash: identityHash({
      source: input,
      command: {
        id: operation.id,
        kind: operation.kind,
        targetId: operation.targetId,
        userId: operation.userId,
        payloadHash: identityHash(operation.payload),
      },
      quarantineReceiptHash: identityHash(receipt),
    }),
    generation: command.generation,
    recoveryEpoch: receipt.recoveryEpoch,
    asset: {
      id: receipt.groups[0].assetId,
      version:
        receipt.groups[0].assetVersion +
        (input.stage === "quarantined" ? 1 : 2),
      checksum: receipt.groups[0].checksum,
    },
  };
}

async function removalQuarantineCommand(
  tx: Prisma.TransactionClient,
  input: { input: MovieRemovalCompletionV4; operation: Operation },
  budget: PublicationAuthorityReadBudget,
) {
  if (input.input.stage === "quarantined") return input.operation;
  const rows = await tx.operation.findMany({
    where: {
      kind: "retain_movie_edition_v4",
      result: {
        path: ["movieQuarantinePlexReceiptV2", "decisionId"],
        equals: input.input.decisionId,
      },
    },
    take: 2,
  });
  budget.consume(rows.length);
  if (rows.length !== 1 || rows[0] === undefined)
    throw new Error("Movie removal quarantine parent is ambiguous");
  return rows[0];
}

function assertRemovalManifest(input: {
  input: MovieRemovalCompletionV4;
  receipt: z.infer<typeof MovieQuarantinePlexReceiptV2Schema>;
  manifest: z.infer<typeof RemovalPlanSchema>;
  entry: z.infer<typeof RemovalPlanSchema>["assets"][number] | undefined;
  generation: number;
}) {
  const { entry, manifest, receipt } = input;
  if (
    entry === undefined ||
    manifest.assets.length !== 1 ||
    entry.libraryKind !== "movies" ||
    entry.assetId !== receipt.groups[0].assetId ||
    entry.assetVersion !== receipt.groups[0].assetVersion ||
    entry.checksum !== receipt.groups[0].checksum ||
    identityHash(entry.mediaIds) !==
      identityHash([input.input.scope.mediaId]) ||
    identityHash(entry.generations) !==
      identityHash({ [input.input.scope.mediaId]: input.generation })
  )
    throw new Error(
      "Movie removal notice manifest lost its exact physical scope",
    );
}
