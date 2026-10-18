import {
  RequestWorkerRecoverySchema,
  WorkerPoolSnapshotSchema,
  WorkerRecoveryIntentSchema,
} from "#shared/contract.ts";
import type { Principal, RequestWorkerRecovery } from "#shared/contract.ts";
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
import { readWorkerVersions } from "./pool.ts";

export async function recoveryOwnership(
  tx: Transaction,
  deploymentId: string,
  expectedGeneration: number,
) {
  await lock(tx, "delivery:claim");
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
  const held = await tx.applicationLock.findUnique({ where: { deploymentId } });
  const application = snapshot.versions[0]?.host.application;
  if (held?.application !== application)
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
    configurationRevision: deployment.configurationRevision,
    configuration: deployment.configuration,
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
      return WorkerRecoveryIntentSchema.parse(
        wire(
          required(
            await tx.workerRecoveryIntent.findUnique({
              where: { id: prior.resultId },
            }),
            "Worker recovery intent",
          ),
        ),
      );
    const context = await recoveryOwnership(
      tx,
      deploymentId,
      input.expectedEnvironmentGeneration,
    );
    if (
      (await tx.workerRecoveryIntent.findFirst({
        where: { deploymentId, status: "pending" },
      })) !== null
    )
      throw new DeliveryError(
        "CONFLICT",
        "Worker deployment already has a pending recovery inspection",
      );
    const intent = await tx.workerRecoveryIntent.create({
      data: {
        id: input.requestId,
        deploymentId,
        requestedBy: actor.id,
        reason: input.reason,
        expectedEnvironmentGeneration: input.expectedEnvironmentGeneration,
        snapshotFingerprint: context.snapshotFingerprint,
        poolFingerprint: context.poolFingerprint,
        workflowId: `delivery-worker-recovery/${input.requestId}`,
      },
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
    return WorkerRecoveryIntentSchema.parse(wire(intent));
  });
}

export async function workerRecovery(
  this: Delivery,
  intentId: string,
  actor: Principal,
) {
  requireScope(actor, "read");
  const intent = WorkerRecoveryIntentSchema.parse(
    wire(
      required(
        await this.database.workerRecoveryIntent.findUnique({
          where: { id: intentId },
        }),
        "Worker recovery intent",
      ),
    ),
  );
  const deployment = await this.detail(intent.deploymentId);
  const pool = await this.workers(deployment.environment.id, actor);
  return { intent, deployment, pool };
}

export async function pendingWorkerRecovery(this: Delivery, actor: Principal) {
  requireScope(actor, "execute");
  const intents = await this.database.workerRecoveryIntent.findMany({
    where: { status: "pending" },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
  return {
    intents: intents.map((intent) =>
      WorkerRecoveryIntentSchema.parse(wire(intent)),
    ),
  };
}

export async function submittedWorkerRecovery(
  this: Delivery,
  ...args: [intentId: string, workflowId: string, actor: Principal]
) {
  const [intentId, workflowId, actor] = args;
  requireScope(actor, "execute");
  const intent = required(
    await this.database.workerRecoveryIntent.findUnique({
      where: { id: intentId },
    }),
    "Worker recovery intent",
  );
  if (intent.workflowId !== workflowId)
    throw new DeliveryError(
      "CONFLICT",
      "Worker recovery Workflow identity differs from its intent",
    );
  await this.database.workerRecoveryIntent.updateMany({
    where: { id: intentId, status: "pending", submittedAt: null },
    data: { submittedAt: new Date() },
  });
  return { accepted: true };
}
