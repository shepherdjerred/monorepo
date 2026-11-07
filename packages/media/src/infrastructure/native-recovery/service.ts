import { z } from "zod";
import { NativeStoredScopeSchema } from "#shared/native-recovery/lifecycle.ts";
import type { PrepareNativeArchiveSchema } from "#shared/native-recovery/archive.ts";
import { PrismaNativeArchive } from "#infrastructure/native-archive/service.ts";
import {
  archiveInventory,
  archiveContinuationViews,
} from "#infrastructure/native-archive/view.ts";
import type { Database } from "#infrastructure/database.ts";
import type { MediaActor } from "#application/auth.ts";
import { MediaError, requireOwner } from "#application/errors.ts";
import { MediaCommandBase } from "#infrastructure/command-base.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { queueOperation } from "#automation/store.ts";
import {
  PrepareNativeRecoverySchema,
  ApplyNativeRecoverySchema,
  NativeRecoveryInventorySchema,
} from "#shared/native-recovery.ts";
import { buildNativeScope } from "./scope.ts";
import {
  lockNativeScope,
  assertNativeSnapshot,
  assertNativeExclusion,
} from "./guards.ts";
import { resolveNativeStorageRoots } from "./storage-provenance.ts";
import { runtimeAuthority } from "#infrastructure/handoff/authority.ts";
import {
  NativeLifecycleDetailSchema,
  NativePublishedScopeSchema,
} from "#shared/native-recovery/lifecycle.ts";
import {
  NativeQuarantineScopeSchema,
  NativeQuarantineContinuationSchema,
  type PrepareNativeQuarantineSchema,
} from "#shared/native-recovery/quarantine.ts";
import { PrismaNativeQuarantine } from "#infrastructure/native-quarantine/service.ts";
import { assertNativeOwner } from "./owner.ts";
import { effectiveRequestWhere } from "#infrastructure/request-claims.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { PrismaNativeCompensation } from "#infrastructure/native-compensation/service.ts";
import {
  compensationInventory,
  compensationContinuationViews,
} from "#infrastructure/native-compensation/view.ts";
import {
  type PrepareNativeCompensationSchema,
  ApplyNativeCompensationSchema,
} from "#shared/native-recovery/compensation.ts";
import { PrismaSeriesPackNativeCompensationV1 } from "#infrastructure/native-compensation/series-pack/service.ts";
import { retryNativeCompensationCommand } from "#infrastructure/native-compensation/retry-command.ts";
import { seriesPackNativeCommandInvocationV1 } from "#infrastructure/native-compensation/series-pack/command-invocation.ts";
import { seriesPackNativeDetailV1 } from "#infrastructure/native-compensation/series-pack/view.ts";
import { bindPlexTransactionDeadline } from "#infrastructure/plex-binding/freshness.ts";

