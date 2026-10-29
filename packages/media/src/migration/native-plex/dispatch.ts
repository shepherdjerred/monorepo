import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import { NativeStoredScopeSchema } from "#shared/native-recovery/lifecycle.ts";
import { validateNativePlexReceipt } from "#infrastructure/plex-binding/native/native-version.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";

const commands = {
  published: ["prepare_native_recovery", "apply_native_recovery"],
  committed_quarantine: [
    "prepare_native_quarantine",
    "apply_native_quarantine",
  ],
  superseded_archive: ["prepare_native_archive", "apply_native_archive"],
  publication_compensation: [
    "prepare_native_compensation",
    "apply_native_compensation",
  ],
} as const;

/** Immutable command/receipt ACK precedes all fresh config and proof expiry checks. */
export async function nativeReviewDispatch(
  tx: Prisma.TransactionClient,
  input: { planId: string; operationId: string },
  budget: PublicationAuthorityReadBudget,
) {
  const plan = await tx.nativeRecoveryPlan.findUniqueOrThrow({
    where: { id: input.planId },
    include: { receipt: true },
  });
  budget.consume(1 + (plan.receipt === null ? 0 : 1));
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: input.operationId },
  });
  budget.consume(1);
  const scope = NativeStoredScopeSchema.parse(plan.scope);
  const lifecycleKind =
    scope.schemaVersion === 1 ? "published" : scope.lifecycleKind;
  const apply = assertDispatchCommand(plan, operation, lifecycleKind);
  const receipt = plan.receipt;
  if (receipt !== null) {
    assertDispatchReceipt(plan, receipt);
    const verified = await validateNativePlexReceipt(
      tx,
      { ...receipt, plan },
      budget,
    );
    if (verified !== null) {
      const selected = apply ? verified.applied : verified.approved;
      if (selected.ref.parent.operationId !== input.operationId)
        throw new Error(
          "Native receipt belongs to another observation command",
        );
    }
    return { kind: "complete" as const, lifecycleKind };
  }
  if (plan.state === "applied")
    throw new Error("Applied native plan omitted immutable receipt");
  if (plan.plan === null) return { kind: "paired" as const, lifecycleKind };
  const version = z
    .object({
      schemaVersion: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    })
    .parse(plan.plan).schemaVersion;
  if (version === 3) return { kind: "paired" as const, lifecycleKind };
  if (!apply)
    throw new Error("Historical finished plan cannot become a new preparation");
  return { kind: "legacy" as const, lifecycleKind };
}

function assertDispatchReceipt(
  plan: Prisma.NativeRecoveryPlanGetPayload<{ include: { receipt: true } }>,
  receipt: NonNullable<typeof plan.receipt>,
) {
  if (
    plan.state !== "applied" ||
    receipt.planId !== plan.id ||
    receipt.actorId !== plan.actorId ||
    receipt.recoveryEpoch !== plan.recoveryEpoch ||
    receipt.planHash !== plan.planHash ||
    identityHash(
      z.object({ scope: z.json() }).parse(receipt.selection).scope,
    ) !== identityHash(plan.scope)
  )
    throw new Error("Native immutable observation receipt changed");
}

function assertDispatchCommand(
  plan: Prisma.NativeRecoveryPlanGetPayload<{ include: { receipt: true } }>,
  operation: Prisma.OperationGetPayload<Record<string, never>>,
  lifecycleKind: keyof typeof commands,
) {
  const kinds = commands[lifecycleKind];
  const apply = operation.kind === kinds[1];
  const common = z.strictObject({
    planId: z.uuid(),
    operationId: z.uuid(),
    kind: z.enum(kinds),
    recoveryEpoch: z.int().nonnegative(),
  });
  const payload = apply
    ? common
        .extend({
          planHash: z.string().regex(/^[a-f0-9]{64}$/u),
          actorId: z.uuid(),
        })
        .parse(operation.payload)
    : common.parse(operation.payload);
  if (
    operation.targetId !== plan.id ||
    operation.userId !== plan.actorId ||
    payload.planId !== plan.id ||
    payload.operationId !== operation.id ||
    payload.kind !== operation.kind ||
    payload.recoveryEpoch !== plan.recoveryEpoch ||
    (apply &&
      (!("actorId" in payload) ||
        payload.actorId !== plan.actorId ||
        !("planHash" in payload) ||
        payload.planHash !== plan.planHash))
  )
    throw new Error("Native observation command changed");
  if (
    plan.plan !== null &&
    (plan.planHash === null || identityHash(plan.plan) !== plan.planHash)
  )
    throw new Error("Native finished plan raw hash changed");
  return apply;
}
