import { z } from "zod";
import type { Database } from "#infrastructure/database.ts";
import type { MediaActor } from "#application/auth.ts";
import { MediaCommandBase } from "#infrastructure/command-base.ts";
import { requireOwner, MediaError } from "#application/errors.ts";
import {
  PrepareNativeCompensationSchema,
  ApplyNativeCompensationSchema,
} from "#shared/native-recovery/compensation.ts";
import { SeriesPackNativeCompensationScopeV3Schema } from "#shared/native-recovery/series-pack/scope.ts";
import { SeriesPackNativeDescriptorV2Schema } from "#shared/native-recovery/series-pack/evidence.ts";
import { SeriesPackPublicationIntentRefV3Schema } from "#shared/acquisition/series-pack-publication-v1.ts";
import { CommandResultSchema } from "#shared/api.ts";
import { bindPlexTransactionDeadline } from "#infrastructure/plex-binding/freshness.ts";
import {
  seriesPackNativeCommandInvocationV1,
  type SeriesPackNativeCommandInvocationV1,
} from "./command-invocation.ts";
import { assertNativeOwner } from "#infrastructure/native-recovery/owner.ts";
import { assertNativeExclusion } from "#infrastructure/native-recovery/guards.ts";
import { runtimeAuthority } from "#infrastructure/handoff/authority.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { queueOperation } from "#automation/store.ts";
import { lockSeriesPackNativeScopeV1 } from "./locks.ts";
import { buildSeriesPackNativeScopeV1 } from "./scope.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import {
  observeSeriesPackNativeRetryV1,
  type SeriesPackNativeClosedRetryV1,
} from "./retry-coordinator.ts";
import { queueSeriesPackNativePhysicalRetryV1 } from "./retry-physical.ts";
import { queueSeriesPackNativePublicationV1 } from "./publication/queue.ts";

/** Explicit new producer. The old service and its literal command envelopes stay unchanged. */
export class PrismaSeriesPackNativeCompensationV1 extends MediaCommandBase {
  constructor(
    private readonly db: Database,
    private readonly describe?: MediaAutomationContext["describeWorkflow"],
  ) {
    super(db, { keepDays: 30 });
  }

  async retry(
    actor: MediaActor,
    key: string,
    requested: { id: string; review: { expectedVersion: number } },
    supplied?: SeriesPackNativeCommandInvocationV1,
  ) {
    const invocation = supplied ?? seriesPackNativeCommandInvocationV1();
    requireOwner(actor);
    const id = z.uuid().parse(requested.id);
    const input = z
      .strictObject({ expectedVersion: z.int().nonnegative() })
      .parse(requested.review);
    let observed: SeriesPackNativeClosedRetryV1 | undefined;
    return this.commandWithProtocol(
      actor,
      key,
      {
        command: { kind: "retry_native_compensation", input: { id, ...input } },
        decode: (value) => CommandResultSchema.parse(value),
        beforeNewCommand: async () => {
          observed = await observeSeriesPackNativeRetryV1(
            this.db,
            id,
            this.describe,
            invocation,
          );
        },
        assertCommit: invocation.freshness.assertActive,
      },
      async (tx) => {
        const closed = observed;
        if (closed === undefined)
          throw new Error("Native retry lost its actual executor observation");
        invocation.freshness.assertActive();
        await bindPlexTransactionDeadline(tx, invocation.freshness);
        const descriptor = SeriesPackNativeDescriptorV2Schema.parse(
          closed.initial.descriptor,
        );
        await lockSeriesPackNativeScopeV1(tx, descriptor.scope.publication);
        await tx.$queryRaw`SELECT id FROM "NativePublicationCompensationContinuation" WHERE id=${id} FOR UPDATE`;
        await assertNativeOwner(tx, actor.id);
        invocation.budget.consume(1);
        if (closed.initial.completion === null)
          return queueSeriesPackNativePhysicalRetryV1(
            tx,
            {
              id,
              key,
              actorId: actor.id,
              expectedVersion: input.expectedVersion,
              observed: closed,
            },
            invocation,
          );
        const operationId = await queueSeriesPackNativePublicationV1(
          tx,
          {
            continuationId: id,
            triggerKey: key,
            observed: invocation.observed,
            freshness: invocation.freshness,
            retry: {
              observed: closed,
              actorId: actor.id,
              expectedVersion: input.expectedVersion,
              invocation,
            },
          },
          invocation.budget,
        );
        if (operationId === null)
          throw new MediaError(
            "compensation_publication_protected",
            "Fresh complete household intent is required before retrying publication",
            409,
          );
        return {
          operationId,
          status: "queued",
          version: input.expectedVersion + 1,
        };
      },
    );
  }

