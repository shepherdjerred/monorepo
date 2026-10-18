import { requireScope } from "#infrastructure/auth.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import {
  audit,
  lock,
  remember,
  request,
  required,
  wire,
} from "#infrastructure/delivery-records.ts";
import { DeliveryError } from "#domain/error.ts";
import {
  RequestContentRecoverySchema,
  ContentRecoveryIntentSchema,
  ContentRecoveryContextSchema,
  type RequestContentRecovery,
  type Principal,
} from "#shared/contract.ts";
import { heldContentRecovery, contentSettlements } from "./context.ts";
import { requireNoContentBarrier } from "./ownership.ts";

export async function requestContentRecovery(
  this: Delivery,
  deploymentId: string,
  raw: RequestContentRecovery,
  actor: Principal,
) {
  requireScope(actor, "admin");
  const input = RequestContentRecoverySchema.parse(raw),
    identity = { deploymentId, ...input };
  return this.database.$transaction(async (tx) => {
    const previous = await request(tx, actor, {
      requestId: input.requestId,
      input: identity,
      resultType: "content-recovery",
    });
    if (previous !== null)
      return ContentRecoveryIntentSchema.parse(
        wire(
          required(
            await tx.contentRecoveryIntent.findUnique({
              where: { id: previous.resultId },
            }),
            "Content recovery intent",
          ),
        ),
      );
    await lock(tx, "delivery:claim");
    await requireNoContentBarrier(tx);
    await lock(tx, `deployment:${deploymentId}`);
    const row = required(
      await tx.deployment.findUnique({ where: { id: deploymentId } }),
      "Content recovery source",
    );
    await lock(tx, `environment:${row.environmentId}`);
    const held = await heldContentRecovery(tx, {
      deploymentId,
      expectedEnvironmentGeneration: input.expectedEnvironmentGeneration,
    });
    if (
      (await tx.contentRecoveryIntent.findFirst({
        where: { deploymentId, status: "pending" },
      })) !== null
    )
      throw new DeliveryError(
        "CONFLICT",
        "The failed content release already has an independent recovery intent",
      );
    const intent = await tx.contentRecoveryIntent.create({
      data: {
        id: input.requestId,
        deploymentId,
        targetKind: held.targetKind,
        requestedBy: actor.id,
        reason: input.reason,
        expectedEnvironmentGeneration: input.expectedEnvironmentGeneration,
        snapshotFingerprint: held.snapshotFingerprint,
      },
    });
    await tx.deployment.update({
      where: { id: deploymentId },
      data: { cancelRequested: true },
    });
    await remember(tx, actor, {
      requestId: input.requestId,
      input: identity,
      resultType: "content-recovery",
      resultId: intent.id,
    });
    await audit(tx, actor, {
      action: "content.recovery_requested",
      entityId: intent.id,
      requestId: input.requestId,
      metadata: {
        deploymentId,
        reason: input.reason,
        snapshotFingerprint: held.snapshotFingerprint,
      },
    });
    return ContentRecoveryIntentSchema.parse(wire(intent));
  });
}

export async function contentRecovery(
  this: Delivery,
  id: string,
  actor: Principal,
) {
  requireScope(actor, "read");
  const intent = required(
    await this.database.contentRecoveryIntent.findUnique({ where: { id } }),
    "Content recovery intent",
  );
  const detail = await this.detail(intent.deploymentId);
  const prior =
    detail.deployment.previousAcceptedVersionSetRevisionId === null ||
    detail.deployment.previousAcceptedConfiguration === null
      ? null
      : await this.database.deployment.findFirst({
          where: {
            environmentId: detail.environment.id,
            status: "succeeded",
            versionSetRevisionId:
              detail.deployment.previousAcceptedVersionSetRevisionId,
            serviceId: detail.deployment.serviceId,
            configuration: {
              equals: detail.deployment.previousAcceptedConfiguration,
            },
            kind: { in: ["deploy", "promote", "rollback"] },
            finishedAt: { lte: new Date(detail.deployment.createdAt) },
          },
          orderBy: { finishedAt: "desc" },
        });
  const priorDetail = prior === null ? null : await this.detail(prior.id);
  return ContentRecoveryContextSchema.parse({
    intent: wire(intent),
    deployment: detail,
    priorDeployment: priorDetail,
    expectedSettlements: contentSettlements(detail, priorDetail),
    recoveryHistory: wire(
      await this.database.contentRecoveryIntent.findMany({
        where: { deploymentId: intent.deploymentId },
        orderBy: { createdAt: "asc" },
      }),
    ),
  });
}
