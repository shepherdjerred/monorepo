import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import {
  PlexBindingExpectedSchema,
  type PlexBindingExpected,
} from "#shared/plex-binding/expected.ts";
import {
  ReverifyPlexBindingInputSchema,
  ReverifyPlexBindingResultSchema,
  type ReverifyPlexBindingInput,
} from "#shared/plex-binding/activities.ts";
import {
  PlexBindingVerificationCompletionSchema,
  type VerifiedServingPlex,
} from "#shared/plex-binding/observations.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { commitVerifiedPlexBindings } from "./commit.ts";
import type { VerifiedMovieServingPlexV2 } from "#shared/movie-editions/plex-v2.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { movieInventoryParent } from "#infrastructure/movie-editions/plex/inventory/expected.ts";
import {
  loadPlexVerificationRequest,
  readPlexVerificationCompletion,
} from "./records.ts";

export async function queuePlexBindingReverification(
  tx: Prisma.TransactionClient,
  input: {
    expected: PlexBindingExpected;
    renewalBucket: number;
  },
  budget?: PublicationAuthorityReadBudget,
): Promise<{ operationId: string; created: boolean }> {
  const expected = PlexBindingExpectedSchema.parse(input.expected);
  const movie = movieInventoryParent(expected);
  if (!Number.isSafeInteger(input.renewalBucket) || input.renewalBucket < 0)
    throw new Error("Plex verification renewal bucket is invalid");
  if (
    expected.parents.some(
      (parent) =>
        parent.kind !== "existing_asset" &&
        parent.kind !== "existing_movie_asset_v2" &&
        parent.kind !== "restore" &&
        parent.kind !== "rollback",
    ) ||
    (movie === null &&
      expected.targets.some((target) => target.scope.edition !== "default")) ||
    expected.newGroups.length === 0
  )
    throw new Error(
      "Cold Plex reverification requires default existing physical authority",
    );
  const assetIds = expected.newGroups.map((group) => group.assetId);
  const expectedHash = identityHash(expected);
  const key = `plex-binding:${String(expected.recoveryEpoch)}:${expectedHash}:${String(input.renewalBucket)}`;
  const previous = await tx.operation.findUnique({
    where: { idempotencyKey: key },
  });
  if (previous !== null) {
    budget?.consume(1);
    const parent = await loadPlexVerificationRequest(
      tx,
      ReverifyPlexBindingInputSchema.parse(previous.payload),
      budget,
    );
    if (
      parent.request.expectedHash !== expectedHash ||
      identityHash(parent.expected) !== expectedHash
    )
      throw new Error("Plex verification idempotency parent changed");
    return { operationId: previous.id, created: false };
  }
  const operationId = crypto.randomUUID();
  const payload = ReverifyPlexBindingInputSchema.parse({
    schemaVersion: 1,
    kind: "reverify_plex_binding",
    operationId,
    recoveryEpoch: expected.recoveryEpoch,
    assetIds,
  });
  const targetId = assetIds[0];
  if (targetId === undefined)
    throw new Error("Plex verification omitted its target");
  await tx.operation.create({
    data: {
      id: operationId,
      idempotencyKey: key,
      kind: payload.kind,
      targetId,
      payload,
      outbox: { create: { kind: payload.kind, payload } },
    },
  });
  await tx.plexBindingVerificationRequest.create({
    data: {
      operationId,
      expected: z.record(z.string(), z.json()).parse(expected),
      expectedHash,
      recoveryEpoch: expected.recoveryEpoch,
      assetIds,
    },
  });
  return { operationId, created: true };
}

export async function loadPlexBindingVerificationRequest(
  tx: Prisma.TransactionClient,
  input: ReverifyPlexBindingInput,
  budget?: PublicationAuthorityReadBudget,
) {
  const result = await loadPlexVerificationRequest(tx, input, budget);
  return {
    expected: result.expected,
    expectedHash: result.request.expectedHash,
  };
}

export async function readPlexBindingVerificationCompletion(
  tx: Prisma.TransactionClient,
  input: ReverifyPlexBindingInput,
  budget?: PublicationAuthorityReadBudget,
) {
  return readPlexVerificationCompletion(tx, input, budget);
}

/** Called after the complete lock prelude; ACK readback is independent of current permission. */
export async function commitPlexBindingVerification(
  tx: Prisma.TransactionClient,
  input: {
    input: ReverifyPlexBindingInput;
    expected: PlexBindingExpected;
    verified: VerifiedServingPlex | VerifiedMovieServingPlexV2;
  },
  budget?: PublicationAuthorityReadBudget,
) {
  await tx.$queryRaw`SELECT id FROM "Operation" WHERE id=${input.input.operationId} FOR UPDATE`;
  const committed = await readPlexVerificationCompletion(
    tx,
    input.input,
    budget,
  );
  if (committed !== null) return committed;
  input.verified.freshness.assertActive();
  const parent = await loadPlexVerificationRequest(tx, input.input, budget);
  if (parent.request.expectedHash !== identityHash(input.expected))
    throw new Error("Plex verification request changed before commit");
  const bindings = await commitVerifiedPlexBindings(
    tx,
    {
      expected: parent.expected,
      verified: input.verified,
    },
    budget,
  );
  input.verified.freshness.assertActive();
  const completion = PlexBindingVerificationCompletionSchema.parse({
    schemaVersion: 1,
    operationId: input.input.operationId,
    recoveryEpoch: input.input.recoveryEpoch,
    expectedHash: parent.request.expectedHash,
    inputHash: identityHash(parent.input),
    verification: input.verified.verification,
    bindings,
    bindingCount: bindings.length,
    committedAt: new Date().toISOString(),
  });
  await tx.plexBindingVerificationReceipt.create({
    data: {
      operationId: input.input.operationId,
      expectedHash: parent.request.expectedHash,
      completion: z.record(z.string(), z.json()).parse(completion),
      completionHash: identityHash(completion),
    },
  });
  input.verified.freshness.assertActive();
  return ReverifyPlexBindingResultSchema.parse({
    status: "verified",
    bindingCount: bindings.length,
  });
}
