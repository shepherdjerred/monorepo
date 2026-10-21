import { beforeEach, describe, expect, test } from "vitest";
import { PipelineDefinitionSchema } from "#shared/pipeline-contract.ts";
import { RegisterEnvironmentSchema } from "#shared/contract.ts";
import { recipeFromPipeline } from "#shared/model/recipe-adapter.ts";
import type { MonitorPolicySchema } from "#shared/model/monitor-contract.ts";
import { deliveryMetrics } from "#server/metrics.ts";
import { useDeliveryFixture } from "#testing/delivery-fixture.ts";
import { testExecutor, testOperator, testPublisher } from "#testing/seed.ts";
import type { z } from "zod";

const pipeline = PipelineDefinitionSchema.parse(
  await Bun.file(
    new URL("../../../registrations/arcade.pipeline.json", import.meta.url),
  ).json(),
);
const context = useDeliveryFixture({
  registration: {
    pipeline,
    environment: RegisterEnvironmentSchema.parse(
      await Bun.file(
        new URL(
          "../../../registrations/arcade.environment.json",
          import.meta.url,
        ),
      ).json(),
    ),
  },
});

/** The CI runner image model recipes bind by reference (C2). */
async function publishRunner() {
  const build = await context.delivery.publish(
    {
      requestId: "publish/ci-base",
      serviceId: "ci",
      sourceRevision: "e".repeat(40),
      ciUrl: "https://woodpecker.sjer.red/repos/1/pipeline/90",
      verifiedAt: new Date().toISOString(),
      artifacts: [
        {
          id: "ci-base",
          component: "image:ci-base",
          kind: "image",
          uri: "docker.io/shepherdjerred/ci-base",
          version: "1.0.0",
          digest: `sha256:${"e".repeat(64)}`,
        },
      ],
    },
    testPublisher,
    { repositoryId: 1, pipelineNumber: 90 },
  );
  await context.delivery.qualify(build.buildId, "verified", testExecutor);
}

async function declareMonitoredRecipe(
  policy: z.infer<typeof MonitorPolicySchema>,
) {
  await publishRunner();
  const recipe = recipeFromPipeline(pipeline);
  if (recipe.kind !== "kubernetes-application")
    throw new Error("arcade converts to a Kubernetes application recipe");
  await context.cluster.database.pipeline.create({
    data: {
      id: "arcade/3",
      definition: {
        ...recipe,
        oracle: {
          ...recipe.oracle,
          monitor: {
            component: "image:arcade",
            alarms: {
              matchers: { environment: "arcade/prod" },
              severities: ["critical"],
            },
            evidence: [
              {
                key: "requests",
                query:
                  'sum(increase(http_requests_total{version="$version"}[$window]))',
                threshold: 100,
              },
            ],
            policy,
          },
        },
      },
    },
  });
  await context.cluster.database.environment.update({
    where: { id: "arcade/prod" },
    data: { pipelineRevisionId: "arcade/3", automatic: false },
  });
}

async function environmentRow() {
  return context.cluster.database.environment.findUniqueOrThrow({
    where: { id: "arcade/prod" },
  });
}

async function publish(number: number) {
  const build = await context.delivery.publish(
    {
      requestId: `publish/${String(number)}`,
      serviceId: "arcade",
      sourceRevision: String(number).repeat(40),
      ciUrl: `https://woodpecker.sjer.red/repos/1/pipeline/${String(number)}`,
      verifiedAt: new Date().toISOString(),
      artifacts: [
        {
          id: `image/${String(number)}`,
          component: "image:arcade",
          kind: "image",
          uri: "docker.io/shepherdjerred/arcade",
          version: `1.0.${String(number)}`,
          digest: `sha256:${String(number).repeat(64)}`,
        },
      ],
    },
    testPublisher,
    { repositoryId: 1, pipelineNumber: number },
  );
  await context.delivery.qualify(build.buildId, "verified", testExecutor);
  const sets = await context.cluster.database.versionSet.findMany({
    where: { serviceId: "arcade" },
    orderBy: { revision: "desc" },
  });
  const [newest] = sets;
  if (newest === undefined) throw new Error("No set composed");
  return newest.id;
}

async function deployAndAccept(versionSetId: string, approve = false) {
  const env = await environmentRow();
  const deployment = await context.delivery.createDeployment(
    {
      requestId: crypto.randomUUID(),
      environmentId: env.id,
      versionSetRevisionId: versionSetId,
      expectedGeneration: env.generation,
      kind: "deploy",
    },
    testOperator,
  );
  if (approve)
    await context.delivery.approve(
      deployment.id,
      { decision: "approve", reason: "reviewed the release" },
      testOperator,
    );
  await context.delivery.claim(deployment.id, testExecutor);
  await context.delivery.finish(
    deployment.id,
    {
      status: "succeeded",
      message: "Accepted",
      observedRevisionId: versionSetId,
      recoveryRequired: false,
      evidence: [
        { kind: "reconciliation", summary: "exact operation completed" },
        { kind: "acceptance", summary: "acceptance checks passed" },
      ],
    },
    testExecutor,
  );
  return deployment;
}

function observation(input: { requests: number; critical?: boolean }) {
  return {
    observedAt: new Date().toISOString(),
    window: "5m",
    alarms:
      input.critical === true
        ? [
            {
              alertname: "ArcadeErrors",
              severity: "critical" as const,
              labels: { environment: "arcade/prod" },
            },
          ]
        : [],
    evidence: { requests: input.requests },
  };
}

