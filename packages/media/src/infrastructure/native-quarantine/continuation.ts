import { Prisma } from "#generated/prisma/client.ts";
import { z } from "zod";
import {
  NativeQuarantineContinuationSchema,
  NativeQuarantineRestorationSchema,
} from "#shared/native-recovery/quarantine.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import {
  recordsAuthorized,
  lockRuntimeAuthority,
} from "#infrastructure/handoff/authority.ts";
import { lockDefaultMedia } from "#infrastructure/handoff/default-edition.ts";
import {
  lockEffectiveRequests,
  effectiveRequestWhere,
} from "#infrastructure/request-claims.ts";
import { assertNoSubtitleReplacement } from "#infrastructure/subtitle-replacement/locks.ts";
import { NativeQuarantineProtection } from "./errors.ts";
import { assertNoPublicationCompensationFence } from "#infrastructure/native-compensation/fence.ts";
import { validateNativePlexReceipt } from "#infrastructure/plex-binding/native/native-version.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";

export type NativeQuarantineRestoreInput = {
  operationId: string;
  continuationId: string;
  mediaId: string;
  generation: number;
};

/** Routing records a new command only. Files must independently prove every group leaf. */
export async function routeNativeQuarantineOperation(
  tx: Prisma.TransactionClient,
  input: {
    kind: string;
    targetId: string;
    payload: Prisma.InputJsonObject;
  },
) {
  if (
    !["restore_media", "reconcile_media", "acquire_release"].includes(
      input.kind,
    )
  )
    return null;
  const target = z
    .object({ mediaId: z.uuid(), generation: z.int() })
    .safeParse(input.payload);
  if (!target.success || input.targetId !== target.data.mediaId) return null;
  const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  const rows = await tx.nativeQuarantineContinuation.findMany({
    where: {
      recoveryEpoch: runtime.recoveryEpoch,
      descriptor: {
        path: ["group", "mediaIds"],
        array_contains: [target.data.mediaId],
      },
    },
    take: 2,
  });
  if (rows.length === 0) return null;
  if (rows.length !== 1)
    throw new Error("Native quarantine continuation authority is ambiguous");
  const row = rows[0];
  if (row === undefined)
    throw new Error("Native quarantine continuation missing");
  const descriptor = NativeQuarantineContinuationSchema.parse(row.descriptor);
  if (!descriptor.group.mediaIds.includes(target.data.mediaId))
    throw new Error("Native quarantine target changed");
  if (row.state === "restored") {
    const restored = NativeQuarantineRestorationSchema.parse(row.restoration);
    if (
      !(await tx.mediaItem.count({
        where: {
          id: { in: descriptor.group.mediaIds },
          availability: "importing",
        },
      }))
    )
      return null;
    const current = await tx.libraryAsset.findMany({
      where: { id: { in: descriptor.group.assetIds } },
    });
    if (
      current.length !== restored.assets.length ||
      current.some(
        (asset) =>
          asset.state !== "published" ||
          asset.ownershipEpoch !== row.recoveryEpoch ||
          !restored.assets.some(
            (item) =>
              item.assetId === asset.id &&
              item.assetVersion === asset.version &&
              item.checksum === asset.checksum,
          ),
      )
    )
      throw new Error(
        "Native quarantine restored publication requires exact reconciliation",
      );
  }
  const intents = await tx.mediaIntent.findMany({
    where: { edition: "default", mediaId: { in: descriptor.group.mediaIds } },
  });
  const generations = Object.fromEntries(
    intents.map((intent) => [intent.mediaId, intent.generation]),
  );
  return {
    continuationId: row.id,
    state: row.state === "restored" ? "restored" : "restoring",
    kind: "restore_native_quarantine",
    payload: { ...input.payload, continuationId: row.id, generations },
  };
}

