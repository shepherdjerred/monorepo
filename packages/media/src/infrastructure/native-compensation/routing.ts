import { Prisma } from "#generated/prisma/client.ts";
import { queueCompensatedPublication } from "./publication.ts";
import { MediaError } from "#application/errors.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { z } from "zod";

/** Resolve before any primary-only media lock. This grants no effect or new demand. */
export async function compensationGroupMedia(
  tx: Prisma.TransactionClient,
  mediaIds: readonly string[],
): Promise<string[]> {
  let ids = [...new Set(mediaIds)].sort();
  for (let depth = 0; depth < 100; depth++) {
    const rows = await tx.nativePublicationCompensationContinuation.findMany({
      where: {
        fenceRelease: { equals: Prisma.DbNull },
        mediaIds: { hasSome: ids },
      },
      select: { mediaIds: true },
      take: 101,
    });
    if (rows.length > 100)
      throw new Error("Compensation group history exceeds bound");
    const expanded = [
      ...new Set([...ids, ...rows.flatMap((row) => row.mediaIds)]),
    ].sort();
    if (expanded.length === ids.length) return ids;
    ids = expanded;
  }
  throw new Error("Compensation group closure exceeds bound");
}

export async function assertCompensationGroupUnchanged(
  tx: Prisma.TransactionClient,
  original: readonly string[],
  locked: readonly string[],
): Promise<void> {
  if (
    snapshotHash(await compensationGroupMedia(tx, original)) !==
    snapshotHash([...locked].sort())
  )
    throw new MediaError(
      "compensation_group_changed",
      "The shared recovery group changed; refresh before retrying",
      409,
    );
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
): Promise<void> {
  const groups = await pendingCompensationGroups(tx, input.mediaIds);
  for (const row of groups) {
    if (row.mediaIds.some((id) => !input.mediaIds.includes(id)))
      throw new Error(
        "Household compensation release omitted shared group leaves",
      );
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
  const queued = await queueCompensatedPublication(tx, {
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
