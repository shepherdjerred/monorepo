import { describe, expect, test } from "vitest";
import { useDeliveryFixture } from "#testing/delivery-fixture.ts";
import { createTestApp } from "#testing/http-app.ts";
import { testExecutor, testOperator, testPublisher } from "#testing/seed.ts";
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

/** A canary environment that takes arcade/prod's accepted selection (E6). */
async function canary() {
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
}

/** A second set revision of arcade holding the fixture's artifacts. */
async function secondSet() {
  const db = context.cluster.database;
  const first = await db.versionSet.findUniqueOrThrow({
    where: { id: context.fixture.versionSet.id },
    include: { entries: true },
  });
  return db.versionSet.create({
    data: {
      id: "arcade/set-2",
      serviceId: "arcade",
      revision: first.revision + 1,
      lineage: first.lineage,
      entries: {
        create: first.entries.map(({ component, artifactId }) => ({
          component,
          artifactId,
        })),
      },
    },
  });
}

/** Accepts a set revision in arcade/prod with the given monitor state. */
async function acceptInSource(
  versionSetId: string,
  monitorState: "settled" | "watching" | "alarmed",
) {
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
  await accept(deployment.id, versionSetId);
  await setMonitor(deployment.id, monitorState);
  return deployment;
}

async function setMonitor(
  deploymentId: string,
  monitorState: "settled" | "watching" | "alarmed",
) {
  await context.cluster.database.deployment.update({
    where: { id: deploymentId },
    data: {
      monitorState,
      monitorSettledAt: monitorState === "settled" ? new Date() : null,
    },
  });
}

/** A deploy into the canary, optionally asking for an override (H4). */
async function deployToCanary(
  versionSetId: string,
  requestId: string,
  override = false,
) {
  return context.delivery.createDeployment(
    {
      requestId,
      environmentId: "arcade/canary",
      versionSetRevisionId: versionSetId,
      expectedGeneration: 0,
      kind: "deploy",
      ...(override ? { override: true } : {}),
    },
    testOperator,
  );
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

  test("a non-eligible deploy needs an approval marked override, and its retry asks for one again (H4)", async () => {
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
    // Retrying the canceled override deploy asks for a fresh override
    // approval, because its set revision is still not eligible.
    await context.delivery.cancel(overridden.id, testOperator);
    const canceled = await environmentRow();
    const app = createTestApp(context.delivery, {
      machineCredentials: [],
      writesEnabled: () => Promise.resolve(true),
      enabledEnvironments: () => Promise.resolve([env.id]),
    });
    const response = await app.request(
      `/api/v1/deployments/${overridden.id}/retry`,
      {
        method: "POST",
        headers: {
          "Tailscale-User-Login": testOperator.id,
          Origin: "http://delivery.test",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          requestId: "override-retry",
          expectedGeneration: canceled.generation,
        }),
      },
    );
    expect(response.status).toBe(201);
    const retry = await context.cluster.database.deployment.findUniqueOrThrow({
      where: { requestId: "override-retry" },
      include: { approval: true },
    });
    expect(retry).toMatchObject({
      kind: "deploy",
      status: "awaiting_approval",
      approval: { status: "pending", override: true },
    });
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
    await declareConfiguration(
      "db16/1",
      { "helm.valuesObject": '{"db":{"major":"16"}}' },
      ["/helm/valuesObject/db/major"],
    );
    const sixteen = await rebind("db16/1");
    await accept(sixteen.id, context.fixture.versionSet.id);
    await declareConfiguration(
      "db17/1",
      { "helm.valuesObject": '{"db":{"major":17}}' },
      ["/helm/valuesObject/db/major"],
    );
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
      [
        sixteen.id,
        false,
        "would lower forwardOnly /helm/valuesObject/db/major from 17 to 16",
      ],
      [
        baseline.id,
        false,
        "would lower forwardOnly /helm/valuesObject/db/major from 17 to nothing",
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
      /excluded: would lower forwardOnly \/helm\/valuesObject\/db\/major from 17 to 16/u,
    );
  });
});

