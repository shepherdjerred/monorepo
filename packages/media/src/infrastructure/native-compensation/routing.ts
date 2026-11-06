import type { SeriesPackNativeCommandInvocationV1 } from "./series-pack/command-invocation.ts";
import { isSeriesPackNativeDescriptorV2 } from "./series-pack/physical.ts";
import { queueSeriesPackNativePublicationV1 } from "./series-pack/publication/queue.ts";
import { NativeCompensationProtection } from "./protection.ts";
import { bindPlexTransactionDeadline } from "#infrastructure/plex-binding/freshness.ts";
import { Prisma } from "#generated/prisma/client.ts";
import { queueCompensatedPublication } from "./publication.ts";
import { MediaError } from "#application/errors.ts";
import { z } from "zod";
import {
  compensationGroupMedia as readCompensationGroupMedia,
  assertCompensationGroupUnchanged as assertReadCompensationGroupUnchanged,
} from "./group.ts";

export async function compensationGroupMedia(
  tx: Prisma.TransactionClient,
  mediaIds: readonly string[],
): Promise<string[]> {
  return readCompensationGroupMedia(tx, mediaIds);
}

export async function assertCompensationGroupUnchanged(
  tx: Prisma.TransactionClient,
  original: readonly string[],
  locked: readonly string[],
): Promise<void> {
  await assertReadCompensationGroupUnchanged(tx, original, locked);
}

export async function pendingCompensationGroups(
  tx: Prisma.TransactionClient,
  mediaIds: readonly string[],
) {
  const rows = await tx.nativePublicationCompensationContinuation.findMany({
    where: {
      fenceRelease: { equals: Prisma.DbNull },
      mediaIds: { hasSome: [...mediaIds] },
    },
    orderBy: { recoveryEpoch: "desc" },
    take: 101,
  });
  if (rows.length > 100)
    throw new Error("Compensation group history exceeds bound");
  const current = [];
  const transitions = new Set<string>();
  for (const row of rows) {
    if (transitions.has(row.transitionId)) continue;
    transitions.add(row.transitionId);
    current.push(row);
  }
  return current;
}

/** Called after all declarations and hold releases, under the complete household lock set. */
export async function queueHouseholdCompensations(
  tx: Prisma.TransactionClient,
  input: { mediaIds: readonly string[]; triggerKey: string },
  invocation?: SeriesPackNativeCommandInvocationV1,
): Promise<void> {
  const groups = await pendingCompensationGroups(tx, input.mediaIds);
  for (const row of groups) {
    if (row.mediaIds.some((id) => !input.mediaIds.includes(id)))
      throw new Error(
        "Household compensation release omitted shared group leaves",
      );
    if (isSeriesPackNativeDescriptorV2(row.descriptor)) {
      if (invocation === undefined)
        throw new NativeCompensationProtection(
          "series_pack_household_original_budget_required",
        );
      invocation.budget.consume(1);
      await bindPlexTransactionDeadline(tx, invocation.freshness);
      await queueSeriesPackNativePublicationV1(
        tx,
        {
          continuationId: row.id,
          triggerKey: input.triggerKey,
          observed: invocation.observed,
          freshness: invocation.freshness,
        },
        invocation.budget,
      );
      continue;
    }
    await queueCompensatedPublication(tx, {
      continuationId: row.id,
      triggerKey: input.triggerKey,
    });
  }
}

/** Metadata demand can wait without minting an acquisition or obsolete attempt workflow. */
export async function routeCompensationDemand(
  tx: Prisma.TransactionClient,
  input: {
    kind: string;
    targetId: string;
    payload: Prisma.InputJsonObject;
    key: string;
    userId?: string;
  },
): Promise<string | null> {
  if (
    !["restore_media", "reconcile_media", "acquire_release"].includes(
      input.kind,
    )
  )
    return null;
  const target = z
    .object({ mediaId: z.uuid(), generation: z.int() })
    .parse(input.payload);
  if (target.mediaId !== input.targetId)
    throw new Error("Compensation demand target changed");
  const groups = await pendingCompensationGroups(tx, [target.mediaId]);
  if (groups.length === 0) return null;
  if (groups.length !== 1)
    throw new MediaError(
      "compensation_group_ambiguous",
      "Overlapping publication recovery requires review",
      409,
    );
  const group = groups[0];
  if (group === undefined) throw new Error("Compensation group disappeared");
  const queued = isSeriesPackNativeDescriptorV2(group.descriptor)
    ? null
    : await queueCompensatedPublication(tx, {
        continuationId: group.id,
        triggerKey: input.key,
      });
  if (queued !== null) return queued;
  const existing = await tx.operation.findUnique({
    where: { idempotencyKey: input.key },
  });
  if (existing !== null) return existing.id;
  const operation = await tx.operation.create({
    data: {
      idempotencyKey: input.key,
      kind: input.kind,
      targetId: input.targetId,
      ...(input.userId === undefined ? {} : { userId: input.userId }),
      payload: input.payload,
      status: "completed",
      result: {
        reason: "compensation_group_waiting",
        continuationId: group.id,
      },
    },
  });
  return operation.id;
}
