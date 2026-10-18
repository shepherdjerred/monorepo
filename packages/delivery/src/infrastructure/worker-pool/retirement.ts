import { persistDeploymentRequest } from "#infrastructure/delivery-records.ts";
import {
  DeploymentSchema,
  RetireWorkerVersionSchema,
  WorkerPoolSnapshotSchema,
  WorkerRetirementClaimSchema,
} from "#shared/contract.ts";
import type {
  Principal,
  RetireWorkerVersion,
  WorkerRetirementClaim,
} from "#shared/contract.ts";
import { DeliveryError } from "#domain/error.ts";
import { requireScope } from "#infrastructure/auth.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import { id, type Transaction } from "#infrastructure/delivery-data.ts";
import {
  audit,
  lock,
  request,
  required,
  wire,
} from "#infrastructure/delivery-records.ts";
import { requireIdleWorkerEnvironment } from "./registration.ts";
import { readWorkerVersions, requireSameWorkerIdentity } from "./pool.ts";
import {
  requireUnreferencedWorker,
  retiringWorker,
  validateRetirementProof,
} from "./proof.ts";

export async function retireWorker(
  this: Delivery,
  ...args: [workerId: string, rawInput: RetireWorkerVersion, actor: Principal]
) {
  const [workerId, rawInput, actor] = args;
  requireScope(actor, "deploy");
  const input = RetireWorkerVersionSchema.parse(rawInput);
  const requestInput = { workerId, ...input };
  return this.database.$transaction(async (tx) => {
    const prior = await request(tx, actor, {
      requestId: input.requestId,
      input: requestInput,
      resultType: "deployment",
    });
    if (prior !== null)
      return DeploymentSchema.parse(
        wire(
          required(
            await tx.deployment.findUnique({ where: { id: prior.resultId } }),
            "Retirement deployment",
          ),
        ),
      );
    const record = required(
      await tx.workerVersion.findUnique({ where: { id: workerId } }),
      "Worker version",
    );
    await lock(tx, `environment:${record.environmentId}`);
    const env = await requireIdleWorkerEnvironment(tx, {
      environmentId: record.environmentId,
      expectedGeneration: input.expectedEnvironmentGeneration,
    });
    const versions = await readWorkerVersions(tx, env.id);
    const worker = required(
      versions.find((row) => row.id === workerId) ?? null,
      "Worker version",
    );
    if (
      worker.generation !== input.expectedWorkerGeneration ||
      worker.replicas !== 1
    )
      throw new DeliveryError(
        "CONFLICT",
        "Worker generation or desired replicas changed",
      );
    await requireUnreferencedWorker(tx, { worker });
    const accepted = required(
      await tx.deployment.findFirst({
        where: {
          environmentId: env.id,
          versionSetRevisionId: env.acceptedVersionSetRevisionId ?? "",
          status: "succeeded",
          kind: { notIn: ["adopt-worker", "repair-trmnl"] },
        },
        orderBy: { finishedAt: "desc" },
      }),
      "Accepted worker deployment",
    );
    if (accepted.workerSnapshot === null)
      throw new DeliveryError(
        "INVALID",
        "Retirement requires an accepted frozen worker pool baseline",
      );
    const baseline = WorkerPoolSnapshotSchema.parse(accepted.workerSnapshot);
    const frozen = WorkerPoolSnapshotSchema.parse({
      ...baseline,
      environmentGeneration: env.generation,
      restoredFromDeploymentId: accepted.id,
      workerOperation: "retire",
      retiringWorkerId: worker.id,
      versions: versions.map((row) =>
        row.id === workerId
          ? {
              ...row,
              replicas: 0,
              generation: row.generation + 1,
              retiredAt: new Date().toISOString(),
            }
          : row,
      ),
    });
    retiringWorker(frozen);
    const row = await tx.deployment.create({
      data: {
        id: id(),
        requestId: input.requestId,
        environmentId: env.id,
        serviceId: env.serviceId,
        versionSetRevisionId: accepted.versionSetRevisionId,
        pipelineRevisionId: accepted.pipelineRevisionId,
        configurationRevision: accepted.configurationRevision,
        configuration: DeploymentSchema.parse(wire(accepted)).configuration,
        previousAcceptedVersionSetRevisionId: env.acceptedVersionSetRevisionId,
        previousAcceptedConfiguration: DeploymentSchema.parse(wire(accepted))
          .configuration,
        workerSnapshot: frozen,
        expectedGeneration: env.generation,
        kind: "retire-worker",
        status: env.approvalRequired ? "awaiting_approval" : "queued",
        requestedBy: actor.id,
      },
    });
    await persistDeploymentRequest(tx, actor, {
      deployment: row,
      requestId: input.requestId,
      input: requestInput,
    });
    await audit(tx, actor, {
      action: "worker.retirement_requested",
      entityId: worker.id,
      requestId: input.requestId,
      metadata: { deploymentId: row.id, snapshot: frozen },
    });
    return DeploymentSchema.parse(wire(row));
  });
}

