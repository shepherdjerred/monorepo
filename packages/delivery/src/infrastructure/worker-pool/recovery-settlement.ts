import {
  CompleteWorkerRecoverySchema,
  FailWorkerRecoverySchema,
  workerHostSpecification,
} from "#shared/contract.ts";
import type { CompleteWorkerRecovery, Principal } from "#shared/contract.ts";
import { DeliveryError } from "#domain/error.ts";
import { requireScope } from "#infrastructure/auth.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import { audit, fingerprint, lock } from "#infrastructure/delivery-records.ts";
import { evidence } from "#infrastructure/delivery-data.ts";
import {
  bareFingerprint,
  findIntent,
  intentDetail,
} from "#infrastructure/recovery-intents.ts";
import { releaseDeploymentLocks } from "#infrastructure/recovery-settlement.ts";
import { recoveryOwnership, workerIntentView } from "./recovery.ts";

function routeKey(route: {
  namespace: string;
  deploymentName: string;
  taskQueue: string;
}) {
  return `${route.namespace}/${route.deploymentName}/${route.taskQueue}`;
}

function requireFreshStableRoutes(
  input: CompleteWorkerRecovery,
  context: Awaited<ReturnType<typeof recoveryOwnership>>,
) {
  const timestamp = Date.parse(input.observedAt);
  if (timestamp < Date.now() - 60_000 || timestamp > Date.now() + 5000)
    throw new DeliveryError(
      "CONFLICT",
      "Worker recovery observations must be fresh within sixty seconds",
    );
  const expected = workerHostSpecification(context.snapshot.target).routes;
  const hosted = new Set(
    [...context.pool.versions, ...context.snapshot.versions]
      .filter((version) => version.replicas === 1)
      .map((version) => version.buildId),
  );
  const observed = new Set(input.routes.map((route) => routeKey(route)));
  if (
    observed.size !== expected.length ||
    input.routes.length !== expected.length ||
    expected.some((route) => !observed.has(routeKey(route))) ||
    input.routes.some((route) => !hosted.has(route.currentBuildId))
  )
    throw new DeliveryError(
      "CONFLICT",
      "Worker recovery must observe stable routing to retained original hosts in every fixed namespace and queue",
    );
}

export async function completeWorkerRecovery(
  this: Delivery,
  ...args: [
    intentId: string,
    rawInput: CompleteWorkerRecovery,
    actor: Principal,
  ]
) {
  const [intentId, rawInput, actor] = args;
  requireScope(actor, "execute");
  const input = CompleteWorkerRecoverySchema.parse(rawInput);
  return this.database.$transaction(async (tx) => {
    await lock(tx, `worker-recovery:${intentId}`);
    const intent = await findIntent(tx, intentId, "worker");
    const resultFingerprint = fingerprint(input);
    if (intent.status !== "pending") {
      if (
        intent.status !== "succeeded" ||
        intent.resultFingerprint !== resultFingerprint
      )
        throw new DeliveryError(
          "CONFLICT",
          "Worker recovery result is immutable",
        );
      return workerIntentView(intent);
    }
    const snapshotFingerprint = bareFingerprint(intent.fingerprint);
    const poolFingerprint = intentDetail(intent)["poolFingerprint"];
    const context = await recoveryOwnership(
      tx,
      intent.deploymentId,
      intent.expectedGeneration,
    );
    if (
      input.expectedEnvironmentGeneration !== intent.expectedGeneration ||
      input.snapshotFingerprint !== snapshotFingerprint ||
      input.poolFingerprint !== poolFingerprint ||
      context.snapshotFingerprint !== snapshotFingerprint ||
      context.poolFingerprint !== poolFingerprint
    )
      throw new DeliveryError(
        "CONFLICT",
        "Worker recovery frozen selection, pool, or environment generation changed",
      );
    requireFreshStableRoutes(input, context);
    await evidence(
      tx,
      intent.deploymentId,
      input.evidence,
      `worker-recovery/${intentId}`,
    );
    await releaseDeploymentLocks(tx, intent.deploymentId);
    await tx.environment.update({
      where: { id: context.pool.environmentId },
      data: { activeDeploymentId: null },
    });
    await tx.deployment.update({
      where: { id: intent.deploymentId },
      data: { recoveryRequired: false },
    });
    const updated = await tx.recoveryIntent.update({
      where: { id: intentId },
      data: {
        status: "succeeded",
        message:
          "Independent read-only inspection verified settled worker operations and routing; original deployment remains failed or canceled",
        resultFingerprint,
        evidence: input.evidence,
        finishedAt: new Date(),
      },
    });
    await audit(tx, actor, {
      action: "worker.recovery_completed",
      entityId: intent.deploymentId,
      requestId: intentId,
      metadata: {
        observedAt: input.observedAt,
        snapshotFingerprint,
        poolFingerprint: input.poolFingerprint,
        routes: input.routes,
      },
    });
    return workerIntentView(updated);
  });
}

export async function failWorkerRecovery(
  this: Delivery,
  ...args: [intentId: string, message: string, actor: Principal]
) {
  const [intentId, message, actor] = args;
  requireScope(actor, "execute");
  const input = FailWorkerRecoverySchema.parse({ message });
  return this.database.$transaction(async (tx) => {
    await lock(tx, `worker-recovery:${intentId}`);
    const intent = await findIntent(tx, intentId, "worker");
    if (intent.status !== "pending") {
      if (
        intent.status !== "failed" ||
        intent.resultFingerprint !== fingerprint(input)
      )
        throw new DeliveryError(
          "CONFLICT",
          "Worker recovery result is immutable",
        );
      return workerIntentView(intent);
    }
    const updated = await tx.recoveryIntent.update({
      where: { id: intentId },
      data: {
        status: "failed",
        message: input.message,
        resultFingerprint: fingerprint(input),
        finishedAt: new Date(),
      },
    });
    await audit(tx, actor, {
      action: "worker.recovery_failed",
      entityId: intent.deploymentId,
      requestId: intentId,
      metadata: { message: input.message },
    });
    return workerIntentView(updated);
  });
}
