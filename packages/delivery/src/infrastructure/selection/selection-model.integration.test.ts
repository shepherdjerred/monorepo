import { describe, expect, test } from "vitest";
import { useDeliveryFixture } from "#testing/delivery-fixture.ts";
import { testExecutor, testOperator } from "#testing/seed.ts";
import { rollbackCandidates } from "./candidates.ts";

const context = useDeliveryFixture();

async function environmentRow() {
  return context.cluster.database.environment.findUniqueOrThrow({
    where: { id: context.fixture.environment.id },
  });
}

async function accept(deploymentId: string, versionSetId: string) {
  await context.delivery.claim(deploymentId, testExecutor);
  return context.delivery.finish(
    deploymentId,
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
}

async function acceptedBaseline() {
  const env = await environmentRow();
  const deployment = await context.delivery.createDeployment(
    {
      requestId: crypto.randomUUID(),
      environmentId: env.id,
      versionSetRevisionId: context.fixture.versionSet.id,
      expectedGeneration: env.generation,
      kind: "deploy",
    },
    testOperator,
  );
  await accept(deployment.id, context.fixture.versionSet.id);
  return deployment;
}

async function declareConfiguration(
  id: string,
  content: Record<string, string>,
  forwardOnly: string[] = [],
) {
  await context.cluster.database.configuration.create({
    data: { id, content, forwardOnly },
  });
  await context.cluster.database.environment.update({
    where: { id: context.fixture.environment.id },
    data: { declaredConfigurationId: id },
  });
}

async function rebind(configurationRevisionId: string) {
  const env = await environmentRow();
  return context.delivery.createDeployment(
    {
      requestId: crypto.randomUUID(),
      environmentId: env.id,
      expectedGeneration: env.generation,
      kind: "rebind",
      configurationRevisionId,
    },
    testOperator,
  );
}

describe("selections (4.9, 4.12)", () => {
  test("rebind keeps the accepted set revision and moves only to the declared configuration", async () => {
    const baseline = await acceptedBaseline();
    await expect(rebind("config/1")).rejects.toThrow(/already runs/u);
    await declareConfiguration("config/2", { replicas: "3" });
    await expect(rebind("other/1")).rejects.toThrow(
      /declared recipe arcade\/1 and configuration config\/2/u,
    );
    const moved = await rebind("config/2");
    expect(moved).toMatchObject({
      kind: "rebind",
      versionSetRevisionId: context.fixture.versionSet.id,
      pipelineRevisionId: baseline.pipelineRevisionId,
      configurationId: "config/2",
      previousAcceptedDeploymentId: baseline.id,
    });
    await accept(moved.id, context.fixture.versionSet.id);
    expect(await environmentRow()).toMatchObject({
      acceptedDeploymentId: moved.id,
      generation: 2,
    });
  });

  test("a non-eligible deploy needs an approval marked override (H4)", async () => {
    await context.cluster.database.service.update({
      where: { id: "arcade" },
      data: { lineage: "f".repeat(64) },
    });
    const env = await environmentRow();
    const request = {
      environmentId: env.id,
      versionSetRevisionId: context.fixture.versionSet.id,
      expectedGeneration: env.generation,
      kind: "deploy" as const,
    };
    await expect(
      context.delivery.createDeployment(
        { ...request, requestId: "plain" },
        testOperator,
      ),
    ).rejects.toThrow(/previous lineage \(R5\)/u);
    const overridden = await context.delivery.createDeployment(
      { ...request, requestId: "override", override: true },
      testOperator,
    );
    expect(overridden.status).toBe("awaiting_approval");
    const approval = await context.cluster.database.approval.findUniqueOrThrow({
      where: { deploymentId: overridden.id },
    });
    expect(approval).toMatchObject({ status: "pending", override: true });
    await expect(
      context.delivery.approve(
        overridden.id,
        { decision: "approve", reason: "ship it" },
        testOperator,
      ),
    ).rejects.toThrow(/needs an approval marked override/u);
    const approved = await context.delivery.approve(
      overridden.id,
      {
        decision: "approve",
        reason: "reviewed the old lineage",
        override: true,
      },
      testOperator,
    );
    expect(approved.status).toBe("queued");
  });

  test("promotion takes the source's accepted selection only once it settles (W3)", async () => {
    const baseline = await acceptedBaseline();
    await context.cluster.database.environment.create({
      data: {
        id: "arcade/canary",
        serviceId: "arcade",
        name: "canary",
        pipelineRevisionId: "arcade/1",
        declaredConfigurationId: "config/1",
        promotionSourceEnvironmentId: context.fixture.environment.id,
      },
    });
    await context.cluster.database.deployment.update({
      where: { id: baseline.id },
      data: { monitorState: "watching", monitorSettledAt: null },
    });
    const request = {
      environmentId: "arcade/canary",
      expectedGeneration: 0,
      kind: "promote" as const,
      sourceEnvironmentId: context.fixture.environment.id,
    };
    await expect(
      context.delivery.createDeployment(
        { ...request, requestId: "too-early" },
        testOperator,
      ),
    ).rejects.toThrow(/is watching, not settled \(W3\)/u);
    await context.cluster.database.deployment.update({
      where: { id: baseline.id },
      data: { monitorState: "settled", monitorSettledAt: new Date() },
    });
    const promoted = await context.delivery.createDeployment(
      { ...request, requestId: "settled" },
      testOperator,
    );
    expect(promoted).toMatchObject({
      kind: "promote",
      versionSetRevisionId: context.fixture.versionSet.id,
      sourceEnvironmentId: context.fixture.environment.id,
    });
  });

  test("rollback candidates state why each earlier selection is excluded (D9, F3)", async () => {
    const baseline = await acceptedBaseline();
    await declareConfiguration("db16/1", { "db.major": "16" }, ["db.major"]);
    const sixteen = await rebind("db16/1");
    await accept(sixteen.id, context.fixture.versionSet.id);
    await declareConfiguration("db17/1", { "db.major": "17" }, ["db.major"]);
    const seventeen = await rebind("db17/1");
    await accept(seventeen.id, context.fixture.versionSet.id);
    const candidates = await rollbackCandidates(
      context.cluster.database,
      context.fixture.environment.id,
    );
    expect(
      candidates.map((entry) => [
        entry.deploymentId,
        entry.eligible,
        entry.reason,
      ]),
    ).toEqual([
      [seventeen.id, true, null],
      [sixteen.id, false, "would lower forwardOnly db.major from 17 to 16"],
      [
        baseline.id,
        false,
        "would lower forwardOnly db.major from 17 to nothing",
      ],
    ]);
    const env = await environmentRow();
    await expect(
      context.delivery.createDeployment(
        {
          requestId: "lower",
          environmentId: env.id,
          expectedGeneration: env.generation,
          kind: "rollback",
          selectionDeploymentId: sixteen.id,
        },
        testOperator,
      ),
    ).rejects.toThrow(
      /excluded: would lower forwardOnly db.major from 17 to 16/u,
    );
  });
});

describe("admission (Z1, D8)", () => {
  test("a deploy waits for its prerequisite edge and freezes the accepted selection it found", async () => {
    const baseline = await acceptedBaseline();
    await context.cluster.database.environment.create({
      data: {
        id: "arcade/dependent",
        serviceId: "arcade",
        name: "dependent",
        pipelineRevisionId: "arcade/1",
        declaredConfigurationId: "config/1",
      },
    });
    await context.cluster.database.prerequisiteEdge.create({
      data: {
        dependentId: "arcade/dependent",
        prerequisiteId: context.fixture.environment.id,
        rule: "same-or-later-order-key",
      },
    });
    await context.cluster.database.environment.update({
      where: { id: context.fixture.environment.id },
      data: { acceptedDeploymentId: null, acceptedVersionSetRevisionId: null },
    });
    const dependent = await context.delivery.createDeployment(
      {
        requestId: "dependent",
        environmentId: "arcade/dependent",
        versionSetRevisionId: context.fixture.versionSet.id,
        expectedGeneration: 0,
        kind: "deploy",
      },
      testOperator,
    );
    await expect(
      context.delivery.claim(dependent.id, testExecutor),
    ).rejects.toThrow(
      /Waiting for arcade\/prod to accept a qualifying selection/u,
    );
    await context.cluster.database.environment.update({
      where: { id: context.fixture.environment.id },
      data: {
        acceptedDeploymentId: baseline.id,
        acceptedVersionSetRevisionId: context.fixture.versionSet.id,
      },
    });
    const claimed = await context.delivery.claim(dependent.id, testExecutor);
    expect(claimed.deployment.admissionSnapshot?.prerequisites).toEqual([
      {
        environmentId: context.fixture.environment.id,
        rule: "same-or-later-order-key",
        deploymentId: baseline.id,
        versionSetRevisionId: context.fixture.versionSet.id,
        orderKey: "0000000001.0000000000",
      },
    ]);
  });

  test("a self-hosted deployment passes to its successor executor and to no one else", async () => {
    await context.cluster.database.service.update({
      where: { id: "arcade" },
      data: { selfHosted: true },
    });
    const env = await environmentRow();
    const deployment = await context.delivery.createDeployment(
      {
        requestId: "self-hosted",
        environmentId: env.id,
        versionSetRevisionId: context.fixture.versionSet.id,
        expectedGeneration: env.generation,
        kind: "deploy",
      },
      testOperator,
    );
    const outgoing = { workflowId: "delivery/self", workflowRunId: "run-1" };
    await context.delivery.claim(
      deployment.id,
      testExecutor,
      undefined,
      outgoing,
    );
    await expect(
      context.delivery.claim(deployment.id, testExecutor, undefined, {
        workflowId: "delivery/self",
        workflowRunId: "run-2",
      }),
    ).rejects.toThrow(/never re-owned/u);
    const handed = await context.delivery.handOff(
      deployment.id,
      outgoing,
      testExecutor,
    );
    expect(handed.handoffAt).not.toBeNull();
    expect(handed.leaseExpiresAt).toBeNull();
    const successor = { workflowId: "delivery/self", workflowRunId: "run-2" };
    const taken = await context.delivery.claim(
      deployment.id,
      testExecutor,
      undefined,
      successor,
    );
    expect(taken.deployment).toMatchObject({
      workflowRunId: "run-2",
      handoffAt: null,
    });
    await expect(
      context.delivery.claim(deployment.id, testExecutor, undefined, {
        workflowId: "delivery/self",
        workflowRunId: "run-3",
      }),
    ).rejects.toThrow(/never re-owned/u);
  });
});

describe("composition (R0, K1, R7)", () => {
  test("a tracking reference recomposes the referencing service when its source accepts", async () => {
    await context.cluster.database.componentReference.create({
      data: {
        serviceId: "temporal",
        component: "image:arcade-mirror",
        sourceServiceId: "arcade",
        sourceComponent: "server",
        mode: "tracking",
        sourceEnvironment: context.fixture.environment.id,
      },
    });
    const baseline = await acceptedBaseline();
    const composed = await context.cluster.database.versionSet.findFirstOrThrow(
      {
        where: { serviceId: "temporal" },
        include: { entries: true },
      },
    );
    expect(composed).toMatchObject({
      automatic: true,
      triggerDeploymentId: baseline.id,
      qualifiedBuildId: null,
      orderMajor: 0,
    });
    expect(composed.entries).toEqual([
      expect.objectContaining({
        component: "image:arcade-mirror",
        artifactId: "arcade-image",
      }),
    ]);
  });

  test("a set revision is composed only once every declared component is filled", async () => {
    await context.cluster.database.service.update({
      where: { id: "arcade" },
      data: {
        components: [{ name: "server" }, { name: "chart" }, { name: "assets" }],
        lineage: "e".repeat(64),
      },
    });
    const partial = await context.publishVerified(2);
    expect(
      await context.cluster.database.versionSet.count({
        where: { qualifiedBuildId: partial.buildId },
      }),
    ).toBe(0);
    const env = await environmentRow();
    await expect(
      context.delivery.createDeployment(
        {
          requestId: "incomplete",
          environmentId: env.id,
          versionSetRevisionId: context.fixture.versionSet.id,
          expectedGeneration: env.generation,
          kind: "deploy",
        },
        testOperator,
      ),
    ).rejects.toThrow(/lacks assets \(K1\)/u);
  });
});
