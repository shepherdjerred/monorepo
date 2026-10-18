import {
  RequestPlatformRecoverySchema,
  PlatformRecoveryContextSchema,
  PlatformRecoveryIntentSchema,
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
  wire,
} from "#infrastructure/delivery-records.ts";
import { heldPlatformRecovery, platformSettlements } from "./context.ts";

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
      return PlatformRecoveryIntentSchema.parse(
        wire(
          required(
            await tx.platformRecoveryIntent.findUnique({
              where: { id: previous.resultId },
            }),
            "Platform recovery",
          ),
        ),
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
    const pending = await tx.platformRecoveryIntent.findFirst({
      where: { deploymentId, status: "pending" },
    });
    if (pending !== null)
      throw new DeliveryError(
        "CONFLICT",
        "This quarantined infrastructure operation already has a pending independent inspection",
      );
    const intent = await tx.platformRecoveryIntent.create({
      data: {
        id: input.requestId,
        deploymentId,
        requestedBy: actor.id,
        reason: input.reason,
        expectedEnvironmentGeneration: input.expectedEnvironmentGeneration,
        snapshotFingerprint: source.snapshotFingerprint,
        workflowId: `delivery-platform-recovery/${input.requestId}`,
      },
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
    return PlatformRecoveryIntentSchema.parse(wire(intent));
  });
}

export async function platformRecovery(
  this: Delivery,
  intentId: string,
  actor: Principal,
) {
  requireScope(actor, "read");
  const row = required(
    await this.database.platformRecoveryIntent.findUnique({
      where: { id: intentId },
    }),
    "Platform recovery intent",
  );
  const detail = await this.detail(row.deploymentId);
  const priorId =
    detail.deployment.controlPlaneSnapshot === null
      ? detail.environment.acceptedPlatformDeploymentId
      : detail.environment.acceptedControlPlaneDeploymentId;
  const prior = priorId === null ? null : await this.detail(priorId);
  const recoveryHistory = await this.database.platformRecoveryIntent.findMany({
    where: { deploymentId: row.deploymentId },
    orderBy: { createdAt: "asc" },
  });
  return PlatformRecoveryContextSchema.parse({
    intent: wire(row),
    deployment: detail,
    priorDeployment: prior,
    recoveryHistory: wire(recoveryHistory),
    expectedSettlements: platformSettlements(detail, prior),
  });
}

export async function pendingPlatformRecovery(
  this: Delivery,
  actor: Principal,
) {
  requireScope(actor, "execute");
  const rows = await this.database.platformRecoveryIntent.findMany({
    where: { status: "pending" },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
  return {
    intents: rows.map((row) => PlatformRecoveryIntentSchema.parse(wire(row))),
  };
}

export async function submittedPlatformRecovery(
  this: Delivery,
  intentId: string,
  workflowId: string,
  actor: Principal,
) {
  requireScope(actor, "execute");
  const row = required(
    await this.database.platformRecoveryIntent.findUnique({
      where: { id: intentId },
    }),
    "Platform recovery intent",
  );
  if (row.status !== "pending" || row.workflowId !== workflowId)
    throw new DeliveryError(
      "CONFLICT",
      "Infrastructure recovery submission differs from the immutable pending Workflow",
    );
  return PlatformRecoveryIntentSchema.parse(
    wire(
      await this.database.platformRecoveryIntent.update({
        where: { id: intentId },
        data: { submittedAt: row.submittedAt ?? new Date() },
      }),
    ),
  );
}
