import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import type { Database } from "#infrastructure/database.ts";
import type { MediaActor } from "#application/auth.ts";
import { MediaError, requireOwner } from "#application/errors.ts";
import { MediaCommandBase } from "#infrastructure/command-base.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { queueOperation } from "#automation/store.ts";
import {
  PrepareNativeRecoverySchema,
  ApplyNativeRecoverySchema,
  NativeRecoveryDetailSchema,
  NativeRecoveryInventorySchema,
  NativeRecoveryScopeSchema,
} from "#shared/native-recovery.ts";
import { buildNativeScope } from "./scope.ts";
import {
  lockNativeScope,
  assertNativeSnapshot,
  assertNativeExclusion,
} from "./guards.ts";
import { resolveNativeStorageRoots } from "./storage-provenance.ts";
import { runtimeAuthority } from "#infrastructure/handoff/authority.ts";

export async function assertNativeOwner(
  tx: Prisma.TransactionClient,
  actorId: string,
) {
  await tx.$queryRaw`SELECT id FROM "MediaUser" WHERE id = ${actorId} FOR SHARE`;
  const actor = await tx.mediaUser.findUniqueOrThrow({
    where: { id: actorId },
  });
  requireOwner(actor);
  if (actor.restricted)
    throw new MediaError(
      "forbidden",
      "Native recovery requires the current unrestricted owner",
      403,
    );
  return actor;
}
export class PrismaNativeRecovery extends MediaCommandBase {
  constructor(private readonly db: Database) {
    super(db, { keepDays: 30 });
  }

