import { beforeEach, expect, test } from "vitest";
import { useDeliveryFixture } from "#testing/delivery-fixture.ts";
import {
  acceptTestController,
  controlPlaneFixture,
} from "#testing/control-plane-fixture.ts";
import { testExecutor, testOperator } from "#testing/seed.ts";
import { Delivery } from "#infrastructure/delivery.ts";
import { requestTestPlan } from "#testing/platform-execution.ts";
import { platformFixture } from "#testing/platform-fixture.ts";

const context = useDeliveryFixture();
let fixture: Awaited<ReturnType<typeof controlPlaneFixture>>;
beforeEach(async () => {
  fixture = await controlPlaneFixture(context.cluster.database);
});

test("independent controller selection retains original cross-owner provenance and accepts only its own pointer", async () => {
  const selected = await fixture.delivery.requestControlPlaneUpgrade(
    fixture.environment.id,
    fixture.input,
    testOperator,
  );
  expect(selected.workerSnapshot).toBeNull();
  expect(selected.controlPlaneSnapshot?.nextArtifact).toMatchObject({
    id: fixture.next.artifactId,
    buildId: fixture.next.buildId,
    serviceId: "temporal",
    component: "image:temporal-worker",
  });
  expect(selected.controlPlaneSnapshot?.chartArtifact).toMatchObject({
    id: fixture.chart.artifactId,
    buildId: fixture.chart.buildId,
    serviceId: "delivery-control-plane",
  });
  expect(
    await fixture.delivery.requestControlPlaneUpgrade(
      fixture.environment.id,
      fixture.input,
      testOperator,
    ),
  ).toEqual(selected);
  await fixture.delivery.claim(selected.id, testExecutor);
  await acceptTestController(fixture.delivery, selected);
  const detail = await fixture.delivery.detail(selected.id);
  expect(detail.environment.acceptedControlPlaneDeploymentId).toBe(selected.id);
  expect(detail.environment.acceptedVersionSetRevisionId).toBeNull();
  expect(detail.environment.observedVersionSetRevisionId).toBeNull();
  expect(detail.environment.desiredVersionSetRevisionId).toBeNull();
  expect(
    await context.cluster.database.platformArtifactReference.count({
      where: { deploymentId: selected.id },
    }),
  ).toBe(4);
  await expect(
    context.cluster.database.artifact.delete({
      where: { id: fixture.previous.artifactId },
    }),
  ).rejects.toThrow();
});

test("chart-only controller changes reuse the original unchanged image without counterfeit builds", async () => {
  const first = await fixture.delivery.requestControlPlaneUpgrade(
    fixture.environment.id,
    fixture.input,
    testOperator,
  );
  await fixture.delivery.claim(first.id, testExecutor);
  await acceptTestController(fixture.delivery, first);
  const freshChart = await fixture.publish(105, "chart");
  const current = await fixture.delivery.detail(first.id);
  const second = await fixture.delivery.requestControlPlaneUpgrade(
    fixture.environment.id,
    {
      requestId: "controller/chart-only",
      expectedGeneration: current.environment.generation,
      imageArtifactId: fixture.next.artifactId,
      chartArtifactId: freshChart.artifactId,
      reason:
        "Review isolated controller template change with unchanged original executable",
    },
    testOperator,
  );
  expect(second.controlPlaneSnapshot?.nextArtifact.id).toBe(
    fixture.next.artifactId,
  );
  expect(second.controlPlaneSnapshot?.nextArtifact.buildId).toBe(
    fixture.next.buildId,
  );
  expect(second.controlPlaneSnapshot?.source.id).toBe(freshChart.buildId);
  expect(second.controlPlaneSnapshot?.priorChartArtifact.id).toBe(
    fixture.chart.artifactId,
  );
  await fixture.delivery.claim(second.id, testExecutor);
  await acceptTestController(fixture.delivery, second);
  expect(
    await context.cluster.database.artifact.count({
      where: { id: fixture.next.artifactId },
    }),
  ).toBe(1);
});