describe("eligibility through a promotion source (4.12, M2, W3)", () => {
  test("a deploy is eligible only for its source's current, settled acceptance", async () => {
    const first = context.fixture.versionSet.id;
    const baseline = await acceptedBaseline();
    await setMonitor(baseline.id, "settled");
    await canary();
    const current = await deployToCanary(first, "current");
    expect(current).toMatchObject({ kind: "deploy", status: "queued" });
    await context.delivery.cancel(current.id, testOperator);
    // The source replaces its acceptance: the set it held is no longer
    // eligible, however often it once succeeded there.
    const second = await secondSet();
    const replacement = await acceptInSource(second.id, "settled");
    await expect(deployToCanary(first, "replaced")).rejects.toThrow(
      /set revision is not arcade\/prod's accepted selection; a deploy may ask for an override approval/u,
    );
    const overridden = await deployToCanary(first, "replaced-override", true);
    expect(overridden.status).toBe("awaiting_approval");
    await context.delivery.cancel(overridden.id, testOperator);
    // An alarmed acceptance is not settled, so it is not eligible either.
    await setMonitor(replacement.id, "alarmed");
    await expect(deployToCanary(second.id, "alarmed")).rejects.toThrow(
      /arcade\/prod's accepted selection is alarmed, not settled \(W3\)/u,
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

describe("anonymous claims (D7)", () => {
  test("once an identity owns a deployment, a claim naming none is a fence that neither renews nor takes ownership", async () => {
    await context.cluster.database.service.update({
      where: { id: "arcade" },
      data: { selfHosted: true },
    });
    const env = await environmentRow();
    const deployment = await context.delivery.createDeployment(
      {
        requestId: "anonymous-fence",
        environmentId: env.id,
        versionSetRevisionId: context.fixture.versionSet.id,
        expectedGeneration: env.generation,
        kind: "deploy",
      },
      testOperator,
    );
    const owner = { workflowId: "delivery/owner", workflowRunId: "run-1" };
    await context.delivery.claim(deployment.id, testExecutor, undefined, owner);
    const lapsing = new Date(Date.now() + 5000);
    await context.cluster.database.deployment.update({
      where: { id: deployment.id },
      data: { leaseExpiresAt: lapsing },
    });
    // The fence rechecks admission and returns the owned deployment unchanged.
    const fenced = await context.delivery.claim(deployment.id, testExecutor);
    expect(fenced.deployment).toMatchObject({
      status: "running",
      ...owner,
      leaseExpiresAt: lapsing.toISOString(),
    });
    // A handed-off deployment passes only to a named successor.
    await context.delivery.handOff(deployment.id, owner, testExecutor);
    const anonymous = await context.delivery.claim(deployment.id, testExecutor);
    expect(anonymous.deployment.handoffAt).not.toBeNull();
    expect(anonymous.deployment.leaseExpiresAt).toBeNull();
    // The recorded executor still renews its own lease.
    const successor = { workflowId: "delivery/owner", workflowRunId: "run-2" };
    const taken = await context.delivery.claim(
      deployment.id,
      testExecutor,
      undefined,
      successor,
    );
    expect(taken.deployment).toMatchObject({ ...successor, handoffAt: null });
    expect(taken.deployment.leaseExpiresAt).not.toBeNull();
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

  test("a service tracking two components recomposes once, so their requires hold together", async () => {
    for (const component of ["server", "chart"])
      await context.cluster.database.componentReference.create({
        data: {
          serviceId: "temporal",
          component,
          sourceServiceId: "arcade",
          sourceComponent: component,
          mode: "tracking",
          sourceEnvironment: context.fixture.environment.id,
        },
      });
    await acceptedBaseline();
    // The next arcade build couples its image and chart by exact digest (A3).
    const server = `sha256:${"d".repeat(64)}`;
    const chart = `sha256:${"e".repeat(64)}`;
    const build = await context.delivery.publish(
      {
        requestId: "coupled/2",
        serviceId: "arcade",
        sourceRevision: "c".repeat(40),
        ciUrl: "https://woodpecker.sjer.red/repos/1/pipeline/2",
        verifiedAt: new Date().toISOString(),
        artifacts: [
          {
            id: "coupled-image",
            component: "server",
            kind: "image",
            uri: "docker.io/shepherdjerred/arcade",
            version: "2.0.0",
            digest: server,
            requires: { chart },
          },
          {
            id: "coupled-chart",
            component: "chart",
            kind: "chart",
            uri: "https://chartmuseum.tailnet-1a49.ts.net/charts/arcade-2.0.0.tgz",
            version: "2.0.0",
            digest: chart,
            requires: { server },
          },
        ],
      },
      testPublisher,
      { repositoryId: 1, pipelineNumber: 2 },
    );
    await context.delivery.qualify(build.buildId, "verified", testExecutor);
    const coupled = await context.cluster.database.versionSet.findFirstOrThrow({
      where: { qualifiedBuildId: build.buildId },
    });
    const env = await environmentRow();
    const deployment = await context.delivery.createDeployment(
      {
        requestId: "coupled/deploy",
        environmentId: env.id,
        versionSetRevisionId: coupled.id,
        expectedGeneration: env.generation,
        kind: "deploy",
      },
      testOperator,
    );
    await accept(deployment.id, coupled.id);
    const sets = await context.cluster.database.versionSet.findMany({
      where: { serviceId: "temporal" },
      include: { entries: true },
      orderBy: { revision: "asc" },
    });
    // One set revision per acceptance, never a half-updated mix.
    expect(sets).toHaveLength(2);
    expect(sets[1]).toMatchObject({ triggerDeploymentId: deployment.id });
    expect(
      sets[1]?.entries
        .map((entry) => [entry.component, entry.artifactId])
        .toSorted(([left = ""], [right = ""]) => left.localeCompare(right)),
    ).toEqual([
      ["chart", "coupled-chart"],
      ["server", "coupled-image"],
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
