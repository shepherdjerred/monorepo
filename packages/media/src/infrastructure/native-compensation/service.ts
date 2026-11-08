import { z } from "zod";
import type { Database } from "#infrastructure/database.ts";
import type { MediaActor } from "#application/auth.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { MediaError, requireOwner } from "#application/errors.ts";
import { MediaCommandBase } from "#infrastructure/command-base.ts";
import {
  PrepareNativeCompensationSchema,
  ApplyNativeCompensationSchema,
  NativeCompensationScopeSchema,
} from "#shared/native-recovery/compensation.ts";
import { ClosedCoordinatorObservationSchema } from "#shared/publication-proof/references.ts";
import { assertNativeOwner } from "#infrastructure/native-recovery/owner.ts";
import { assertNativeExclusion } from "#infrastructure/native-recovery/guards.ts";
import { runtimeAuthority } from "#infrastructure/handoff/authority.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { queueOperation } from "#automation/store.ts";
import { buildNativeCompensationScope } from "./scope.ts";
import {
  lockNativeCompensationScope,
  assertNativeCompensationSnapshot,
} from "./guards.ts";
import { compensationRecord } from "./records.ts";
import { queueCompensatedPublication } from "./publication.ts";

export class PrismaNativeCompensation extends MediaCommandBase {
  constructor(
    private readonly db: Database,
    private readonly describe?: MediaAutomationContext["describeWorkflow"],
  ) {
    super(db, { keepDays: 30 });
  }
  async prepare(
    actor: MediaActor,
    key: string,
    raw: z.input<typeof PrepareNativeCompensationSchema>,
  ) {
    requireOwner(actor);
    const input = PrepareNativeCompensationSchema.parse(raw);
    return this.command(
      actor,
      key,
      { kind: "prepare_native_compensation", input },
      async (tx) => {
        const initial = await buildNativeCompensationScope(tx, input);
        await lockNativeCompensationScope(tx, initial);
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
            "Inspect the current restore state before preparing compensation",
            409,
          );
        const scope = await buildNativeCompensationScope(tx, input);
        if (
          snapshotHash(nativeJson(scope)) !== snapshotHash(nativeJson(initial))
        )
          throw new MediaError(
            "native_scope_changed",
            "The complete interrupted publication changed",
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
          key: `native-compensation-prepare:${plan.id}`,
          kind: "prepare_native_compensation",
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
  async apply(
    actor: MediaActor,
    key: string,
    id: string,
    raw: z.input<typeof ApplyNativeCompensationSchema>,
  ) {
    requireOwner(actor);
    const input = ApplyNativeCompensationSchema.parse(raw);
    return this.command(
      actor,
      key,
      { kind: "apply_native_compensation", input: { id, ...input } },
      async (tx) => {
        const initial = await tx.nativeRecoveryPlan.findUniqueOrThrow({
          where: { id },
        });
        const scope = NativeCompensationScopeSchema.parse(initial.scope);
        await lockNativeCompensationScope(tx, scope);
        await tx.$queryRaw`SELECT id FROM "NativeRecoveryPlan" WHERE id=${id} FOR UPDATE`;
        await assertNativeOwner(tx, actor.id);
        const { plan } = await assertNativeCompensationSnapshot(tx, {
          planId: id,
          scope,
        });
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
            "Review a fresh exact compensation plan",
            409,
          );
        await tx.nativeRecoveryPlan.update({
          where: { id },
          data: { state: "applying", version: { increment: 1 } },
        });
        const operationId = await queueOperation(tx, {
          key: `native-compensation-apply:${id}:${input.planHash}`,
          kind: "apply_native_compensation",
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
  async retry(
    actor: MediaActor,
    key: string,
    id: string,
    raw: { expectedVersion: number },
  ) {
    requireOwner(actor);
    const input = z
      .strictObject({ expectedVersion: z.int().nonnegative() })
      .parse(raw);
    const envelope = {
      kind: "retry_native_compensation",
      input: { id, ...input },
    };
    const replay = await this.db.idempotencyRecord.findUnique({
      where: { userId_key: { userId: actor.id, key } },
    });
    if (replay !== null)
      return this.command(actor, key, envelope, () =>
        Promise.reject(new Error("Compensation replay disappeared")),
      );
    const initial =
      await this.db.nativePublicationCompensationContinuation.findUniqueOrThrow(
        { where: { id } },
      );
    const operationId =
      initial.state === "compensated"
        ? initial.publicationCoordinatorOperationId
        : initial.coordinatorOperationId;
    if (operationId === null && initial.state !== "compensated")
      throw new Error("Compensation execution coordinator missing");
    if (this.describe === undefined)
      throw new Error("Compensation workflow description port is required");
    const workflowId =
      operationId === null ? null : `media-operation-${operationId}`;
    const observed =
      workflowId === null ? null : await this.describe(workflowId);
    if (
      operationId !== null &&
      (observed === null ||
        ![
          "COMPLETED",
          "FAILED",
          "CANCELLED",
          "TERMINATED",
          "TIMED_OUT",
        ].includes(observed.status) ||
        !observed.runId)
    )
      throw new MediaError(
        "compensation_coordinator_not_terminal",
        "The exact previous workflow must be confirmed terminal before retrying",
        409,
      );
    const closed =
      operationId === null
        ? undefined
        : ClosedCoordinatorObservationSchema.parse({
            operationId,
            workflowId,
            runId: observed?.runId,
            status: observed?.status,
            observedAt: new Date().toISOString(),
          });
    return this.command(actor, key, envelope, async (tx) => {
      const record = await compensationRecord(tx, id);
      await lockNativeCompensationScope(tx, record.descriptor.scope);
      await assertNativeOwner(tx, actor.id);
      const current = await compensationRecord(tx, id);
      const runtime = await runtimeAuthority(tx);
      if (
        current.row.version !== input.expectedVersion ||
        current.row.fenceRelease !== null ||
        !runtime.active ||
        runtime.epoch !== current.row.recoveryEpoch ||
        (current.row.state === "compensated"
          ? current.row.publicationCoordinatorOperationId
          : current.row.coordinatorOperationId) !== operationId
      )
        throw new MediaError(
          "compensation_retry_changed",
          "Refresh the compensation state before retrying",
          409,
        );
      if (current.row.state === "compensated") {
        const publication = await queueCompensatedPublication(tx, {
          continuationId: id,
          triggerKey: key,
          ...(closed === undefined ? {} : { previousWorkflowClosed: closed }),
        });
        if (publication === null)
          throw new MediaError(
            "compensation_publication_protected",
            "Fresh positive household intent is required for every affected title",
            409,
          );
        return {
          operationId: publication,
          status: "queued",
          version: current.row.version + 1,
        };
      }
      const next = await queueOperation(tx, {
        key: `native-compensation-retry:${id}:${String(current.row.version)}:${key}`,
        kind: "compensate_native_publication",
        targetId: id,
        userId: current.row.receipt.actorId,
        payload: {
          schemaVersion: 1,
          continuationId: id,
          recoveryEpoch: current.row.recoveryEpoch,
        },
      });
      await tx.nativePublicationCompensationContinuation.update({
        where: { id },
        data: {
          coordinatorOperationId: next,
          state: "compensating",
          version: { increment: 1 },
        },
      });
      return {
        operationId: next,
        status: "queued",
        version: current.row.version + 1,
      };
    });
  }
}