export async function validateWorkerRetirementClaim(
  tx: Transaction,
  input: {
    deployment: {
      id: string;
      environmentId: string;
      expectedGeneration: number;
      workerSnapshot: unknown;
    };
    proof: WorkerRetirementClaim | undefined;
    running: boolean;
  },
) {
  const { deployment: row } = input;
  const snapshot = WorkerPoolSnapshotSchema.parse(row.workerSnapshot);
  const frozen = retiringWorker(snapshot);
  const env = await tx.environment.findUniqueOrThrow({
    where: { id: row.environmentId },
  });
  const owned = input.running
    ? env.activeDeploymentId === row.id
    : env.activeDeploymentId === null;
  if (
    !owned ||
    env.generation !== row.expectedGeneration + (input.running ? 1 : 0)
  )
    throw new DeliveryError(
      "CONFLICT",
      "Worker retirement lost its environment generation or ownership",
    );
  if (input.running) {
    const held = await tx.applicationLock.findUnique({
      where: { deploymentId: row.id },
    });
    if (held?.application !== frozen.host.application)
      throw new DeliveryError(
        "CONFLICT",
        "Worker retirement no longer owns its Application lock",
      );
  }
  const versions = await readWorkerVersions(tx, row.environmentId);
  const worker = required(
    versions.find((version) => version.id === frozen.id) ?? null,
    "Retiring worker",
  );
  requireSameWorkerIdentity(worker, frozen);
  if (worker.replicas !== 1 || worker.generation + 1 !== frozen.generation)
    throw new DeliveryError(
      "CONFLICT",
      "Retiring worker changed since its frozen selection",
    );
  if (input.proof === undefined)
    throw new DeliveryError(
      "INVALID",
      "Retirement claim requires fresh executor drainage and routing proofs",
    );
  const proof = validateRetirementProof(
    worker,
    WorkerRetirementClaimSchema.parse(input.proof),
  );
  if (
    proof.proofs.some(
      (route) => route.currentBuildId !== snapshot.candidateBuildId,
    )
  )
    throw new DeliveryError(
      "CONFLICT",
      "Worker routing differs from the frozen accepted candidate",
    );
  await requireUnreferencedWorker(tx, {
    worker,
    retirementDeploymentId: row.id,
  });
  await tx.workerVersion.update({
    where: { id: worker.id },
    data: { retirementProof: { deploymentId: row.id, ...proof } },
  });
  return proof;
}

export async function acceptWorkerRetirement(
  tx: Transaction,
  deployment: { id: string; kind: string; workerSnapshot: unknown },
) {
  if (deployment.kind !== "retire-worker") return;
  const snapshot = WorkerPoolSnapshotSchema.parse(deployment.workerSnapshot);
  const worker = retiringWorker(snapshot);
  const changed = await tx.workerVersion.updateMany({
    where: { id: worker.id, generation: worker.generation - 1, replicas: 1 },
    data: {
      replicas: 0,
      generation: { increment: 1 },
      retiredAt: new Date(worker.retiredAt ?? ""),
    },
  });
  if (changed.count !== 1)
    throw new DeliveryError(
      "CONFLICT",
      "Worker retirement generation changed before acceptance",
    );
}