/** Caller owns no preceding asset/continuation locks; retain returned transaction through effect. */
export async function assertNativeQuarantineRestore(
  tx: Prisma.TransactionClient,
  input: NativeQuarantineRestoreInput,
  budget = new PublicationAuthorityReadBudget(),
) {
  const initial = await tx.nativeQuarantineContinuation.findUniqueOrThrow({
    where: { id: input.continuationId },
  });
  budget.consume(1);
  const descriptor = NativeQuarantineContinuationSchema.parse(
    initial.descriptor,
  );
  await lockDefaultMedia(tx, descriptor.group.mediaIds);
  await assertNoPublicationCompensationFence(tx, {
    mediaIds: descriptor.group.mediaIds,
    assetIds: descriptor.group.assetIds,
  });
  await lockEffectiveRequests(tx, descriptor.group.mediaIds);
  if (!(await lockRuntimeAuthority(tx, initial.recoveryEpoch)))
    throw new NativeQuarantineProtection("native_quarantine_runtime_protected");
  await assertNoSubtitleReplacement(tx, descriptor.group.assetIds);
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM "LibraryAsset" WHERE id IN (${Prisma.join(descriptor.group.assetIds)}) ORDER BY id FOR UPDATE`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM "SubtitleAsset" WHERE "assetId" IN (${Prisma.join(descriptor.group.assetIds)}) ORDER BY id FOR UPDATE`,
  );
  await tx.$queryRaw`SELECT id FROM "NativeQuarantineContinuation" WHERE id = ${input.continuationId} FOR UPDATE`;
  const row = await tx.nativeQuarantineContinuation.findUniqueOrThrow({
    where: { id: input.continuationId },
    include: { receipt: { include: { plan: true } } },
  });
  budget.consume(2);
  if (
    row.coordinatorOperationId !== input.operationId ||
    !["pending", "restoring", "protected", "restored"].includes(row.state) ||
    snapshotHash(z.json().parse(row.descriptor)) !==
      snapshotHash(z.json().parse(descriptor))
  )
    throw new NativeQuarantineProtection(
      "native_quarantine_coordinator_changed",
    );
  const receipt = row.receipt;
  await validateNativePlexReceipt(tx, receipt, budget);
  if (
    receipt.recoveryEpoch !== row.recoveryEpoch ||
    receipt.plan.state !== "applied" ||
    receipt.planHash !== receipt.plan.planHash ||
    receipt.plan.plan === null ||
    snapshotHash(z.json().parse(receipt.plan.plan)) !== receipt.planHash
  )
    throw new NativeQuarantineProtection("native_quarantine_receipt_changed");
  const payload = await restoreOperation(tx, input, {
    epoch: row.recoveryEpoch,
    mediaIds: descriptor.group.mediaIds,
  });
  const intents = await tx.mediaIntent.findMany({
    where: { edition: "default", mediaId: { in: descriptor.group.mediaIds } },
  });
  if (
    snapshotHash(payload.generations) !==
    snapshotHash(
      Object.fromEntries(
        intents.map((intent) => [intent.mediaId, intent.generation]),
      ),
    )
  )
    throw new NativeQuarantineProtection(
      "native_quarantine_group_generation_changed",
    );
  if (
    intents.length !== descriptor.group.mediaIds.length ||
    intents.some(
      (intent) =>
        intent.automationEpoch !== row.recoveryEpoch ||
        !intent.desiredPresence ||
        !intent.monitoring ||
        intent.intentionallyRemovedAt !== null,
    ) ||
    !intents.some(
      (intent) =>
        intent.mediaId === input.mediaId &&
        intent.generation === input.generation,
    )
  )
    throw new NativeQuarantineProtection(
      "native_quarantine_all_leaves_need_current_positive_intent",
    );
  const claims = await tx.mediaRequest.findMany({
    where: {
      mediaId: { in: descriptor.group.mediaIds },
      ...effectiveRequestWhere,
    },
    select: { mediaId: true },
  });
  if (
    descriptor.group.mediaIds.some(
      (id) => !claims.some((claim) => claim.mediaId === id),
    )
  )
    throw new NativeQuarantineProtection(
      "native_quarantine_all_leaves_need_current_positive_intent",
    );
  if (
    !(await recordsAuthorized(tx, {
      epoch: row.recoveryEpoch,
      mediaIds: descriptor.group.mediaIds,
      assetIds: descriptor.group.assetIds,
    }))
  )
    throw new NativeQuarantineProtection(
      "native_quarantine_record_authority_changed",
    );
  return {
    row,
    descriptor,
    generations: Object.fromEntries(
      intents.map((intent) => [intent.mediaId, intent.generation]),
    ),
  };
}

async function restoreOperation(
  tx: Prisma.TransactionClient,
  input: NativeQuarantineRestoreInput,
  authority: { epoch: number; mediaIds: string[] },
) {
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: input.operationId },
  });
  const payload = z
    .object({
      continuationId: z.uuid(),
      mediaId: z.uuid(),
      generation: z.int(),
      recoveryEpoch: z.int(),
      generations: z.record(z.uuid(), z.int().nonnegative()),
    })
    .parse(operation.payload);
  if (
    operation.kind !== "restore_native_quarantine" ||
    payload.continuationId !== input.continuationId ||
    payload.mediaId !== input.mediaId ||
    payload.generation !== input.generation ||
    payload.recoveryEpoch !== authority.epoch ||
    !authority.mediaIds.includes(input.mediaId)
  )
    throw new NativeQuarantineProtection("native_quarantine_operation_changed");
  return payload;
}
