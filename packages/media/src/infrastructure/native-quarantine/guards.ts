import { Prisma } from "#generated/prisma/client.ts";
import { z } from "zod";
import {
  NativeQuarantineScopeSchema,
  type NativeQuarantineScope,
} from "#shared/native-recovery/quarantine.ts";
import {
  lockNativeScope,
  assertNativeExclusion,
} from "#infrastructure/native-recovery/guards.ts";
import { runtimeAuthority } from "#infrastructure/handoff/authority.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { buildNativeQuarantineScope } from "./scope.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";

export async function lockNativeQuarantineScope(
  tx: Prisma.TransactionClient,
  scope: NativeQuarantineScope,
) {
  await lockNativeScope(tx, scope);
  const decisions = scope.groups
    .flatMap((group) => group.decisions.map((row) => row.id))
    .sort();
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM "RetentionDecision" WHERE id IN (${Prisma.join(decisions)}) ORDER BY id FOR SHARE`,
  );
}

export async function assertNativeQuarantineSnapshot(
  tx: Prisma.TransactionClient,
  planId: string,
  scope: NativeQuarantineScope,
  budget = new PublicationAuthorityReadBudget(),
) {
  await assertNativeExclusion(tx);
  const plan = await tx.nativeRecoveryPlan.findUniqueOrThrow({
    where: { id: planId },
  });
  const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  const mode = scope.request.activation === "activate" ? "observe" : "active";
  budget.consume(1);
  const authority = await runtimeAuthority(tx);
  if (
    runtime.mode !== mode ||
    runtime.recoveryEpoch !== plan.recoveryEpoch ||
    runtime.version !== plan.runtimeVersion ||
    plan.restoreOperationId !== scope.request.restoreOperationId ||
    (mode === "observe" ? runtime.ownershipConfirmed : !authority.active)
  )
    throw new Error("Native quarantine runtime changed");
  const stored = NativeQuarantineScopeSchema.parse(plan.scope);
  const current = await buildNativeQuarantineScope(
    tx,
    scope.request,
    budget,
    scope.storageRoots,
  );
  if (
    snapshotHash(z.json().parse(stored)) !==
      snapshotHash(z.json().parse(scope)) ||
    snapshotHash(z.json().parse(current)) !==
      snapshotHash(z.json().parse(scope))
  )
    throw new Error("Native quarantine reviewed records changed");
  return { plan, runtime, scope: current };
}