  async prepare(
    actor: MediaActor,
    key: string,
    raw: z.input<typeof PrepareNativeCompensationSchema>,
    supplied?: SeriesPackNativeCommandInvocationV1,
  ) {
    const invocation = supplied ?? seriesPackNativeCommandInvocationV1();
    requireOwner(actor);
    const input = PrepareNativeCompensationSchema.parse(raw);
    const { budget, freshness } = invocation;
    return this.commandWithProtocol(
      actor,
      key,
      {
        command: { kind: "prepare_series_pack_native_compensation_v1", input },
        decode: (value) => CommandResultSchema.parse(value),
        assertCommit: freshness.assertActive,
      },
      async (tx) => {
        freshness.assertActive();
        await bindPlexTransactionDeadline(tx, freshness);
        const locator = await tx.mediaPublicationTransition.findUniqueOrThrow({
          where: { id: input.transitionId },
        });
        budget.consume(1);
        const publication = SeriesPackPublicationIntentRefV3Schema.parse({
          transitionId: locator.id,
          intentHash: locator.intentHash,
          intent: locator.intent,
        });
        if (
          identityHash(locator.intent) !== locator.intentHash ||
          locator.outcome !== null
        )
          throw new Error(
            "Native pack preparation requires the actual uncommitted raw v3 parent",
          );
        await lockSeriesPackNativeScopeV1(tx, publication);
        await assertNativeOwner(tx, actor.id);
        budget.consume(1);
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
            "Inspect the actual restore state before preparing compensation",
            409,
          );
        const { scope } = await buildSeriesPackNativeScopeV1(tx, input, budget);
        const plan = await tx.nativeRecoveryPlan.create({
          data: {
            actorId: actor.id,
            createdAt: new Date(),
            restoreOperationId: input.restoreOperationId,
            recoveryEpoch: input.recoveryEpoch,
            runtimeVersion: input.runtimeVersion,
            requestHash: identityHash(input),
            scope: z.record(z.string(), z.json()).parse(scope),
          },
        });
        const operationId = await queueOperation(tx, {
          key: `series-pack-native-compensation-prepare-v1:${plan.id}`,
          kind: "prepare_series_pack_native_compensation_v1",
          targetId: plan.id,
          userId: actor.id,
          payload: { planId: plan.id },
          budget,
          createdAt: new Date(),
          availableAt: new Date(),
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
    requested: {
      planId: string;
      review: z.input<typeof ApplyNativeCompensationSchema>;
    },
    supplied?: SeriesPackNativeCommandInvocationV1,
  ) {
    const invocation = supplied ?? seriesPackNativeCommandInvocationV1();
    requireOwner(actor);
    const id = requested.planId;
    const input = ApplyNativeCompensationSchema.parse(requested.review);
    const { budget, freshness } = invocation;
    return this.commandWithProtocol(
      actor,
      key,
      {
        command: {
          kind: "apply_series_pack_native_compensation_v1",
          input: { id, ...input },
        },
        decode: (value) => CommandResultSchema.parse(value),
        assertCommit: freshness.assertActive,
      },
      async (tx) => {
        freshness.assertActive();
        await bindPlexTransactionDeadline(tx, freshness);
        const initial = await tx.nativeRecoveryPlan.findUniqueOrThrow({
          where: { id },
        });
        budget.consume(1);
        const scope = SeriesPackNativeCompensationScopeV3Schema.parse(
          initial.scope,
        );
        await lockSeriesPackNativeScopeV1(tx, scope.publication);
        await tx.$queryRaw`SELECT id FROM "NativeRecoveryPlan" WHERE id=${id} FOR UPDATE`;
        await assertNativeOwner(tx, actor.id);
        budget.consume(1);
        const plan = await tx.nativeRecoveryPlan.findUniqueOrThrow({
          where: { id },
        });
        budget.consume(1);
        const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
          where: { id: "singleton" },
        });
        const authority = await runtimeAuthority(tx);
        if (
          plan.actorId !== actor.id ||
          plan.state !== "awaiting_review" ||
          plan.version !== input.expectedVersion ||
          plan.planHash !== input.planHash ||
          plan.recoveryEpoch !== input.recoveryEpoch ||
          plan.runtimeVersion !== input.runtimeVersion ||
          runtime.recoveryEpoch !== plan.recoveryEpoch ||
          runtime.version !== plan.runtimeVersion ||
          (scope.request.activation === "activate"
            ? runtime.mode !== "observe" || runtime.ownershipConfirmed
            : !authority.active) ||
          plan.expiresAt === null ||
          plan.expiresAt <= new Date()
        )
          throw new MediaError(
            "native_review_changed",
            "Review the fresh exact native pack plan",
            409,
          );
        const current = await buildSeriesPackNativeScopeV1(
          tx,
          scope.request,
          budget,
          scope.storageRoots,
        );
        if (identityHash(current.scope) !== identityHash(scope))
          throw new MediaError(
            "native_scope_changed",
            "The entire reviewed native pack changed",
            409,
          );
        await tx.nativeRecoveryPlan.update({
          where: { id },
          data: { state: "applying", version: { increment: 1 } },
        });
        const operationId = await queueOperation(tx, {
          key: `series-pack-native-compensation-apply-v1:${id}:${input.planHash}`,
          kind: "apply_series_pack_native_compensation_v1",
          targetId: id,
          userId: actor.id,
          payload: { planId: id, planHash: input.planHash, actorId: actor.id },
          budget,
          createdAt: new Date(),
          availableAt: new Date(),
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
