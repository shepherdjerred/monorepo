import {
  RequestWorkerRecoverySchema,
  WorkerPoolSnapshotSchema,
  WorkerRecoveryIntentSchema,
} from "#shared/contract.ts";
import type { Principal, RequestWorkerRecovery } from "#shared/contract.ts";
import type { RecoveryIntent } from "#generated/prisma/client.ts";
import { DeliveryError } from "#domain/error.ts";
import { requireScope } from "#infrastructure/auth.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import {
  audit,
  fingerprint,
  lock,
  remember,
  request,
  required,
  wire,
} from "#infrastructure/delivery-records.ts";
import type { Transaction } from "#infrastructure/delivery-data.ts";
import {
  createIntent,
  findIntent,
  intentDetail,
  legacyIntentFields,
} from "#infrastructure/recovery-intents.ts";
import { readWorkerVersions } from "./pool.ts";
import { requireNoContentBarrier } from "#infrastructure/content-recovery/ownership.ts";

/** The worker-kind view of a unified recovery intent row. */
export function workerIntentView(row: RecoveryIntent) {
  return WorkerRecoveryIntentSchema.parse(
    wire({
      ...legacyIntentFields(row),
      poolFingerprint: intentDetail(row)["poolFingerprint"],
    }),
  );
}

export async function recoveryOwnership(
  tx: Transaction,
  deploymentId: string,
  expectedGeneration: number,
) {
  await lock(tx, "delivery:claim");
  await requireNoContentBarrier(tx);
  await lock(tx, `deployment:${deploymentId}`);
  const deployment = required(
    await tx.deployment.findUnique({ where: { id: deploymentId } }),
    "Worker deployment",
  );
  await lock(tx, `environment:${deployment.environmentId}`);
  const env = await tx.environment.findUniqueOrThrow({
    where: { id: deployment.environmentId },
  });
  if (
    !deployment.recoveryRequired ||
    !["failed", "canceled"].includes(deployment.status) ||
    env.activeDeploymentId !== deploymentId ||
    env.generation !== expectedGeneration
  )
    throw new DeliveryError(
      "CONFLICT",
      "Recovery no longer owns the same failed deployment and environment generation",
    );
  if (deployment.workerSnapshot === null)
    throw new DeliveryError(
      "INVALID",
      "Worker recovery requires a frozen retained-host snapshot",
    );
  const snapshot = WorkerPoolSnapshotSchema.parse(deployment.workerSnapshot);
  const locks = await tx.targetLock.findMany({ where: { deploymentId } });
  const application = snapshot.versions[0]?.host.application;
  if (
    application === undefined ||
    !locks.some((held) => held.instance === `application:${application}`)
  )
    throw new DeliveryError(
      "CONFLICT",
      "Recovery no longer owns its fixed worker Application lock",
    );
  const pool = {
    environmentId: env.id,
    generation: env.generation,
    versions: await readWorkerVersions(tx, env.id),
  };
  const snapshotFingerprint = fingerprint({
    id: deployment.id,
    environmentId: deployment.environmentId,
    versionSetRevisionId: deployment.versionSetRevisionId,
    pipelineRevisionId: deployment.pipelineRevisionId,
    configurationId: deployment.configurationId,
    workerSnapshot: snapshot,
  });
  return {
    deployment,
    snapshot,
    pool,
    snapshotFingerprint,
    poolFingerprint: fingerprint(pool),
  };
}

export async function requestWorkerRecovery(
  this: Delivery,
  ...args: [
    deploymentId: string,
    rawInput: RequestWorkerRecovery,
    actor: Principal,
  ]
) {
  const [deploymentId, rawInput, actor] = args;
  requireScope(actor, "admin");
  const input = RequestWorkerRecoverySchema.parse(rawInput);
  const requestInput = { deploymentId, ...input };
  return this.database.$transaction(async (tx) => {
    const prior = await request(tx, actor, {
      requestId: input.requestId,
      input: requestInput,
      resultType: "worker-recovery",
    });
    if (prior !== null)
      return workerIntentView(await findIntent(tx, prior.resultId, "worker"));
    const context = await recoveryOwnership(
      tx,
      deploymentId,
      input.expectedEnvironmentGeneration,
    );
    if (
      (await tx.recoveryIntent.findFirst({
        where: { deploymentId, status: "pending" },
      })) !== null
    )
      throw new DeliveryError(
        "CONFLICT",
        "Worker deployment already has a pending recovery inspection",
      );
    const intent = await createIntent(tx, {
      id: input.requestId,
      kind: "worker",
      deploymentId,
      requestedBy: actor.id,
      reason: input.reason,
      expectedGeneration: input.expectedEnvironmentGeneration,
      snapshotFingerprint: context.snapshotFingerprint,
      workflowId: `delivery-worker-recovery/${input.requestId}`,
      detail: { poolFingerprint: context.poolFingerprint },
    });
    await remember(tx, actor, {
      requestId: input.requestId,
      input: requestInput,
      resultType: "worker-recovery",
      resultId: intent.id,
    });
    await audit(tx, actor, {
      action: "worker.recovery_requested",
      entityId: deploymentId,
      requestId: input.requestId,
      metadata: {
        intentId: intent.id,
        snapshotFingerprint: context.snapshotFingerprint,
        poolFingerprint: context.poolFingerprint,
        reason: input.reason,
      },
    });
    return workerIntentView(intent);
  });
}

export async function workerRecovery(
  this: Delivery,
  intentId: string,
  actor: Principal,
) {
  requireScope(actor, "read");
  const intent = workerIntentView(
    await findIntent(this.database, intentId, "worker"),
  );
  const deployment = await this.detail(intent.deploymentId);
  const pool = await this.workers(deployment.environment.id, actor);
  return { intent, deployment, pool };
}

export async function pendingWorkerRecovery(this: Delivery, actor: Principal) {
  requireScope(actor, "execute");
  const intents = await this.database.recoveryIntent.findMany({
    where: { kind: "worker", status: "pending" },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
  return { intents: intents.map((intent) => workerIntentView(intent)) };
}

export async function submittedWorkerRecovery(
  this: Delivery,
  ...args: [intentId: string, workflowId: string, actor: Principal]
) {
  const [intentId, workflowId, actor] = args;
  requireScope(actor, "execute");
  const intent = await findIntent(this.database, intentId, "worker");
  if (intent.workflowId !== workflowId)
    throw new DeliveryError(
      "CONFLICT",
      "Worker recovery Workflow identity differs from its intent",
    );
  await this.database.recoveryIntent.updateMany({
    where: { id: intentId, status: "pending", submittedAt: null },
    data: { submittedAt: new Date() },
  });
  return { accepted: true };
}
