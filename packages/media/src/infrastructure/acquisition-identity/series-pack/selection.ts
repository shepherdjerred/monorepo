import { z } from "zod";
import type {
  Operation,
  Prisma,
  ReleaseCandidate,
} from "#generated/prisma/client.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import type { LibraryManagementInvocation } from "#infrastructure/acquisition-identity/library-policy.ts";
import {
  SeriesPackSelectionV1Schema,
  type CapturedSeriesPackV1,
} from "#shared/acquisition/series-pack-v1.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { lockAcquisitionMedia } from "#infrastructure/acquisition-identity/locks.ts";
import { bindPlexTransactionDeadline } from "#infrastructure/plex-binding/freshness.ts";
import { loadSeriesPackInterpretationV1 } from "./parent.ts";
import { seriesPackCatalogV1, seriesPackChanged } from "./catalog.ts";

/** Absence keeps the exact original operationCoverage/default-parser behavior. */
export function readSeriesPackSelectionV1(operation: Operation) {
  const value = z
    .object({ seriesPackSelectionV1: SeriesPackSelectionV1Schema.optional() })
    .nullable()
    .parse(operation.result)?.seriesPackSelectionV1;
  if (value === undefined) return null;
  const command = z
    .object({
      operationId: z.uuid(),
      mediaId: z.uuid(),
      generation: z.int().nonnegative(),
    })
    .parse(operation.payload);
  if (
    !["reconcile_media", "acquire_release"].includes(operation.kind) ||
    operation.id !== command.operationId ||
    operation.targetId !== command.mediaId ||
    value.primaryMediaId !== command.mediaId ||
    value.generation !== command.generation ||
    !value.selected.attributes.mediaIds.includes(command.mediaId)
  )
    throw new Error(
      "Series pack selection lost its literal coordinator command",
    );
  return value;
}

export async function selectedSeriesPackCandidateV1(
  tx: Prisma.TransactionClient,
  input: { operation: Operation; release: ReleaseCandidate },
  budget: PublicationAuthorityReadBudget,
) {
  const selection = readSeriesPackSelectionV1(input.operation);
  if (selection === null) return null;
  if (selection.releaseId !== input.release.id)
    throw seriesPackChanged("Selected source differs from its coordinator");
  const parent = await loadSeriesPackInterpretationV1(
    tx,
    selection.selected,
    budget,
    input.release,
  );
  if (parent.value.releaseId !== input.release.id)
    throw seriesPackChanged(
      "Selected interpretation belongs to another provider source",
    );
  return { ...parent, selection };
}

/** This is a new current selection checkpoint; original command payload and source hashes never change. */
export async function recordSeriesPackSelectionV1(
  tx: Prisma.TransactionClient,
  input: {
    operationId: string;
    primaryMediaId: string;
    generation: number;
    captured: CapturedSeriesPackV1;
  },
  invocation: LibraryManagementInvocation,
) {
  invocation.freshness.assertActive();
  await lockAcquisitionMedia(tx, input.captured.attributes.mediaIds);
  await tx.$queryRaw`SELECT id FROM "Operation" WHERE id=${input.operationId} FOR UPDATE`;
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: input.operationId },
  });
  invocation.budget.consume(1);
  const parent = await loadSeriesPackInterpretationV1(
    tx,
    input.captured,
    invocation.budget,
  );
  const value = SeriesPackSelectionV1Schema.parse({
    schemaVersion: 1,
    releaseId: parent.value.releaseId,
    primaryMediaId: input.primaryMediaId,
    generation: input.generation,
    selected: parent.captured,
  });
  const prior = readSeriesPackSelectionV1(operation);
  if (prior !== null) {
    if (identityHash(prior) !== identityHash(value))
      throw seriesPackChanged(
        "A coordinator cannot replace its original selected interpretation",
      );
    return prior;
  }
  const current = await seriesPackCatalogV1(
    tx,
    { primaryMediaId: input.primaryMediaId, range: parent.value.range },
    invocation.budget,
  );
  const command = z
    .object({
      operationId: z.uuid(),
      mediaId: z.uuid(),
      generation: z.int().nonnegative(),
    })
    .parse(operation.payload);
  if (
    !["reconcile_media", "acquire_release"].includes(operation.kind) ||
    operation.targetId !== input.primaryMediaId ||
    command.operationId !== input.operationId ||
    command.mediaId !== input.primaryMediaId ||
    command.generation !== input.generation ||
    current.target.generation !== input.generation ||
    !current.target.desiredPresence ||
    !current.target.monitoring ||
    current.target.intentionallyRemovedAt !== null ||
    current.canonicalHash !== parent.value.canonicalHash ||
    identityHash(current.profile) !== identityHash(parent.value.profile)
  )
    throw seriesPackChanged(
      "Original coordinator generation or whole-pack interpretation changed",
    );
  await bindPlexTransactionDeadline(tx, invocation.freshness);
  await tx.$executeRaw`UPDATE "Operation" SET result=COALESCE(result,'{}'::jsonb) || jsonb_build_object('seriesPackSelectionV1',${JSON.stringify(value)}::jsonb) WHERE id=${input.operationId}`;
  invocation.freshness.assertActive();
  return value;
}