test("controller replacement waits existing ordinary work then excludes every new claim", async () => {
  const ordinary = await context.delivery.createDeployment(
    context.input(),
    testOperator,
  );
  await context.delivery.claim(ordinary.id, testExecutor);
  const controller = await fixture.delivery.requestControlPlaneUpgrade(
    fixture.environment.id,
    fixture.input,
    testOperator,
  );
  await expect(
    fixture.delivery.claim(controller.id, testExecutor),
  ).rejects.toThrow("all existing Delivery operations");
  expect(await context.cluster.database.platformLock.count()).toBe(0);
  await context.delivery.finish(
    ordinary.id,
    {
      status: "succeeded",
      message: "Existing runtime accepted",
      observedRevisionId: ordinary.versionSetRevisionId,
      recoveryRequired: false,
      evidence: [
        { kind: "reconciliation", summary: "Exact source" },
        { kind: "acceptance", summary: "Exact runtime" },
      ],
    },
    testExecutor,
  );
  await fixture.delivery.claim(controller.id, testExecutor);
  const waiting = await context.delivery.createDeployment(
    { ...context.input("waiting/ordinary"), expectedGeneration: 1 },
    testOperator,
  );
  await expect(
    context.delivery.claim(waiting.id, testExecutor),
  ).rejects.toThrow("global execution barrier");
  await expect(
    fixture.delivery.claim(controller.id, testExecutor),
  ).rejects.toThrow("all existing Delivery operations");
  expect(await context.cluster.database.platformLock.count()).toBe(1);
  await context.delivery.cancel(waiting.id, testOperator);
  await fixture.delivery.claim(controller.id, testExecutor);
  await acceptTestController(fixture.delivery, controller);
  const next = await context.delivery.createDeployment(
    { ...context.input("after/controller"), expectedGeneration: 1 },
    testOperator,
  );
  await context.delivery.claim(next.id, testExecutor);
});

test("a queued original identity blocks replacement before any Temporal Visibility entry exists", async () => {
  const ordinary = await context.delivery.createDeployment(
    context.input(),
    testOperator,
  );
  const controller = await fixture.delivery.requestControlPlaneUpgrade(
    fixture.environment.id,
    fixture.input,
    testOperator,
  );
  expect(
    await context.cluster.database.outbox.count({
      where: { deploymentId: ordinary.id, submittedAt: null },
    }),
  ).toBe(1);
  await expect(
    fixture.delivery.claim(controller.id, testExecutor),
  ).rejects.toThrow("all existing Delivery operations");
  expect(await context.cluster.database.platformLock.count()).toBe(0);
  await context.delivery.cancel(ordinary.id, testOperator);
  await fixture.delivery.claim(controller.id, testExecutor);
});

test.each(["worker", "minecraft", "platform", "forum"] as const)(
  "pending %s intent remains a strong barrier even without a started Workflow",
  async (kind) => {
    const source = await context.delivery.createDeployment(
      context.input(),
      testOperator,
    );
    await context.delivery.cancel(source.id, testOperator);
    const controller = await fixture.delivery.requestControlPlaneUpgrade(
      fixture.environment.id,
      fixture.input,
      testOperator,
    );
    const database = context.cluster.database;
    const pending = {
      id: `unsubmitted/${kind}`,
      requestedBy: "test/operator",
      reason: "Persisted request not yet dispatched",
      expectedEnvironmentGeneration: 0,
      snapshotFingerprint: "a".repeat(64),
      workflowId: `pending/${kind}`,
    };
    // Pending durable identities must block replacement even if a crash left incomplete semantic evidence.
    switch (kind) {
      case "worker":
        await database.workerRecoveryIntent.create({
          data: {
            ...pending,
            deploymentId: source.id,
            poolFingerprint: "b".repeat(64),
          },
        });
        break;
      case "minecraft":
        await database.minecraftRecoveryIntent.create({
          data: { ...pending, deploymentId: source.id },
        });
        break;
      case "platform":
        await database.platformRecoveryIntent.create({
          data: { ...pending, deploymentId: source.id },
        });
        break;
      case "forum":
        await database.forumBaselineIntent.create({
          data: {
            ...pending,
            environmentId: source.environmentId,
            imageArtifactId: "arcade-image",
            bundleArtifactId: "arcade-chart",
            pipelineRevisionId: context.fixture.environment.pipelineRevisionId,
            configurationRevision: "config/1",
          },
        });
    }
    await expect(
      fixture.delivery.claim(controller.id, testExecutor),
    ).rejects.toThrow("all existing Delivery operations");
    expect(await database.platformLock.count()).toBe(0);
  },
);

