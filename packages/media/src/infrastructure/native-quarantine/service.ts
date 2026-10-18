import { z } from "zod";
import type { Database } from "#infrastructure/database.ts";
import type { MediaActor } from "#application/auth.ts";
import { MediaError, requireOwner } from "#application/errors.ts";
import { MediaCommandBase } from "#infrastructure/command-base.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { queueOperation } from "#automation/store.ts";
import {
  PrepareNativeQuarantineSchema,
  NativeQuarantineScopeSchema,
} from "#shared/native-recovery/quarantine.ts";
import { ApplyNativeRecoverySchema } from "#shared/native-recovery.ts";
import { assertNativeOwner } from "#infrastructure/native-recovery/owner.ts";
import { assertNativeExclusion } from "#infrastructure/native-recovery/guards.ts";
import { runtimeAuthority } from "#infrastructure/handoff/authority.ts";
import { buildNativeQuarantineScope } from "./scope.ts";
import {
  lockNativeQuarantineScope,
  assertNativeQuarantineSnapshot,
} from "./guards.ts";

export class PrismaNativeQuarantine extends MediaCommandBase {
  constructor(db: Database) {
    super(db, { keepDays: 30 });
  }
  async prepare(
    actor: MediaActor,
    key: string,
    raw: z.input<typeof PrepareNativeQuarantineSchema>,
  ) {
    requireOwner(actor);
    const input = PrepareNativeQuarantineSchema.parse(raw);
    return this.command(
      actor,
      key,
      { kind: "prepare_native_quarantine", input },
      async (tx) => {
        const initial = await buildNativeQuarantineScope(tx, input);
        await lockNativeQuarantineScope(tx, initial);
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
            "Inspect the current restore state before preparing quarantine recovery",
            409,
          );
        const scope = await buildNativeQuarantineScope(tx, input);
        if (
          snapshotHash(z.json().parse(scope)) !==
          snapshotHash(z.json().parse(initial))
        )
          throw new MediaError(
            "native_scope_changed",
            "Quarantine coverage changed; select the exact complete group again",
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
          key: `native-quarantine-prepare:${plan.id}`,
          kind: "prepare_native_quarantine",
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
    raw: z.input<typeof ApplyNativeRecoverySchema>,
  ) {
    requireOwner(actor);
    const input = ApplyNativeRecoverySchema.parse(raw);
    return this.command(
      actor,
      key,
      { kind: "apply_native_quarantine", input: { id, ...input } },
      async (tx) => {
        const initial = await tx.nativeRecoveryPlan.findUniqueOrThrow({
          where: { id },
        });
        const scope = NativeQuarantineScopeSchema.parse(initial.scope);
        await lockNativeQuarantineScope(tx, scope);
        await tx.$queryRaw`SELECT id FROM "NativeRecoveryPlan" WHERE id = ${id} FOR UPDATE`;
        await assertNativeOwner(tx, actor.id);
        const { plan } = await assertNativeQuarantineSnapshot(tx, id, scope);
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
            "Inspect and approve a fresh exact quarantine recovery plan",
            409,
          );
        await tx.nativeRecoveryPlan.update({
          where: { id },
          data: { state: "applying", version: { increment: 1 } },
        });
        const operationId = await queueOperation(tx, {
          key: `native-quarantine-apply:${id}:${input.planHash}`,
          kind: "apply_native_quarantine",
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
