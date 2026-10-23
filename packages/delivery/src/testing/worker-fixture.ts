import type { Delivery } from "#infrastructure/delivery.ts";
import type { Transaction } from "#infrastructure/delivery-data.ts";
import { freezeWorkerSnapshot } from "#infrastructure/worker-pool/pool.ts";
import {
  LegacyPipelineRevisionSchema,
  workerHostSpecification,
} from "#shared/contract.ts";
import type { WorkerPoolTarget, WorkerVersion } from "#shared/contract.ts";
import { testExecutor, testOperator, testPublisher } from "./seed.ts";

/** Persistence fixture: accepted metadata only; never invokes a live adapter. */
export async function workerFixture(
  delivery: Delivery,
  target: WorkerPoolTarget = "central",
) {
  const host = workerHostSpecification(target);
  const serviceId = target === "central" ? "temporal" : "scout-for-lol";
  const environmentId = `${serviceId}/${target === "scout-beta" ? "beta" : "prod"}`;
  const pipelineId = `${target}/persistence-fixture`;
  await delivery.registerPipeline(
    pipelineId,
    {
      kind: "manual",
      reason: "Disposable PostgreSQL worker persistence fixture",
    },
    testOperator,
  );
  await delivery.registerEnvironment(
    {
      id: environmentId,
      serviceId,
      name: target === "scout-beta" ? "beta" : "prod",
      application: host.application,
      pipelineRevisionId: pipelineId,
      configurationRevision: "worker-fixture/1",
      configuration: {},
      automatic: false,
      // Scout production's approval policy is catalog data (4.10).
      approvalPolicy: target === "scout-prod" ? "required" : "none",
    },
    testOperator,
  );
  const workerPipeline = LegacyPipelineRevisionSchema.parse({
    id: `${target}/frozen-worker-fixture`,
    createdAt: new Date().toISOString(),
    definition: {
      kind: "argocd",
      application: host.application,
      chartRepository: "https://chartmuseum.tailnet-1a49.ts.net",
      chartName: host.application,
      chartComponent: `chart:${host.application}`,
      namespace: host.kubernetesNamespace,
      parameters: {},
      artifactParameters: {
        [`delivery.images.${target === "central" ? "temporal-worker" : "scout-for-lol"}`]: `image:${target === "central" ? "temporal-worker" : "scout-for-lol"}`,
      },
      workerRollout: {
        target,
        imageComponent: `image:${target === "central" ? "temporal-worker" : "scout-for-lol"}`,
        runnerImage: `docker.io/shepherdjerred/ci-base@sha256:${"f".repeat(64)}`,
      },
    },
  });
  async function requestedRelease(number: number) {
    const image = target === "central" ? "temporal-worker" : "scout-for-lol";
    const artifactId = `${target}/image/${String(number)}`;
    const published = await delivery.publish(
      {
        requestId: `${target}/publish/${String(number)}`,
        serviceId,
        sourceRevision: number.toString(16).padEnd(40, "0"),
        ciUrl: `https://woodpecker.sjer.red/repos/1/pipeline/${String(number)}`,
        verifiedAt: new Date().toISOString(),
        artifacts: [
          {
            id: artifactId,
            component: `image:${image}`,
            kind: "image",
            uri: `docker.io/shepherdjerred/${image}`,
            digest: `sha256:${number.toString(16).padStart(64, "0")}`,
            runtimeDigests: [`sha256:${"e".repeat(64)}`],
            version: `build-${String(number)}`,
          },
          {
            id: `${target}/chart/${String(number)}`,
            component: `chart:${host.application}`,
            kind: "chart",
            uri: `https://chartmuseum.tailnet-1a49.ts.net/charts/${host.application}-1.0.${String(number)}.tgz`,
            digest: `sha256:${"d".repeat(64)}`,
            version: `1.0.${String(number)}`,
          },
        ],
      },
      testPublisher,
      { repositoryId: 1, pipelineNumber: number },
    );
    await delivery.qualify(published.buildId, "verified", testExecutor);
    const version = await delivery.database.versionSet.findUniqueOrThrow({
      where: { qualifiedBuildId: published.buildId },
    });
    const env = await delivery.database.environment.findUniqueOrThrow({
      where: { id: environmentId },
    });
    const deployment = await delivery.createDeployment(
      {
        requestId: `${target}/accept/${String(number)}`,
        environmentId,
        versionSetRevisionId: version.id,
        expectedGeneration: env.generation,
        kind: "deploy",
      },
      testOperator,
    );
    return { artifactId, version, deployment };
  }
  async function acceptedRelease(number: number) {
    const release = await requestedRelease(number);
    const { version, deployment } = release;
    if (deployment.status === "awaiting_approval")
      await delivery.approve(
        deployment.id,
        { decision: "approve", reason: "Accepted persistence fixture" },
        testOperator,
      );
    await delivery.claim(deployment.id, testExecutor);
    await delivery.finish(
      deployment.id,
      {
        status: "succeeded",
        message: "Accepted persistence fixture",
        recoveryRequired: false,
        observedRevisionId: version.id,
        evidence: [
          { kind: "reconciliation", summary: "Persistence fixture" },
          { kind: "acceptance", summary: "Persistence fixture" },
        ],
      },
      testExecutor,
    );
    return release;
  }
  async function adopt(release: Awaited<ReturnType<typeof acceptedRelease>>) {
    const env = await delivery.database.environment.findUniqueOrThrow({
      where: { id: environmentId },
    });
    return delivery.registerWorker(
      {
        requestId: `adopt/${release.artifactId}`,
        environmentId,
        expectedGeneration: env.generation,
        artifactId: release.artifactId,
        introducedByDeploymentId: release.deployment.id,
        target,
      },
      testOperator,
    );
  }
  async function freeze(release: Awaited<ReturnType<typeof acceptedRelease>>) {
    const detail = await delivery.detail(release.deployment.id);
    const snapshot = await delivery.database.$transaction((tx) =>
      freezeWorkerSnapshot(tx, {
        environment: detail.environment,
        pipeline: workerPipeline,
        versionSet: detail.versionSet,
        deploymentId: detail.deployment.id,
      }),
    );
    if (snapshot === null) throw new Error("Worker fixture snapshot missing");
    await delivery.database.deployment.update({
      where: { id: release.deployment.id },
      data: { workerSnapshot: snapshot },
    });
    return snapshot;
  }
  async function requestedFrozenRelease(number: number) {
    const release = await requestedRelease(number);
    const detail = await delivery.detail(release.deployment.id);
    await delivery.database.$transaction(async (tx) => {
      const snapshot = await freezeWorkerSnapshot(tx, {
        environment: detail.environment,
        pipeline: workerPipeline,
        versionSet: detail.versionSet,
        deploymentId: detail.deployment.id,
      });
      if (snapshot === null) throw new Error("Worker fixture snapshot missing");
      await tx.deployment.update({
        where: { id: detail.deployment.id },
        data: { workerSnapshot: snapshot },
      });
      await freezeRecipe(tx, detail.deployment.id);
    });
    return delivery.detail(release.deployment.id);
  }
  /**
   * Points a deployment at the recipe it froze, the reviewed worker recipe
   * unless given another. Only this disposable test fixture seeds the
   * still-guarded reviewed definition.
   */
  async function freezeRecipe(
    tx: Transaction,
    deploymentId: string,
    recipe: { id: string; definition: object } = workerPipeline,
  ) {
    await tx.pipeline.upsert({
      where: { id: recipe.id },
      create: { id: recipe.id, definition: recipe.definition },
      update: {},
    });
    await tx.deployment.update({
      where: { id: deploymentId },
      data: { pipelineRevisionId: recipe.id },
    });
  }
  async function acceptedPool() {
    const a = await acceptedRelease(1);
    const workerA = await adopt(a);
    const snapshotA = await freeze(a);
    const b = await acceptedRelease(2);
    const workerB = await adopt(b);
    const snapshotB = await freeze(b);
    const env = await delivery.database.environment.findUniqueOrThrow({
      where: { id: environmentId },
    });
    return { a, b, workerA, workerB, snapshotA, snapshotB, env };
  }
  async function requestedBaseline() {
    const a = await requestedRelease(1);
    await delivery.cancel(a.deployment.id, testOperator);
    const c = await requestedRelease(3);
    await delivery.cancel(c.deployment.id, testOperator);
    await delivery.registerPipeline(
      workerPipeline.id,
      workerPipeline.definition,
      testOperator,
    );
    await delivery.registerEnvironment(
      {
        id: environmentId,
        serviceId,
        name: target === "scout-beta" ? "beta" : "prod",
        application: host.application,
        pipelineRevisionId: workerPipeline.id,
        configurationRevision: "worker-fixture/baseline",
        configuration: {},
        automatic: false,
      },
      testOperator,
    );
    const current = await delivery.workers(environmentId, testOperator);
    const requested = await delivery.createDeployment(
      {
        requestId: `${target}/baseline`,
        environmentId,
        versionSetRevisionId: c.version.id,
        expectedGeneration: current.generation,
        kind: "adopt-worker",
        workerBaseline: {
          artifactIds: [a.artifactId, c.artifactId],
          candidateArtifactId: a.artifactId,
        },
      },
      testOperator,
    );
    return delivery.detail(requested.id);
  }
  return {
    target,
    host,
    environmentId,
    workerPipeline,
    acceptedRelease,
    requestedRelease,
    requestedBaseline,
    requestedFrozenRelease,
    frozenRecipe: (
      deploymentId: string,
      recipe?: { id: string; definition: object },
    ) =>
      delivery.database.$transaction((tx) =>
        freezeRecipe(tx, deploymentId, recipe),
      ),
    acceptedPool,
    adopt,
    freeze,
  };
}

export function freshWorkerProof(
  worker: WorkerVersion,
  currentBuildId: string,
  timestamp = Date.now(),
) {
  return {
    proofs: worker.host.routes.map((route) => ({
      ...route,
      observedAt: new Date(timestamp).toISOString(),
      deactivationObservedAt: new Date(timestamp).toISOString(),
      lastDeactivationTime: new Date(timestamp - 120_000).toISOString(),
      lastCheckedTime: new Date(timestamp - 1000).toISOString(),
      currentBuildId,
      rampingBuildId: null,
      openExecutions: 0 as const,
      drainageStatus: "DRAINED" as const,
      routingConflictToken: "disposable-fixture-token",
      candidateReferences: 0 as const,
      canaryReferences: 0 as const,
    })),
  };
}
