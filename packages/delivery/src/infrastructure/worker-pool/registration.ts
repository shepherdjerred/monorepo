import {
  RegisterWorkerVersionSchema,
  WorkerVersionSchema,
  WorkerPoolSnapshotSchema,
} from "#shared/contract.ts";
import type { Principal, RegisterWorkerVersion } from "#shared/contract.ts";
import { requireScope } from "#infrastructure/auth.ts";
import { DeliveryError } from "#domain/error.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import {
  artifact,
  environment,
  id,
  type Transaction,
} from "#infrastructure/delivery-data.ts";
import {
  audit,
  lock,
  remember,
  request,
  required,
} from "#infrastructure/delivery-records.ts";
import {
  readWorkerVersions,
  requireSameWorkerIdentity,
  workerArtifactIdentity,
} from "./pool.ts";

export async function requireIdleWorkerEnvironment(
  tx: Transaction,
  input: { environmentId: string; expectedGeneration: number },
) {
  const env = await environment(tx, input.environmentId);
  if (
    env.generation !== input.expectedGeneration ||
    env.activeDeploymentId !== null
  )
    throw new DeliveryError(
      "CONFLICT",
      "Worker environment generation or deployment ownership changed",
    );
  if (
    (await tx.deployment.count({
      where: {
        environmentId: env.id,
        status: { in: ["queued", "awaiting_approval", "running"] },
      },
    })) !== 0
  )
    throw new DeliveryError(
      "CONFLICT",
      "Worker pool cannot change while a deployment is pending or active",
    );
  return env;
}

export async function workers(
  this: Delivery,
  environmentId: string,
  actor: Principal,
) {
  requireScope(actor, "read");
  return this.database.$transaction(async (tx) => {
    await lock(tx, `environment:${environmentId}`);
    const env = await environment(tx, environmentId);
    return {
      environmentId,
      generation: env.generation,
      versions: await readWorkerVersions(tx, environmentId),
    };
  });
}

export async function registerWorker(
  this: Delivery,
  rawInput: RegisterWorkerVersion,
  actor: Principal,
) {
  requireScope(actor, "admin");
  const input = RegisterWorkerVersionSchema.parse(rawInput);
  return this.database.$transaction(async (tx) => {
    const previous = await request(tx, actor, {
      requestId: input.requestId,
      input,
      resultType: "worker-version",
    });
    if (previous !== null) {
      const retained = await readWorkerVersions(tx, input.environmentId);
      return required(
        retained.find((row) => row.id === previous.resultId) ?? null,
        "Worker version",
      );
    }
    await lock(tx, `environment:${input.environmentId}`);
    const env = await requireIdleWorkerEnvironment(tx, {
      environmentId: input.environmentId,
      expectedGeneration: input.expectedGeneration,
    });
    const introduced = required(
      await tx.deployment.findUnique({
        where: { id: input.introducedByDeploymentId },
      }),
      "Introducing accepted deployment",
    );
    const selected = await artifact(tx, input.artifactId);
    const selectedByIntroduction =
      introduced.kind === "adopt-worker" && introduced.workerSnapshot !== null
        ? Number(
            WorkerPoolSnapshotSchema.parse(
              introduced.workerSnapshot,
            ).versions.some((version) => version.artifactId === selected.id),
          )
        : await tx.versionSetEntry.count({
            where: {
              revisionId: introduced.versionSetRevisionId,
              artifactId: selected.id,
            },
          });
    if (
      selectedByIntroduction !== 1 ||
      introduced.environmentId !== env.id ||
      introduced.status !== "succeeded"
    )
      throw new DeliveryError(
        "INVALID",
        "Worker baseline requires an accepted deployment selecting this original artifact",
      );
    const identity = workerArtifactIdentity({
      environment: env,
      target: input.target,
      artifact: selected,
    });
    const retainedVersions = await readWorkerVersions(tx, env.id);
    const existing = retainedVersions.find(
      (row) => row.buildId === identity.buildId,
    );
    const frozen = WorkerVersionSchema.parse({
      ...identity,
      id: existing?.id ?? id(),
      introducedByDeploymentId:
        existing?.introducedByDeploymentId ?? introduced.id,
      replicas: existing?.replicas ?? 1,
      generation: existing?.generation ?? 0,
      retiredAt: existing?.retiredAt ?? null,
    });
    if (existing === undefined) {
      await tx.workerVersion.create({
        data: {
          id: frozen.id,
          environmentId: env.id,
          buildId: frozen.buildId,
          artifactId: selected.id,
          introducedByDeploymentId: introduced.id,
          host: frozen.host,
        },
      });
      await tx.environment.update({
        where: { id: env.id },
        data: { generation: { increment: 1 } },
      });
      await audit(tx, actor, {
        action: "worker.registered",
        entityId: frozen.id,
        requestId: input.requestId,
        metadata: {
          environmentId: env.id,
          artifactId: selected.id,
          introducedByDeploymentId: introduced.id,
        },
      });
    } else {
      requireSameWorkerIdentity(existing, frozen);
    }
    await remember(tx, actor, {
      requestId: input.requestId,
      input,
      resultType: "worker-version",
      resultId: frozen.id,
    });
    return frozen;
  });
}
