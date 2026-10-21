import { expect, test } from "vitest";
import { useDeliveryFixture } from "#testing/delivery-fixture.ts";
import { workerFixture } from "#testing/worker-fixture.ts";
import { testExecutor, testOperator, testPublisher } from "#testing/seed.ts";
import { artifact } from "#infrastructure/delivery-data.ts";
import { deliveryOperationId } from "#shared/operation-id.ts";
import { freezeWorkerSnapshot, readWorkerVersions } from "./pool.ts";
import { retainedObservedWorkerArtifact } from "./observed.ts";

const context = useDeliveryFixture();

async function prepare(status: "failed" | "pending") {
  const fixture = await workerFixture(context.delivery);
  const anchor = await fixture.requestedRelease(3);
  await context.delivery.cancel(anchor.deployment.id, testOperator);
  await context.delivery.registerPipeline(
    fixture.workerPipeline.id,
    fixture.workerPipeline.definition,
    testOperator,
  );
  const environment =
    await context.cluster.database.environment.findUniqueOrThrow({
      where: { id: fixture.environmentId },
    });
  await context.delivery.registerEnvironment(
    {
      id: environment.id,
      serviceId: environment.serviceId,
      name: environment.name,
      application: "temporal",
      pipelineRevisionId: fixture.workerPipeline.id,
      configurationRevision: environment.declaredConfigurationId,
      configuration: {},
      automatic: false,
    },
    testOperator,
  );
  const publication = await context.delivery.publish(
    {
      requestId: "original-publication",
      serviceId: "temporal",
      sourceRevision: "1".repeat(40),
      ciUrl: "https://woodpecker.sjer.red/repos/1/pipeline/1",
      verifiedAt: new Date().toISOString(),
      artifacts: [
        {
          id: "original-image",
          component: "image:temporal-worker",
          kind: "image",
          uri: "docker.io/shepherdjerred/temporal-worker",
          digest: `sha256:${"a".repeat(64)}`,
          runtimeDigests: [`sha256:${"b".repeat(64)}`],
          version: "original-publication",
        },
      ],
    },
    testPublisher,
    { repositoryId: 1, pipelineNumber: 1 },
  );
  if (status === "failed")
    await context.delivery.qualify(publication.buildId, "failed", testExecutor);
  const pool = await context.delivery.workers(
    fixture.environmentId,
    testOperator,
  );
  const deployment = await context.delivery.createDeployment(
    {
      requestId: "observe-original",
      environmentId: fixture.environmentId,
      expectedGeneration: pool.generation,
      versionSetRevisionId: anchor.version.id,
      kind: "adopt-worker",
      workerBaseline: {
        artifactIds: ["original-image"],
        candidateArtifactId: "original-image",
      },
    },
    testOperator,
  );
  await context.delivery.claim(deployment.id, testExecutor);
  return { fixture, deployment, publication, anchor };
}

async function nativeEvidence(deploymentId: string, includeImage = true) {
  for (const key of [
    "worker-prior-source",
    "worker-baseline",
    ...(includeImage ? ["worker-image-provenance"] : []),
  ]) {
    await context.delivery.stage(
      deploymentId,
      {
        key,
        operationId: deliveryOperationId(`${deploymentId}:${key}`),
        status: "succeeded",
        message:
          "Disposable fixture: independent original digest, baked source, Pods and routing observed",
        evidence: [
          {
            kind: "reconciliation",
            summary: "Native fixture bound to frozen observation",
          },
        ],
      },
      testExecutor,
    );
  }
}

async function finish(deploymentId: string) {
  return context.delivery.finish(
    deploymentId,
    {
      status: "succeeded",
      recoveryRequired: false,
      message: "Observed-only baseline",
      evidence: [
        { kind: "reconciliation", summary: "Exact source unchanged" },
        { kind: "acceptance", summary: "Native host-only proof" },
      ],
    },
    testExecutor,
  );
}

test.each(["failed", "pending"] as const)(
  "retains native-observed %s publication without qualifying it or selecting it for releases",
  async (status) => {
    const { fixture, deployment, publication, anchor } = await prepare(status);
    const before = await context.cluster.database.environment.findUniqueOrThrow(
      { where: { id: fixture.environmentId } },
    );
    expect(await context.cluster.database.workerVersion.count()).toBe(0);
    await nativeEvidence(deployment.id, false);
    await expect(finish(deployment.id)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(await context.cluster.database.workerVersion.count()).toBe(0);
    await nativeEvidence(deployment.id);
    await finish(deployment.id);
    const retained = await readWorkerVersions(
      context.cluster.database,
      fixture.environmentId,
    );
    expect(retained).toHaveLength(1);
    expect(retained[0]).toMatchObject({
      artifactId: "original-image",
      artifactBuildId: publication.buildId,
      introducedByDeploymentId: deployment.id,
      sourceRevision: "1".repeat(40),
    });
    const original = await context.cluster.database.build.findUniqueOrThrow({
      where: { id: publication.buildId },
    });
    expect(original.status).toBe(status);
    expect(
      await context.cluster.database.versionSet.count({
        where: { qualifiedBuildId: publication.buildId },
      }),
    ).toBe(0);
    await expect(
      artifact(context.cluster.database, "original-image"),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      context.delivery.compose(
        {
          requestId: "not-eligible",
          serviceId: "temporal",
          components: { "image:temporal-worker": "original-image" },
        },
        testOperator,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const eligible = await context.delivery.latestQualifiedArtifact(
      {
        serviceId: "temporal",
        component: "image:temporal-worker",
        kind: "image",
      },
      1,
    );
    expect(eligible.id).toBe(anchor.artifactId);
    const anchorDetail = await context.delivery.detail(anchor.deployment.id);
    const next = await context.cluster.database.$transaction((tx) =>
      freezeWorkerSnapshot(tx, {
        environment: anchorDetail.environment,
        pipeline: fixture.workerPipeline,
        versionSet: anchorDetail.versionSet,
        deploymentId: anchor.deployment.id,
      }),
    );
    expect(next).toMatchObject({
      candidateBuildId: "3".padEnd(40, "0"),
      versions: expect.arrayContaining([
        expect.objectContaining({ artifactId: "original-image" }),
        expect.objectContaining({ artifactId: anchor.artifactId }),
      ]),
    });
    const after = await context.cluster.database.environment.findUniqueOrThrow({
      where: { id: fixture.environmentId },
    });
    expect(after.acceptedVersionSetRevisionId).toBe(
      before.acceptedVersionSetRevisionId,
    );
    expect(after.observedVersionSetRevisionId).toBe(
      before.observedVersionSetRevisionId,
    );
    expect(after.desiredVersionSetRevisionId).toBe(
      before.desiredVersionSetRevisionId,
    );
    const worker = retained[0];
    if (worker === undefined)
      throw new Error("Observed worker fixture missing");
    await expect(
      retainedObservedWorkerArtifact(context.cluster.database, {
        ...worker,
        id: "unobserved-host",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await context.cluster.database.stage.update({
      where: {
        deploymentId_key: {
          deploymentId: deployment.id,
          key: "worker-image-provenance",
        },
      },
      data: { status: "failed" },
    });
    await expect(
      readWorkerVersions(context.cluster.database, fixture.environmentId),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  },
);