describe("monitor (4.19)", () => {
  beforeEach(async () => {
    await context.cluster.database.deployment.deleteMany({});
  });

  test("acceptance watches until the evidence threshold settles it (W1, W4)", async () => {
    await declareMonitoredRecipe("automatic");
    const accepted = await deployAndAccept(context.fixture.versionSet.id);
    const [watching] = await context.delivery.watchingMonitors();
    expect(watching).toMatchObject({
      deploymentId: accepted.id,
      environmentId: "arcade/prod",
      artifact: { component: "image:arcade", version: "1.0.0" },
    });
    expect(
      await context.delivery.observeMonitor(
        accepted.id,
        observation({ requests: 10 }),
        testExecutor,
      ),
    ).toMatchObject({ outcome: "watching", sequence: 1 });
    expect(
      await context.delivery.observeMonitor(
        accepted.id,
        observation({ requests: 150 }),
        testExecutor,
      ),
    ).toMatchObject({ outcome: "settled", sequence: 2 });
    expect(await context.delivery.monitorStatus("arcade/prod")).toMatchObject({
      deploymentId: accepted.id,
      state: "settled",
      policy: "automatic",
      observations: 2,
    });
    await expect(
      context.delivery.observeMonitor(
        accepted.id,
        observation({ requests: 1 }),
        testExecutor,
      ),
    ).rejects.toThrow(/watching monitor/u);
    const evidence = await context.cluster.database.evidence.findMany({
      where: { deploymentId: accepted.id, kind: "monitor" },
    });
    expect(evidence).toHaveLength(1);
    expect(await deliveryMetrics(context.cluster.database)).toContain(
      'delivery_monitor_state{environment="arcade/prod",state="settled"} 1',
    );
  });

  test("an alarm under automatic policy restores the last settled selection (W2, D3)", async () => {
    await declareMonitoredRecipe("automatic");
    const baseline = await deployAndAccept(context.fixture.versionSet.id);
    await context.delivery.observeMonitor(
      baseline.id,
      observation({ requests: 500 }),
      testExecutor,
    );
    const newer = await deployAndAccept(await publish(2));
    const alarmed = await context.delivery.observeMonitor(
      newer.id,
      observation({ requests: 500, critical: true }),
      testExecutor,
    );
    expect(alarmed).toMatchObject({ outcome: "alarmed", policy: "automatic" });
    const env = await environmentRow();
    const newerSet =
      await context.cluster.database.versionSet.findUniqueOrThrow({
        where: { id: newer.versionSetRevisionId },
      });
    expect(env.automaticSuppressedThroughRevision).toBe(newerSet.revision);
    const rollback = await context.delivery.requestMonitorRollback(
      newer.id,
      testExecutor,
    );
    expect(rollback).toMatchObject({
      kind: "rollback",
      status: "queued",
      restoredDeploymentId: baseline.id,
      versionSetRevisionId: baseline.versionSetRevisionId,
    });
    // Idempotent on the alarmed deployment.
    const again = await context.delivery.requestMonitorRollback(
      newer.id,
      testExecutor,
    );
    expect(again?.id).toBe(rollback?.id);
    expect(
      await context.cluster.database.evidence.count({
        where: { deploymentId: newer.id, kind: "alarm" },
      }),
    ).toBe(1);
  });

  test("a restoration under required approval carries the restored selection's approver (H5)", async () => {
    await declareMonitoredRecipe("automatic");
    await context.cluster.database.environment.update({
      where: { id: "arcade/prod" },
      data: { approvalPolicy: "required" },
    });
    const baseline = await deployAndAccept(context.fixture.versionSet.id, true);
    await context.delivery.observeMonitor(
      baseline.id,
      observation({ requests: 500 }),
      testExecutor,
    );
    const newer = await deployAndAccept(await publish(3), true);
    await context.delivery.observeMonitor(
      newer.id,
      observation({ requests: 0, critical: true }),
      testExecutor,
    );
    const rollback = await context.delivery.requestMonitorRollback(
      newer.id,
      testExecutor,
    );
    expect(rollback?.status).toBe("queued");
    const approval = await context.cluster.database.approval.findUniqueOrThrow({
      where: { deploymentId: rollback?.id ?? "" },
    });
    expect(approval).toMatchObject({
      status: "granted",
      actor: testOperator.id,
      restorationOfDeploymentId: baseline.id,
    });
  });

  test("hold policy and a missing settled candidate hold the environment for an operator", async () => {
    await declareMonitoredRecipe("hold");
    const accepted = await deployAndAccept(context.fixture.versionSet.id);
    await context.delivery.observeMonitor(
      accepted.id,
      observation({ requests: 0, critical: true }),
      testExecutor,
    );
    expect(
      await context.delivery.requestMonitorRollback(accepted.id, testExecutor),
    ).toBeNull();
    const held = await context.cluster.database.pipeline.findUniqueOrThrow({
      where: { id: "arcade/3" },
    });
    await context.cluster.database.pipeline.update({
      where: { id: "arcade/3" },
      data: {
        definition: JSON.parse(
          JSON.stringify(held.definition).replace(
            '"policy":"hold"',
            '"policy":"automatic"',
          ),
        ),
      },
    });
    expect(
      await context.delivery.requestMonitorRollback(accepted.id, testExecutor),
    ).toBeNull();
    expect(
      await context.cluster.database.audit.count({
        where: { entityId: accepted.id, action: "monitor.held" },
      }),
    ).toBe(1);
    expect(await context.delivery.monitorStatus("arcade/prod")).toMatchObject({
      state: "alarmed",
    });
  });
});
