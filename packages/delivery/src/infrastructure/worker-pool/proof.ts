import {
  WorkerPoolSnapshotSchema,
  WorkerRetirementClaimSchema,
} from "#shared/contract.ts";
import type {
  WorkerPoolSnapshot,
  WorkerRetirementClaim,
  WorkerVersion,
} from "#shared/contract.ts";
import { DeliveryError } from "#domain/error.ts";
import type { Transaction } from "#infrastructure/delivery-data.ts";
import { fingerprint } from "#infrastructure/delivery-records.ts";

export function validateRetirementProof(
  worker: WorkerVersion,
  rawInput: WorkerRetirementClaim,
  now = Date.now(),
) {
  const input = WorkerRetirementClaimSchema.parse(rawInput);
  const routes = worker.host.routes;
  if (routes.length !== input.proofs.length)
    throw new DeliveryError(
      "INVALID",
      "Drain proof must cover every hosted namespace and queue",
    );
  const seen = new Set<string>();
  for (const proof of input.proofs) {
    const route = {
      namespace: proof.namespace,
      deploymentName: proof.deploymentName,
      taskQueue: proof.taskQueue,
    };
    const key = fingerprint(route);
    const observed = new Date(proof.observedAt).getTime();
    if (seen.has(key) || !routes.some((item) => fingerprint(item) === key))
      throw new DeliveryError(
        "INVALID",
        "Drain proof route differs from the fixed worker host specification",
      );
    seen.add(key);
    if (
      observed > now + 5000 ||
      now - observed > 60_000 ||
      proof.currentBuildId === worker.buildId ||
      proof.rampingBuildId === worker.buildId
    )
      throw new DeliveryError(
        "CONFLICT",
        "Worker retirement requires fresh routing exclusion and post-deactivation drainage readback",
      );
    if ("proofKind" in proof) {
      if (new Date(proof.versionCreatedAt).getTime() > observed)
        throw new DeliveryError(
          "CONFLICT",
          "Inactive worker creation postdates its observation",
        );
    } else {
      const read = new Date(proof.deactivationObservedAt).getTime();
      const deactivated = new Date(proof.lastDeactivationTime).getTime();
      const checked = new Date(proof.lastCheckedTime).getTime();
      if (
        read > now + 5000 ||
        now - read > 60_000 ||
        deactivated > checked ||
        checked > read ||
        read > observed
      )
        throw new DeliveryError(
          "CONFLICT",
          "Worker retirement requires fresh post-deactivation drainage readback",
        );
    }
  }
  return input;
}

export async function requireUnreferencedWorker(
  tx: Transaction,
  input: { worker: WorkerVersion; retirementDeploymentId?: string },
) {
  const { worker } = input;
  const env = await tx.environment.findUniqueOrThrow({
    where: { id: worker.environmentId },
  });
  if (
    env.acceptedVersionSetRevisionId !== null &&
    (await tx.versionSetEntry.count({
      where: {
        revisionId: env.acceptedVersionSetRevisionId,
        artifact: { kind: "image", build: { sourceRevision: worker.buildId } },
      },
    })) !== 0
  )
    throw new DeliveryError(
      "CONFLICT",
      "Worker is selected by the currently accepted release",
    );
  const deployments = await tx.deployment.findMany({
    where: {
      environmentId: env.id,
      OR: [
        { status: { in: ["queued", "awaiting_approval", "running"] } },
        {
          versionSetRevisionId: env.acceptedVersionSetRevisionId ?? "",
          status: "succeeded",
          kind: { notIn: ["adopt-worker", "repair-trmnl"] },
        },
      ],
    },
    orderBy: { finishedAt: "desc" },
  });
  let checkedAcceptance = false;
  for (const row of deployments) {
    if (row.id === input.retirementDeploymentId || row.workerSnapshot === null)
      continue;
    const snapshot = WorkerPoolSnapshotSchema.parse(row.workerSnapshot);
    if (row.status === "succeeded") {
      if (checkedAcceptance) continue;
      checkedAcceptance = true;
      if (snapshot.candidateBuildId !== worker.buildId) continue;
    } else if (
      !snapshot.versions.some(
        (version) =>
          version.buildId === worker.buildId && version.replicas === 1,
      )
    )
      continue;
    throw new DeliveryError(
      "CONFLICT",
      "Worker is referenced by accepted routing or an in-flight candidate, canary, or rollback deployment",
    );
  }
}

export function retiringWorker(snapshot: WorkerPoolSnapshot) {
  const worker = snapshot.versions.find(
    (version) => version.id === snapshot.retiringWorkerId,
  );
  if (
    snapshot.workerOperation !== "retire" ||
    worker?.replicas !== 0 ||
    worker.retiredAt === null ||
    worker.buildId === snapshot.candidateBuildId
  )
    throw new DeliveryError(
      "INVALID",
      "Retirement snapshot must retain the accepted candidate and scale exactly its retired host to zero",
    );
  return worker;
}