  async inventory(actor: MediaActor, cursor: string | null = null) {
    requireOwner(actor);
    return this.db.$transaction(async (tx) => {
      await assertNativeOwner(tx, actor.id);
      const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
        where: { id: "singleton" },
      });
      const restore = await tx.operation.findFirst({
        where: {
          kind: "restore_observe",
          status: "completed",
          result: { path: ["recoveryEpoch"], equals: runtime.recoveryEpoch },
        },
        orderBy: { createdAt: "desc" },
      });
      const assets = await tx.libraryAsset.findMany({
        where: {
          owned: true,
          ownershipEpoch: { lt: runtime.recoveryEpoch },
          ...(cursor === null ? {} : { id: { gt: z.uuid().parse(cursor) } }),
        },
        include: {
          coverage: { where: { current: true }, include: { media: true } },
        },
        orderBy: { id: "asc" },
        take: 101,
      });
      const plans = await tx.nativeRecoveryPlan.findMany({
        orderBy: { createdAt: "desc" },
        take: 100,
      });
      const prerequisites = [];
      if (restore === null)
        prerequisites.push("completed_restore_observation_required");
      try {
        await assertNativeExclusion(tx);
      } catch {
        prerequisites.push(
          "current_epoch_plex_exclusion_required_for_both_roots",
        );
      }
      try {
        await resolveNativeStorageRoots(tx);
      } catch {
        prerequisites.push("prior_approved_storage_receipt_required");
      }
      return NativeRecoveryInventorySchema.parse({
        nextCursor: assets.length > 100 ? assets[99]?.id : null,
        prerequisites,
        runtime: {
          mode: runtime.mode,
          recoveryEpoch: runtime.recoveryEpoch,
          version: runtime.version,
        },
        restoreOperationId: restore?.id ?? null,
        assets: assets.slice(0, 100).map((row) => ({
          id: row.id,
          version: row.version,
          titles: row.coverage.map((item) => item.media.title),
          state: row.state,
          reasons: [
            ...(row.state === "published"
              ? []
              : ["separate_lifecycle_reconciliation_required"]),
            ...(row.checksum === null ? ["recorded_checksum_missing"] : []),
            ...(row.coverage.length === 0 ? ["current_coverage_missing"] : []),
          ],
        })),
        plans: plans.map((row) => ({
          id: row.id,
          state: row.state,
          createdAt: row.createdAt.toISOString(),
        })),
      });
    });
  }
  async prepare(
    actor: MediaActor,
    key: string,
    raw: z.input<typeof PrepareNativeRecoverySchema>,
  ) {
    requireOwner(actor);
    const input = PrepareNativeRecoverySchema.parse(raw);
    return this.command(
      actor,
      key,
      { kind: "prepare_native_recovery", input },
      async (tx) => {
        const initial = await buildNativeScope(tx, input);
        await lockNativeScope(tx, initial);
        await assertNativeOwner(tx, actor.id);
        await assertNativeExclusion(tx);
        const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
          where: { id: "singleton" },
        });
        const authority = await runtimeAuthority(tx);
        if (
          runtime.recoveryEpoch !== input.recoveryEpoch ||
          runtime.version !== input.runtimeVersion ||
          (input.activation === "activate"
            ? runtime.mode !== "observe" || runtime.ownershipConfirmed
            : !authority.active)
        )
          throw new MediaError(
            "native_runtime_changed",
            "Inspect the current restore state before preparing recovery",
            409,
          );
        const scope = await buildNativeScope(tx, input);
        if (
          snapshotHash(z.json().parse(scope)) !==
          snapshotHash(z.json().parse(initial))
        )
          throw new MediaError(
            "native_scope_changed",
            "Selected recovery records changed",
            409,
          );
        const plan = await tx.nativeRecoveryPlan.create({
          data: {
            actorId: actor.id,
            restoreOperationId: input.restoreOperationId,
            recoveryEpoch: input.recoveryEpoch,
            runtimeVersion: input.runtimeVersion,
            requestHash: snapshotHash(input),
            scope: z.record(z.string(), z.json()).parse(scope),
          },
        });
        const operationId = await queueOperation(tx, {
          key: `native-prepare:${plan.id}`,
          kind: "prepare_native_recovery",
          targetId: plan.id,
          userId: actor.id,
          payload: { planId: plan.id },
        });
        return {
          nativeRecoveryId: plan.id,
          operationId,
          status: "queued",
          version: plan.version,
        };
      },
    );
  }
  async detail(actor: MediaActor, id: string) {
    requireOwner(actor);
    return this.db.$transaction(async (tx) => {
      await assertNativeOwner(tx, actor.id);
      const row = await tx.nativeRecoveryPlan.findUnique({
        where: { id },
        include: { receipt: true },
      });
      if (row === null)
        throw new MediaError(
          "native_recovery_missing",
          "Native recovery plan does not exist",
          404,
        );
      return NativeRecoveryDetailSchema.parse({
        id: row.id,
        state: row.state,
        version: row.version,
        scope: row.scope,
        plan: row.plan,
        planHash: row.planHash,
        expiresAt: row.expiresAt?.toISOString() ?? null,
        receiptId: row.receipt?.id ?? null,
      });
    });
  }
  async apply(
    actor: MediaActor,
    key: string,
    id: string,
    raw: z.input<typeof ApplyNativeRecoverySchema>,
  ) {
    requireOwner(actor);
    const input = ApplyNativeRecoverySchema.parse(raw);
    return this.command(
      actor,
      key,
      { kind: "apply_native_recovery", input: { id, ...input } },
      async (tx) => {
        const initial = await tx.nativeRecoveryPlan.findUniqueOrThrow({
          where: { id },
        });
        const scope = NativeRecoveryScopeSchema.parse(initial.scope);
        await lockNativeScope(tx, scope);
        await tx.$queryRaw`SELECT id FROM "NativeRecoveryPlan" WHERE id = ${id} FOR UPDATE`;
        await assertNativeOwner(tx, actor.id);
        const { plan } = await assertNativeSnapshot(tx, id, scope);
        if (
          plan.state !== "awaiting_review" ||
          plan.version !== input.expectedVersion ||
          plan.planHash !== input.planHash ||
          plan.recoveryEpoch !== input.recoveryEpoch ||
          plan.runtimeVersion !== input.runtimeVersion ||
          plan.expiresAt === null ||
          plan.expiresAt <= new Date()
        )
          throw new MediaError(
            "native_review_changed",
            "Inspect and approve a fresh exact native recovery plan",
            409,
          );
        await tx.nativeRecoveryPlan.update({
          where: { id },
          data: { state: "applying", version: { increment: 1 } },
        });
        const operationId = await queueOperation(tx, {
          key: `native-apply:${id}:${input.planHash}`,
          kind: "apply_native_recovery",
          targetId: id,
          userId: actor.id,
          payload: { planId: id, planHash: input.planHash, actorId: actor.id },
        });
        return {
          nativeRecoveryId: id,
          operationId,
          status: "queued",
          version: plan.version + 1,
        };
      },
    );
  }
}
