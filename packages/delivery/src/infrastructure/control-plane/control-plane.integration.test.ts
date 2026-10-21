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
import { testNativeReceipt } from "#testing/platform-execution.ts";
import { deliveryOperationId } from "#shared/operation-id.ts";
import { fingerprint } from "#infrastructure/delivery-records.ts";

const context = useDeliveryFixture();
let fixture: Awaited<ReturnType<typeof controlPlaneFixture>>;
beforeEach(async () => {
  fixture = await controlPlaneFixture(context.cluster.database);
});

test("controller native admission, dispatch journal, replay and final acceptance append immutable evidence across API replacement", async () => {
  const selected = await fixture.delivery.requestControlPlaneUpgrade(
    fixture.environment.id,
    fixture.input,
    testOperator,
  );
  await fixture.delivery.claim(selected.id, testExecutor);
  const native = testNativeReceipt(selected.id);
  const prefix = `${selected.id}/stage/control-plane/`;
  const nativeEvidence = {
    kind: "preflight" as const,
    operationId: native.uid,
    summary: `Exact platform Job ${native.namespace}/${native.name}; fingerprint ${native.specFingerprint}`,
  };
  const legacy = await context.cluster.database.evidence.create({
    data: { id: `${prefix}0`, deploymentId: selected.id, ...nativeEvidence },
  });
  const running = {
    key: "control-plane",
    status: "running" as const,
    operationId: native.name,
    message: JSON.stringify(native),
  };
  await fixture.delivery.stage(
    selected.id,
    { ...running, evidence: [nativeEvidence] },
    testExecutor,
  );
  const journal = {
    ...nativeEvidence,
    summary: JSON.stringify({
      adapter: "control-plane-dispatch-barrier/v1",
      deploymentUID: crypto.randomUUID(),
      templateFingerprint: "a".repeat(64),
      priorReplicas: 1,
      podUIDs: [crypto.randomUUID()],
      replicaSetUIDs: [crypto.randomUUID()],
    }),
  };
  await fixture.delivery.stage(
    selected.id,
    { ...running, evidence: [journal] },
    testExecutor,
  );
  // The native fence and resumed Activity repeat their original offset-zero payload.
  await fixture.delivery.stage(
    selected.id,
    { ...running, evidence: [nativeEvidence] },
    testExecutor,
  );
  const replay = {
    ...nativeEvidence,
    summary: JSON.stringify({
      adapter: "control-plane-history-replay/v1",
      workflowId: `delivery/${selected.id}`,
      imageArtifactId: selected.controlPlaneSnapshot!.nextArtifact.id,
    }),
  };
  await fixture.delivery.stage(
    selected.id,
    { ...running, evidence: [replay] },
    testExecutor,
  );
  const snapshot = selected.controlPlaneSnapshot;
  if (snapshot === null) throw new Error("Expected frozen controller snapshot");
  const final = [
    nativeEvidence,
    {
      kind: "reconciliation" as const,
      operationId: crypto.randomUUID(),
      summary: "Exact independently owned controller synchronization finished",
    },
    {
      kind: "runtime" as const,
      operationId: native.uid,
      summary:
        "All original qualified controller templates and Pod digests verified",
    },
    {
      kind: "acceptance" as const,
      operationId: native.uid,
      summary: JSON.stringify({
        adapter: "control-plane",
        previousArtifactId: snapshot.previousArtifact.id,
        nextArtifactId: snapshot.nextArtifact.id,
        chartArtifactId: snapshot.chartArtifact.id,
        nativeJobUID: native.uid,
        argoRequestId: deliveryOperationId(`${selected.id}:control-plane`),
        argoOperationId: crypto.randomUUID(),
      }),
    },
  ];
  const replacement = new Delivery(
    context.cluster.database,
    1,
    fixture.delivery.catalog,
  );
  await replacement.stage(
    selected.id,
    { ...running, status: "succeeded", evidence: final },
    testExecutor,
  );
  const recorded = await context.cluster.database.evidence.findMany({
    where: { deploymentId: selected.id },
  });
  expect(recorded).toHaveLength(6);
  expect(recorded.find((entry) => entry.id === legacy.id)).toEqual(legacy);
  await replacement.stage(
    selected.id,
    { ...running, status: "succeeded", evidence: final },
    testExecutor,
  );
  expect(
    await context.cluster.database.evidence.count({
      where: { deploymentId: selected.id },
    }),
  ).toBe(6);
  await expect(
    replacement.stage(
      selected.id,
      {
        ...running,
        operationId: "another-job",
        status: "succeeded",
        evidence: [],
      },
      testExecutor,
    ),
  ).rejects.toThrow("Stage operation identity cannot change");
  await expect(
    replacement.stage(
      selected.id,
      { ...running, status: "running", evidence: [] },
      testExecutor,
    ),
  ).rejects.toThrow("Completed stage cannot be rewritten");
  await replacement.finish(
    selected.id,
    {
      status: "succeeded",
      message: "Exact native controller accepted",
      recoveryRequired: false,
      evidence: final,
    },
    testExecutor,
  );
  const accepted = await replacement.detail(selected.id);
  expect(accepted.environment.acceptedDeploymentId).toBe(selected.id);
});

test("ordinary stages cannot opt into controller evidence append by choosing its stage key", async () => {
  const selected = await context.delivery.createDeployment(
    context.input(),
    testOperator,
  );
  await context.delivery.claim(selected.id, testExecutor);
  const stage = {
    key: "control-plane",
    status: "running" as const,
    operationId: "ordinary/op",
    message: "ordinary",
    evidence: [{ kind: "preflight" as const, summary: "original" }],
  };
  await context.delivery.stage(selected.id, stage, testExecutor);
  await expect(
    context.delivery.stage(
      selected.id,
      { ...stage, evidence: [{ kind: "preflight", summary: "changed" }] },
      testExecutor,
    ),
  ).rejects.toThrow("Evidence cannot be rewritten");
});

test("controller evidence content identity still refuses a conflicting existing record", async () => {
  const selected = await fixture.delivery.requestControlPlaneUpgrade(
    fixture.environment.id,
    fixture.input,
    testOperator,
  );
  await fixture.delivery.claim(selected.id, testExecutor);
  const item = { kind: "preflight" as const, summary: "expected" };
  await context.cluster.database.evidence.create({
    data: {
      id: `${selected.id}/stage/control-plane/${fingerprint(item)}`,
      deploymentId: selected.id,
      kind: item.kind,
      summary: "corrupt",
    },
  });
  await expect(
    fixture.delivery.stage(
      selected.id,
      {
        key: "control-plane",
        status: "running",
        operationId: "native/op",
        message: "inspect",
        evidence: [item],
      },
      testExecutor,
    ),
  ).rejects.toThrow("Evidence cannot be rewritten");
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
  expect(detail.environment.acceptedDeploymentId).toBe(selected.id);
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
    const intent = {
      id: pending.id,
      deploymentId: source.id,
      sequence: 1,
      requestedBy: pending.requestedBy,
      reason: pending.reason,
      expectedGeneration: 0,
      fingerprint: `sha256:${"a".repeat(64)}`,
      workflowId: pending.workflowId,
    };
    // Pending durable identities must block replacement even if a crash left incomplete semantic evidence.
    switch (kind) {
      case "worker":
        await database.recoveryIntent.create({
          data: {
            ...intent,
            kind,
            detail: { poolFingerprint: "b".repeat(64) },
          },
        });
        break;
      case "minecraft":
      case "platform":
        await database.recoveryIntent.create({ data: { ...intent, kind } });
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
  expect(unchanged.environment.acceptedDeploymentId).toBeNull();
});
