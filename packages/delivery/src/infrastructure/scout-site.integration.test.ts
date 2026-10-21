import { expect, test } from "vitest";
import { useDeliveryFixture } from "#testing/delivery-fixture.ts";
import { workerFixture } from "#testing/worker-fixture.ts";
import { testExecutor, testOperator, testPublisher } from "#testing/seed.ts";
import { replicateProducedArtifacts } from "#testing/replication.ts";
import {
  PipelineDefinitionSchema,
  type FinishDeployment,
} from "#shared/contract.ts";
import { specializedOperationId } from "./specialized-success.ts";

const context = useDeliveryFixture();
async function policy(stage: "beta" | "prod" = "beta") {
  const parsed = PipelineDefinitionSchema.parse(
    await Bun.file(
      new URL(
        `../../registrations/specialized/scout-${stage}/pipeline.json`,
        import.meta.url,
      ),
    ).json(),
  );
  if (parsed.kind !== "argocd" || parsed.scoutSite === undefined)
    throw new Error(
      "Reviewed Scout fixture requires a combined frontend policy",
    );
  return { ...parsed, scoutSite: parsed.scoutSite };
}

async function selectedRelease() {
  const fixture = await workerFixture(context.delivery, "scout-beta");
  const release = await fixture.requestedRelease(1);
  await context.delivery.cancel(release.deployment.id, testOperator);
  const pipeline = await policy();
  const published = await context.delivery.publish(
    {
      requestId: "site/publish",
      serviceId: "scout-for-lol",
      sourceRevision: "2".repeat(40),
      ciUrl: "https://woodpecker.sjer.red/repos/1/pipeline/2",
      verifiedAt: new Date().toISOString(),
      artifacts: [
        {
          id: "scout/archive/2",
          component: pipeline.scoutSite.archiveComponent,
          kind: "archive",
          uri: `s3://delivery-artifacts/sites/scout-frontend-beta/${"a".repeat(64)}.tar`,
          digest: `sha256:${"a".repeat(64)}`,
          version: "archive/2",
          requires: {
            "image:scout-for-lol": `sha256:${"1".padStart(64, "0")}`,
          },
        },
      ],
    },
    testPublisher,
    { repositoryId: 1, pipelineNumber: 2 },
  );
  await replicateProducedArtifacts(context.delivery, published.buildId);
  await context.delivery.qualify(published.buildId, "verified", testExecutor);
  const version = await context.cluster.database.versionSet.findUniqueOrThrow({
    where: { qualifiedBuildId: published.buildId },
  });
  const deployment = await context.delivery.createDeployment(
    {
      requestId: "site/request",
      environmentId: fixture.environmentId,
      versionSetRevisionId: version.id,
      expectedGeneration: 0,
      kind: "deploy",
    },
    testOperator,
  );
  await context.delivery.registerPipeline("combined/1", pipeline, testOperator);
  // This persistence test supplies a frozen guarded definition without enabling worker rollout.
  await context.cluster.database.deployment.update({
    where: { id: deployment.id },
    data: { pipelineRevisionId: "combined/1" },
  });
  await context.delivery.claim(deployment.id, testExecutor);
  const operationId = specializedOperationId(`${deployment.id}:scout-site`);
  const acceptance = {
    kind: "acceptance" as const,
    operationId,
    summary: JSON.stringify({
      adapter: "scout-site",
      archiveArtifactId: "scout/archive/2",
      archiveDigest: `sha256:${"a".repeat(64)}`,
      versionSetRevisionId: version.id,
      bucket: pipeline.scoutSite.bucket,
    }),
  };
  const finish: FinishDeployment = {
    status: "succeeded",
    message: "Both immutable runtime boundaries observed",
    observedRevisionId: version.id,
    recoveryRequired: false,
    evidence: [
      { kind: "reconciliation", summary: "Exact backend source observed" },
      { kind: "acceptance", summary: "Backend runtime observed" },
      acceptance,
    ],
  };
  return {
    fixture,
    pipeline,
    version,
    deployment,
    operationId,
    acceptance,
    finish,
  };
}

