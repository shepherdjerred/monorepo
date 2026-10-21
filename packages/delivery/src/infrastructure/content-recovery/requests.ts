import { requireScope } from "#infrastructure/auth.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import {
  audit,
  lock,
  remember,
  request,
  required,
} from "#infrastructure/delivery-records.ts";
import { DeliveryError } from "#domain/error.ts";
import {
  RequestContentRecoverySchema,
  ContentRecoveryContextSchema,
  type RequestContentRecovery,
  type Principal,
} from "#shared/contract.ts";
import { createIntent, findIntent } from "#infrastructure/recovery-intents.ts";
import {
  contentIntentView,
  heldContentRecovery,
  contentSettlements,
} from "./context.ts";
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
      return contentIntentView(
        await findIntent(tx, previous.resultId, "content"),
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
      (await tx.recoveryIntent.findFirst({
        where: { deploymentId, status: "pending" },
      })) !== null
    )
      throw new DeliveryError(
        "CONFLICT",
        "The failed content release already has an independent recovery intent",
      );
    const intent = await createIntent(tx, {
      id: input.requestId,
      kind: "content",
      deploymentId,
      requestedBy: actor.id,
      reason: input.reason,
      expectedGeneration: input.expectedEnvironmentGeneration,
      snapshotFingerprint: held.snapshotFingerprint,
      detail: { targetKind: held.targetKind, nativeReceipts: [] },
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
    return contentIntentView(intent);
  });
}

export async function contentRecovery(
  this: Delivery,
  id: string,
  actor: Principal,
) {
  requireScope(actor, "read");
  const intent = await findIntent(this.database, id, "content");
  const detail = await this.detail(intent.deploymentId);
  // The prior selection is the accepted deployment the failed one replaced,
  // named exactly by the request rather than reconstructed by matching.
  const priorId = detail.deployment.previousAcceptedDeploymentId;
  const priorDetail = priorId === null ? null : await this.detail(priorId);
  const history = await this.database.recoveryIntent.findMany({
    where: { deploymentId: intent.deploymentId, kind: "content" },
    orderBy: { createdAt: "asc" },
  });
  return ContentRecoveryContextSchema.parse({
    intent: contentIntentView(intent),
    deployment: detail,
    priorDeployment: priorDetail,
    expectedSettlements: contentSettlements(detail, priorDetail),
    recoveryHistory: history.map((entry) => contentIntentView(entry)),
  });
}
