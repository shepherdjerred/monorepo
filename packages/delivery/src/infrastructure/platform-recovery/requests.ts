import {
  RequestPlatformRecoverySchema,
  PlatformRecoveryContextSchema,
  type RequestPlatformRecovery,
  type Principal,
} from "#shared/contract.ts";
import { requireScope } from "#infrastructure/auth.ts";
import { DeliveryError } from "#domain/error.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import {
  audit,
  lock,
  remember,
  request,
  required,
} from "#infrastructure/delivery-records.ts";
import { createIntent, findIntent } from "#infrastructure/recovery-intents.ts";
import {
  heldPlatformRecovery,
  platformIntentView,
  platformSettlements,
} from "./context.ts";

export async function requestPlatformRecovery(
  this: Delivery,
  deploymentId: string,
  raw: RequestPlatformRecovery,
  actor: Principal,
) {
  requireScope(actor, "admin");
  const input = RequestPlatformRecoverySchema.parse(raw),
    requestInput = { deploymentId, ...input };
  return this.database.$transaction(async (tx) => {
    const previous = await request(tx, actor, {
      requestId: input.requestId,
      input: requestInput,
      resultType: "platform-recovery",
    });
    if (previous !== null)
      return platformIntentView(
        await findIntent(tx, previous.resultId, "platform"),
      );
    await lock(tx, "delivery:claim");
    await lock(tx, `deployment:${deploymentId}`);
    const initial = required(
      await tx.deployment.findUnique({ where: { id: deploymentId } }),
      "Platform recovery source",
    );
    await lock(tx, `environment:${initial.environmentId}`);
    const source = await heldPlatformRecovery(tx, {
      deploymentId,
      expectedEnvironmentGeneration: input.expectedEnvironmentGeneration,
    });
    const pending = await tx.recoveryIntent.findFirst({
      where: { deploymentId, status: "pending" },
    });
    if (pending !== null)
      throw new DeliveryError(
        "CONFLICT",
        "This quarantined infrastructure operation already has a pending independent inspection",
      );
    const intent = await createIntent(tx, {
      id: input.requestId,
      kind: "platform",
      deploymentId,
      requestedBy: actor.id,
      reason: input.reason,
      expectedGeneration: input.expectedEnvironmentGeneration,
      snapshotFingerprint: source.snapshotFingerprint,
      workflowId: `delivery-platform-recovery/${input.requestId}`,
      detail: { nativeReceipts: [] },
    });
    await tx.deployment.update({
      where: { id: deploymentId },
      data: { cancelRequested: true },
    });
    await remember(tx, actor, {
      requestId: input.requestId,
      input: requestInput,
      resultType: "platform-recovery",
      resultId: intent.id,
    });
    await audit(tx, actor, {
      action: "platform.recovery_requested",
      entityId: intent.id,
      requestId: input.requestId,
      metadata: {
        deploymentId,
        reason: input.reason,
        snapshotFingerprint: source.snapshotFingerprint,
      },
    });
    return platformIntentView(intent);
  });
}

export async function platformRecovery(
  this: Delivery,
  intentId: string,
  actor: Principal,
) {
  requireScope(actor, "read");
  const row = await findIntent(this.database, intentId, "platform");
  const detail = await this.detail(row.deploymentId);
  const priorId = detail.environment.acceptedDeploymentId;
  const prior = priorId === null ? null : await this.detail(priorId);
  const recoveryHistory = await this.database.recoveryIntent.findMany({
    where: { deploymentId: row.deploymentId, kind: "platform" },
    orderBy: { createdAt: "asc" },
  });
  return PlatformRecoveryContextSchema.parse({
    intent: platformIntentView(row),
    deployment: detail,
    priorDeployment: prior,
    recoveryHistory: recoveryHistory.map((entry) => platformIntentView(entry)),
    expectedSettlements: platformSettlements(detail, prior),
  });
}

export async function pendingPlatformRecovery(
  this: Delivery,
  actor: Principal,
) {
  requireScope(actor, "execute");
  const rows = await this.database.recoveryIntent.findMany({
    where: { kind: "platform", status: "pending" },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
  return { intents: rows.map((row) => platformIntentView(row)) };
}

export async function submittedPlatformRecovery(
  this: Delivery,
  intentId: string,
  workflowId: string,
  actor: Principal,
) {
  requireScope(actor, "execute");
  const row = await findIntent(this.database, intentId, "platform");
  if (row.status !== "pending" || row.workflowId !== workflowId)
    throw new DeliveryError(
      "CONFLICT",
      "Infrastructure recovery submission differs from the immutable pending Workflow",
    );
  return platformIntentView(
    await this.database.recoveryIntent.update({
      where: { id: intentId },
      data: { submittedAt: row.submittedAt ?? new Date() },
    }),
  );
}