test("combined Scout registration binds canonical stage, environment and production approval independent of display name", async () => {
  const pipeline = await policy("prod");
  await expect(
    context.delivery.registerPipeline(
      "wrong/flavor",
      {
        ...pipeline,
        scoutSite: { ...pipeline.scoutSite, bucket: "scout-frontend-beta" },
      },
      testOperator,
    ),
  ).rejects.toMatchObject({ code: "INVALID" });
  await expect(
    context.delivery.registerPipeline(
      "wrong/host",
      { ...pipeline, application: "temporal" },
      testOperator,
    ),
  ).rejects.toMatchObject({ code: "INVALID" });
  await context.delivery.registerPipeline(
    "scout/combined",
    pipeline,
    testOperator,
  );
  const input = {
    id: "scout-for-lol/prod",
    serviceId: "scout-for-lol",
    name: "Friendly display label",
    application: "scout-prod",
    pipelineRevisionId: "scout/combined",
    configurationRevision: "reviewed/1",
    configuration: {},
    automatic: true,
    approvalPolicy: "required" as const,
  };
  await expect(
    context.delivery.registerEnvironment(
      { ...input, id: "scout-for-lol/site-prod" },
      testOperator,
    ),
  ).rejects.toMatchObject({ code: "INVALID" });
  const env = await context.delivery.registerEnvironment(input, testOperator);
  expect(env.approvalPolicy).toBe("required");
  const overview = await context.delivery.overview();
  expect(
    overview.environments.find((row) => row.id === env.id)?.approvalPolicy,
  ).toBe("required");
});

test("frontend stage must finish under the backend lock with exact persisted archive evidence", async () => {
  const { deployment, operationId, acceptance, finish, version } =
    await selectedRelease();
  await expect(
    context.delivery.finish(deployment.id, finish, testExecutor),
  ).rejects.toThrow("exact archive acceptance");
  expect(
    await context.cluster.database.targetLock.findUnique({
      where: { instance: "application:scout-beta" },
    }),
  ).toMatchObject({ deploymentId: deployment.id });
  await context.delivery.stage(
    deployment.id,
    {
      key: "scout-site",
      operationId,
      status: "running",
      message: "Activating selected archive",
      evidence: [acceptance],
    },
    testExecutor,
  );
  await expect(
    context.delivery.finish(deployment.id, finish, testExecutor),
  ).rejects.toMatchObject({ code: "INVALID" });
  await context.delivery.stage(
    deployment.id,
    {
      key: "scout-site",
      operationId,
      status: "succeeded",
      message: "Archive and public entrypoint bytes independently verified",
      evidence: [acceptance],
    },
    testExecutor,
  );
  await context.delivery.finish(deployment.id, finish, testExecutor);
  expect(
    await context.cluster.database.environment.findUnique({
      where: { id: "scout-for-lol/beta" },
    }),
  ).toMatchObject({
    acceptedVersionSetRevisionId: version.id,
    activeDeploymentId: null,
  });
  expect(
    await context.cluster.database.targetLock.findUnique({
      where: { instance: "application:scout-beta" },
    }),
  ).toBeNull();
});

test("a different archive cannot satisfy combined acceptance and missing backend requirements fail request admission", async () => {
  const { deployment, operationId, finish, fixture, pipeline, version } =
    await selectedRelease();
  await context.delivery.stage(
    deployment.id,
    {
      key: "scout-site",
      operationId,
      status: "succeeded",
      message: "Incorrect archive fixture",
      evidence: [
        {
          kind: "acceptance",
          operationId,
          summary: JSON.stringify({
            adapter: "scout-site",
            archiveArtifactId: "unselected/archive",
            archiveDigest: `sha256:${"b".repeat(64)}`,
            versionSetRevisionId: version.id,
            bucket: pipeline.scoutSite.bucket,
          }),
        },
      ],
    },
    testExecutor,
  );
  await expect(
    context.delivery.finish(deployment.id, finish, testExecutor),
  ).rejects.toMatchObject({ code: "INVALID" });
  await context.delivery.finish(
    deployment.id,
    {
      status: "failed",
      message: "Wrong archive proof quarantined",
      recoveryRequired: true,
      evidence: [],
    },
    testExecutor,
  );
  expect(
    await context.cluster.database.targetLock.findUnique({
      where: { instance: "application:scout-beta" },
    }),
  ).toMatchObject({ deploymentId: deployment.id });
  await context.cluster.database.artifact.update({
    where: { id: "scout/archive/2" },
    data: { requires: {} },
  });
  await context.cluster.database.environment.update({
    where: { id: fixture.environmentId },
    data: { activeDeploymentId: null, pipelineRevisionId: "combined/1" },
  });
  await expect(
    context.delivery.createDeployment(
      {
        requestId: "site/unbound",
        environmentId: fixture.environmentId,
        versionSetRevisionId: version.id,
        expectedGeneration: 1,
        kind: "deploy",
      },
      testOperator,
    ),
  ).rejects.toThrow("exact selected backend image");
});