test("ambiguous controller replacement keeps the global barrier across independent service instances", async () => {
  const selected = await fixture.delivery.requestControlPlaneUpgrade(
    fixture.environment.id,
    fixture.input,
    testOperator,
  );
  await fixture.delivery.claim(selected.id, testExecutor);
  await fixture.delivery.finish(
    selected.id,
    {
      status: "failed",
      message: "Lost native controller operation response",
      recoveryRequired: true,
      evidence: [],
    },
    testExecutor,
  );
  const restarted = new Delivery(context.cluster.database, 1, fixture.catalog);
  const ordinary = await restarted.createDeployment(
    context.input(),
    testOperator,
  );
  await expect(restarted.claim(ordinary.id, testExecutor)).rejects.toThrow(
    "global execution barrier",
  );
  expect(await context.cluster.database.platformLock.count()).toBe(1);
  const quarantined = await restarted.detail(selected.id);
  expect(quarantined.environment.activeDeploymentId).toBe(selected.id);
});

test("admin-only controller intents enforce source ownership and genuine initial prior identities", async () => {
  await expect(
    fixture.delivery.requestControlPlaneUpgrade(
      fixture.environment.id,
      fixture.input,
      { ...testOperator, scopes: ["read", "deploy", "approve"] },
    ),
  ).rejects.toThrow("admin");
  const inactive = await controlPlaneFixtureWithoutWrites();
  await expect(
    inactive.requestControlPlaneUpgrade(
      fixture.environment.id,
      fixture.input,
      testOperator,
    ),
  ).rejects.toThrow("legacy root");
  const { previousImageArtifactId: _previous, ...missing } = fixture.input;
  await expect(
    fixture.delivery.requestControlPlaneUpgrade(
      fixture.environment.id,
      missing,
      testOperator,
    ),
  ).rejects.toThrow("Initial original controller image");
  await expect(
    fixture.delivery.requestControlPlaneUpgrade(
      fixture.environment.id,
      { ...fixture.input, imageArtifactId: "arcade-image" },
      testOperator,
    ),
  ).rejects.toThrow("fixed original qualified");
});

async function controlPlaneFixtureWithoutWrites() {
  const { ServiceIndex } = await import("@shepherdjerred/ops-model/catalog.ts");
  return new Delivery(
    context.cluster.database,
    1,
    new ServiceIndex({ ...fixture.catalog.catalog, deliveryDelegations: {} }),
  );
}

test("controller barrier also excludes infrastructure plans and requires full native acceptance", async () => {
  const platform = await platformFixture(context.cluster.database);
  const controller = await fixture.delivery.requestControlPlaneUpgrade(
    fixture.environment.id,
    fixture.input,
    testOperator,
  );
  await fixture.delivery.claim(controller.id, testExecutor);
  const plan = await requestTestPlan(platform.delivery, platform.sourceBuildId);
  await expect(platform.delivery.claim(plan.id, testExecutor)).rejects.toThrow(
    "global execution barrier",
  );
  await expect(
    fixture.delivery.finish(
      controller.id,
      {
        status: "succeeded",
        message: "Caller-shaped success",
        recoveryRequired: false,
        evidence: [
          { kind: "reconciliation", summary: "Unproven" },
          { kind: "acceptance", summary: "Unproven" },
        ],
      },
      testExecutor,
    ),
  ).rejects.toThrow("exact completed independent native Job");
  const unchanged = await fixture.delivery.detail(controller.id);
  expect(unchanged.environment.acceptedControlPlaneDeploymentId).toBeNull();
});