export class PrismaNativeRecovery extends MediaCommandBase {
  constructor(
    private readonly db: Database,
    private readonly describe?: MediaAutomationContext["describeWorkflow"],
  ) {
    super(db, { keepDays: 30 });
  }
  async prepareCompensation(
    actor: MediaActor,
    key: string,
    input: z.input<typeof PrepareNativeCompensationSchema>,
  ) {
    const invocation = seriesPackNativeCommandInvocationV1();
    requireOwner(actor);
    const selected = await this.db.mediaPublicationTransition.findUniqueOrThrow(
      {
        where: { id: input.transitionId },
      },
    );
    invocation.budget.consume(1);
    return z.object({ schemaVersion: z.literal(3) }).safeParse(selected.intent)
      .success
      ? new PrismaSeriesPackNativeCompensationV1(this.db).prepare(
          actor,
          key,
          input,
          invocation,
        )
      : new PrismaNativeCompensation(this.db, this.describe).prepare(
          actor,
          key,
          input,
        );
  }
  retryCompensation(
    actor: MediaActor,
    key: string,
    id: string,
    input: { expectedVersion: number },
  ) {
    return retryNativeCompensationCommand(this.db, this.describe, {
      actor,
      key,
      id,
      review: input,
    });
  }
  async compensationInventory(actor: MediaActor, cursor: string | null = null) {
    const invocation = seriesPackNativeCommandInvocationV1();
    requireOwner(actor);
    return this.db.$transaction(async (tx) => {
      await assertNativeOwner(tx, actor.id);
      invocation.budget.consume(1);
      return compensationInventory(
        tx,
        cursor === null ? null : z.uuid().parse(cursor),
        invocation.budget,
        invocation.freshness,
      );
    });
  }
  prepareArchive(
    actor: MediaActor,
    key: string,
    input: z.input<typeof PrepareNativeArchiveSchema>,
  ) {
    return new PrismaNativeArchive(this.db).prepare(actor, key, input);
  }
  async archiveInventory(actor: MediaActor, cursor: string | null = null) {
    requireOwner(actor);
    return this.db.$transaction(async (tx) => {
      await assertNativeOwner(tx, actor.id);
      return archiveInventory(
        tx,
        cursor === null ? null : z.uuid().parse(cursor),
      );
    });
  }
  prepareQuarantine(
    actor: MediaActor,
    key: string,
    input: z.input<typeof PrepareNativeQuarantineSchema>,
  ) {
    return new PrismaNativeQuarantine(this.db).prepare(actor, key, input);
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
          edition: "default",
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
            ...(["published", "quarantined"].includes(row.state)
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
    const invocation = seriesPackNativeCommandInvocationV1();
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
      if (
        z
          .object({
            schemaVersion: z.literal(3),
            protocol: z.literal("series_pack_publication_v3"),
          })
          .safeParse(row.scope).success
      ) {
        invocation.budget.consume(2 + (row.receipt === null ? 0 : 1));
        await bindPlexTransactionDeadline(tx, invocation.freshness);
        const detail = await seriesPackNativeDetailV1(
          tx,
          row,
          invocation.budget,
        );
        invocation.freshness.assertActive();
        return detail;
      }
      const continuations = await tx.nativeQuarantineContinuation.findMany({
        where: { receipt: { planId: id } },
        orderBy: { id: "asc" },
      });
      const continuationViews = [];
      for (const continuation of continuations) {
        const descriptor = NativeQuarantineContinuationSchema.parse(
          continuation.descriptor,
        );
        const media = await tx.mediaItem.findMany({
          where: { id: { in: descriptor.group.mediaIds } },
          select: {
            id: true,
            title: true,
            availability: true,
            intents: { where: { edition: "default" } },
          },
          orderBy: { id: "asc" },
        });
        const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
          where: { id: "singleton" },
        });
        const claims = await tx.mediaRequest.findMany({
          where: {
            mediaId: { in: descriptor.group.mediaIds },
            ...effectiveRequestWhere,
          },
          select: { mediaId: true },
        });
        const currentPositiveMediaIds = media
          .filter(({ id: mediaId, intents }) => {
            const intent = defaultIntent(intents);
            return (
              intent?.automationEpoch === runtime.recoveryEpoch &&
              intent.desiredPresence &&
              intent.monitoring &&
              intent.intentionallyRemovedAt === null &&
              claims.some((claim) => claim.mediaId === mediaId)
            );
          })
          .map((item) => item.id);
        continuationViews.push({
          id: continuation.id,
          groupHash: continuation.groupHash,
          state: continuation.state,
          version: continuation.version,
          currentPositiveMediaIds,
          media: media.map(({ intents: _intents, ...item }) => item),
        });
      }
      const storedScope = NativeStoredScopeSchema.parse(row.scope);
      return NativeLifecycleDetailSchema.parse({
        id: row.id,
        state: row.state,
        version: row.version,
        scope: row.scope,
        plan: row.plan,
        planHash: row.planHash,
        expiresAt: row.expiresAt?.toISOString() ?? null,
        receiptId: row.receipt?.id ?? null,
        continuations: continuationViews,
        ...(storedScope.schemaVersion === 2 &&
        storedScope.lifecycleKind === "publication_compensation"
          ? {
              compensationContinuations: await compensationContinuationViews(
                tx,
                id,
              ),
            }
          : {}),
        ...(storedScope.schemaVersion === 2 &&
        storedScope.lifecycleKind === "superseded_archive"
          ? { archiveContinuations: await archiveContinuationViews(tx, id) }
          : {}),
      });
    });
  }
  async apply(
    actor: MediaActor,
    key: string,
    id: string,
    raw:
      | z.input<typeof ApplyNativeRecoverySchema>
      | z.input<typeof ApplyNativeCompensationSchema>,
  ) {
    const invocation = seriesPackNativeCommandInvocationV1();
    requireOwner(actor);
    const selected = await this.db.nativeRecoveryPlan.findUniqueOrThrow({
      where: { id },
    });
    if (
      z
        .object({
          schemaVersion: z.literal(3),
          protocol: z.literal("series_pack_publication_v3"),
        })
        .safeParse(selected.scope).success
    ) {
      invocation.budget.consume(1);
      return new PrismaSeriesPackNativeCompensationV1(this.db).apply(
        actor,
        key,
        { planId: id, review: ApplyNativeCompensationSchema.parse(raw) },
        invocation,
      );
    }
    const selectedScope = NativeStoredScopeSchema.parse(selected.scope);
    if (
      selectedScope.schemaVersion === 2 &&
      selectedScope.lifecycleKind === "publication_compensation"
    )
      return new PrismaNativeCompensation(this.db, this.describe).apply(
        actor,
        key,
        id,
        ApplyNativeCompensationSchema.parse(raw),
      );
    const input = ApplyNativeRecoverySchema.parse(raw);
    if (
      selectedScope.schemaVersion === 2 &&
      selectedScope.lifecycleKind === "superseded_archive"
    )
      return new PrismaNativeArchive(this.db).apply(actor, key, id, input);
    if (NativeQuarantineScopeSchema.safeParse(selected.scope).success)
      return new PrismaNativeQuarantine(this.db).apply(actor, key, id, input);
    return this.command(
      actor,
      key,
      { kind: "apply_native_recovery", input: { id, ...input } },
      async (tx) => {
        const initial = await tx.nativeRecoveryPlan.findUniqueOrThrow({
          where: { id },
        });
        const scope = NativePublishedScopeSchema.parse(initial.scope);
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
import { defaultIntent } from "#shared/editions/scope.ts";
