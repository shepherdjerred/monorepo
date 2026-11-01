import { describe, expect, test } from "vitest";
import { useDeliveryFixture } from "#testing/delivery-fixture.ts";
import { createTestApp } from "#testing/http-app.ts";
import { testExecutor, testOperator, testPublisher } from "#testing/seed.ts";
import { lock } from "#infrastructure/delivery-records.ts";
import { orderKey } from "#infrastructure/delivery-data.ts";
import {
  deliverySuccessorWorkflowId,
  deliveryWorkflowId,
} from "#shared/contract.ts";
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

describe("the binding a new selection freezes (4.12, P2)", () => {
  test("a deploy of a new set revision freezes the declared binding; a rollback restores its own (4.12, P2)", async () => {
    const baseline = await acceptedBaseline();
    // The catalog binds a new recipe and configuration together with the
    // stack change a new set revision carries.
    const db = context.cluster.database;
    const recipe = await db.pipeline.findUniqueOrThrow({
      where: { id: baseline.pipelineRevisionId },
    });
    await db.pipeline.create({
      data: { id: "arcade/2", definition: recipe.definition ?? {} },
    });
    await db.environment.update({
      where: { id: context.fixture.environment.id },
      data: { pipelineRevisionId: "arcade/2" },
    });
    await declareConfiguration("config/2", { replicas: "3" });
    const set = await secondSet();
    const env = await environmentRow();
    const deployed = await context.delivery.createDeployment(
      {
        requestId: crypto.randomUUID(),
        environmentId: env.id,
        versionSetRevisionId: set.id,
        expectedGeneration: env.generation,
        kind: "deploy",
      },
      testOperator,
    );
    expect(deployed).toMatchObject({
      versionSetRevisionId: set.id,
      pipelineRevisionId: "arcade/2",
      configurationId: "config/2",
      previousAcceptedDeploymentId: baseline.id,
    });
    await accept(deployed.id, set.id);
    // The accepted selection already runs the declared binding.
    await expect(rebind("config/2")).rejects.toThrow(/already runs/u);
    const after = await environmentRow();
    const rollback = await context.delivery.createDeployment(
      {
        requestId: crypto.randomUUID(),
        environmentId: after.id,
        expectedGeneration: after.generation,
        kind: "rollback",
        selectionDeploymentId: baseline.id,
      },
      testOperator,
    );
    expect(rollback).toMatchObject({
      versionSetRevisionId: context.fixture.versionSet.id,
      pipelineRevisionId: baseline.pipelineRevisionId,
      configurationId: baseline.configurationId,
      restoredDeploymentId: baseline.id,
    });
  });

  test("a promotion freezes the target's declared binding, not its accepted one (4.12)", async () => {
    const baseline = await acceptedBaseline();
    await setMonitor(baseline.id, "settled");
    await canary();
    const db = context.cluster.database;
    await db.configuration.createMany({
      data: [
        { id: "canary/1", content: { replicas: "1" } },
        { id: "canary/2", content: { replicas: "2" } },
      ],
    });
    async function promote(declaredConfigurationId: string) {
      const env = await db.environment.update({
        where: { id: "arcade/canary" },
        data: { declaredConfigurationId },
      });
      return context.delivery.createDeployment(
        {
          requestId: crypto.randomUUID(),
          environmentId: env.id,
          expectedGeneration: env.generation,
          kind: "promote",
          sourceEnvironmentId: context.fixture.environment.id,
        },
        testOperator,
      );
    }
    const first = await promote("canary/1");
    expect(first).toMatchObject({
      versionSetRevisionId: context.fixture.versionSet.id,
      pipelineRevisionId: "arcade/1",
      configurationId: "canary/1",
    });
    await accept(first.id, context.fixture.versionSet.id);
    // The canary's accepted selection runs canary/1; the catalog now binds
    // canary/2, and the next promotion freezes it.
    expect(await promote("canary/2")).toMatchObject({
      versionSetRevisionId: context.fixture.versionSet.id,
      configurationId: "canary/2",
      previousAcceptedDeploymentId: first.id,
    });
  });
});

async function expectDeployUnderDeclaredRecipe(
  env: Awaited<ReturnType<typeof environmentRow>>,
) {
  const deploy = await context.delivery.createDeployment(
    {
      requestId: crypto.randomUUID(),
      environmentId: env.id,
      versionSetRevisionId: context.fixture.versionSet.id,
      expectedGeneration: env.generation,
      kind: "deploy",
    },
    testOperator,
  );
  expect(deploy).toMatchObject({
    pipelineRevisionId: env.pipelineRevisionId,
    configurationId: env.declaredConfigurationId,
  });
}

describe("binding over a pre-cutover acceptance (E0, section 7)", () => {
  test("a deploy over a pre-cutover platform acceptance runs under the declared recipe", async () => {
    const baseline = await acceptedBaseline();
    // A v1 platform deployment records a recipe only its typed request runs.
    await context.cluster.database.pipeline.create({
      data: {
        id: "platform/tofu:github/1",
        definition: {
          kind: "tofu",
          stack: "github",
          runnerImage: `docker.io/shepherdjerred/ci-base@sha256:${"a".repeat(64)}`,
        },
      },
    });
    await context.cluster.database.deployment.update({
      where: { id: baseline.id },
      data: { pipelineRevisionId: "platform/tofu:github/1" },
    });
    const env = await environmentRow();
    await expectDeployUnderDeclaredRecipe(env);
  });

  test("a deploy over a v1-backfill acceptance runs under the declared recipe", async () => {
    const baseline = await acceptedBaseline();
    const env = await environmentRow();
    // The v1 acceptance records a pre-catalog recipe revision of its own.
    const declared = await context.cluster.database.pipeline.findUniqueOrThrow({
      where: { id: env.pipelineRevisionId },
    });
    await context.cluster.database.pipeline.create({
      data: { id: "arcade/v1", definition: declared.definition ?? {} },
    });
    await context.cluster.database.deployment.update({
      where: { id: baseline.id },
      data: { pipelineRevisionId: "arcade/v1", catalogRevision: "v1-backfill" },
    });
    await expectDeployUnderDeclaredRecipe(env);
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

  test("admission rechecks a queued promote or deploy against its source's current acceptance (M2)", async () => {
    const first = context.fixture.versionSet.id;
    const baseline = await acceptedBaseline();
    await setMonitor(baseline.id, "settled");
    await canary();
    const promoted = await context.delivery.createDeployment(
      {
        requestId: "queued-promotion",
        environmentId: "arcade/canary",
        expectedGeneration: 0,
        kind: "promote",
        sourceEnvironmentId: context.fixture.environment.id,
      },
      testOperator,
    );
    // The source accepts another set while the promotion waits.
    const second = await secondSet();
    const replacement = await acceptInSource(second.id, "settled");
    const stale =
      /Deployment inputs are stale: set revision is not arcade\/prod's accepted selection; request a new deployment \(M2\)/u;
    await expect(
      context.delivery.claim(promoted.id, testExecutor),
    ).rejects.toThrow(stale);
    expect(await deploymentRow(promoted.id)).toMatchObject({
      status: "failed",
      message: expect.stringMatching(stale),
    });
    // An eligible deploy waits while its source's acceptance is watching,
    // and is stale once that acceptance alarms.
    const deployed = await deployToCanary(second.id, "queued-deploy");
    await setMonitor(replacement.id, "watching");
    await expect(
      context.delivery.claim(deployed.id, testExecutor),
    ).rejects.toThrow(
      /is watching, not settled \(W3\); the deployment stays queued \(M2\)/u,
    );
    expect(await deploymentRow(deployed.id)).toMatchObject({
      status: "queued",
    });
    await setMonitor(replacement.id, "alarmed");
    await expect(
      context.delivery.claim(deployed.id, testExecutor),
    ).rejects.toThrow(/stale: arcade\/prod's accepted selection is alarmed/u);
    expect(await deploymentRow(deployed.id)).toMatchObject({
      status: "failed",
    });
    // An approved override was decided on an ineligible set (H4); admission
    // does not recheck its source.
    const overridden = await deployToCanary(first, "queued-override", true);
    await context.delivery.approve(
      overridden.id,
      { decision: "approve", reason: "ship the old set", override: true },
      testOperator,
    );
    expect(
      await context.delivery.claim(overridden.id, testExecutor),
    ).toMatchObject({ deployment: { status: "running" } });
  });
});

/** Whether one connection is waiting on an advisory lock. */
async function waitsOnAdvisoryLock() {
  for (let attempt = 0; attempt < 100; attempt++) {
    const rows = await context.cluster.database.$queryRaw<
      { count: number }[]
    >`SELECT count(*)::integer AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event = 'advisory'`;
    if (rows[0]?.count === 1) return true;
    await Bun.sleep(5);
  }
  return false;
}

describe("admission against a concurrent monitor write (M2, W1)", () => {
  test("admission waits for the source monitor's lock and reads its state after it", async () => {
    const baseline = await acceptedBaseline();
    await setMonitor(baseline.id, "settled");
    await canary();
    const deployed = await deployToCanary(
      context.fixture.versionSet.id,
      "racing-deploy",
    );
    // A monitor write holds the source acceptance's lock, as an
    // observation does, and changes its state before committing.
    const held = Promise.withResolvers<undefined>(),
      release = Promise.withResolvers<undefined>();
    const monitor = context.cluster.database.$transaction(
      async (tx) => {
        await lock(tx, `deployment:${baseline.id}`);
        await tx.deployment.update({
          where: { id: baseline.id },
          data: { monitorState: "alarmed", monitorSettledAt: null },
        });
        held.resolve(undefined);
        await release.promise;
      },
      { timeout: 10_000 },
    );
    await held.promise;
    const claimed = (async () => {
      try {
        return {
          value: await context.delivery.claim(deployed.id, testExecutor),
          error: null,
        };
      } catch (error: unknown) {
        return { value: null, error };
      }
    })();
    try {
      expect(await waitsOnAdvisoryLock()).toBe(true);
    } finally {
      release.resolve(undefined);
      await monitor;
    }
    expect(await claimed).toMatchObject({
      value: null,
      error: {
        message: expect.stringMatching(
          /stale: arcade\/prod's accepted selection is alarmed/u,
        ),
      },
    });
    expect(await deploymentRow(deployed.id)).toMatchObject({
      status: "failed",
    });
  });
});

async function deploymentRow(id: string) {
  return context.cluster.database.deployment.findUniqueOrThrow({
    where: { id },
  });
}

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
    // The fixture's CI build keys on its pipeline, then its registration (B4).
    const accepted =
      await context.cluster.database.versionSet.findUniqueOrThrow({
        where: { id: context.fixture.versionSet.id },
      });
    expect(accepted.orderMajor).toBe(1);
    expect(claimed.deployment.admissionSnapshot?.prerequisites).toEqual([
      {
        environmentId: context.fixture.environment.id,
        rule: "same-or-later-order-key",
        deploymentId: baseline.id,
        versionSetRevisionId: context.fixture.versionSet.id,
        orderKey: orderKey(accepted.orderMajor, accepted.orderMinor),
      },
    ]);
  });
});

/** A deployment of arcade claimed by its original executor run (D7). */
async function ownedDeployment(requestId: string, selfHosted: boolean) {
  await context.cluster.database.service.update({
    where: { id: "arcade" },
    data: { selfHosted },
  });
  const env = await environmentRow();
  const deployment = await context.delivery.createDeployment(
    {
      requestId,
      environmentId: env.id,
      versionSetRevisionId: context.fixture.versionSet.id,
      expectedGeneration: env.generation,
      kind: "deploy",
    },
    testOperator,
  );
  const outgoing = {
    workflowId: deliveryWorkflowId(deployment.id),
    workflowRunId: "run-1",
  };
  await context.delivery.claim(
    deployment.id,
    testExecutor,
    undefined,
    outgoing,
  );
  const successor = {
    workflowId: deliverySuccessorWorkflowId(deployment.id),
    workflowRunId: "successor-1",
  };
  return { id: deployment.id, outgoing, successor };
}

describe("self-hosted handoff (D7, D8)", () => {
  test("a self-hosted deployment passes only through its successor's handoff claim", async () => {
    const { id, outgoing, successor } = await ownedDeployment(
      "self-hosted",
      true,
    );
    const detail = await context.delivery.detail(id);
    expect(detail.selfHosted).toBe(true);
    // Without the marker even the successor identity is refused (D7).
    await expect(
      context.delivery.claimHandoff(id, successor, testExecutor),
    ).rejects.toThrow(/holds no handoff marker/u);
    await expect(
      context.delivery.claim(id, testExecutor, undefined, {
        ...outgoing,
        workflowRunId: "run-2",
      }),
    ).rejects.toThrow(/never re-owned/u);
    const handed = await context.delivery.handOff(id, outgoing, testExecutor);
    expect(handed.handoffAt).not.toBeNull();
    expect(handed.leaseExpiresAt).toBeNull();
    // The outgoing lease stays frozen; ordinary claims never transfer the
    // marker, and only the one successor Workflow may take it.
    await expect(
      context.delivery.renewLease(id, outgoing, testExecutor),
    ).rejects.toThrow(/stays frozen/u);
    await expect(
      context.delivery.claim(id, testExecutor, undefined, successor),
    ).rejects.toThrow(/never re-owned/u);
    await expect(
      context.delivery.claimHandoff(
        id,
        { ...outgoing, workflowRunId: "run-2" },
        testExecutor,
      ),
    ).rejects.toThrow(/Only the deployment's successor executor/u);
    const closed = (reason: string) =>
      context.delivery.orphan(
        id,
        {
          workflowId: outgoing.workflowId,
          workflowStatus: "COMPLETED",
          reason,
        },
        testExecutor,
      );
    // The outgoing Workflow closing after handoff is expected, not an orphan.
    await expect(closed("Closed after handing off")).rejects.toThrow(
      /awaits its successor executor/u,
    );
    const taken = await context.delivery.claimHandoff(
      id,
      successor,
      testExecutor,
    );
    expect(taken).toMatchObject({ ...successor, handoffAt: null });
    expect(taken.leaseExpiresAt).not.toBeNull();
    expect(
      await context.delivery.claimHandoff(id, successor, testExecutor),
    ).toMatchObject(successor);
    await expect(
      context.delivery.claimHandoff(
        id,
        { ...successor, workflowRunId: "successor-2" },
        testExecutor,
      ),
    ).rejects.toThrow(/never re-owned/u);
    await expect(closed("No longer the owner")).rejects.toThrow(
      /does not own this deployment/u,
    );
    await context.delivery.renewLease(id, successor, testExecutor);
    expect(
      await context.cluster.database.audit.count({
        where: { action: "deployment.handoff_claimed", entityId: id },
      }),
    ).toBe(1);
    // A retried handoff whose first response was lost answers from the
    // durable handoff record after the successor claimed, changing nothing.
    expect(
      await context.delivery.handOff(id, outgoing, testExecutor),
    ).toMatchObject({ ...successor, handoffAt: null });
    expect(
      await context.cluster.database.audit.count({
        where: { action: "deployment.handed_off", entityId: id },
      }),
    ).toBe(1);
    // Any other identity still cannot hand it off.
    await expect(
      context.delivery.handOff(
        id,
        { ...outgoing, workflowRunId: "run-9" },
        testExecutor,
      ),
    ).rejects.toThrow(/never re-owned/u);
  });

  test("the successor claim route stays open while writes are paused", async () => {
    const { id, outgoing, successor } = await ownedDeployment(
      "self-hosted-http",
      true,
    );
    await context.delivery.handOff(id, outgoing, testExecutor);
    const token = "test-successor-executor-credential-000";
    const app = createTestApp(context.delivery, {
      machineCredentials: [{ token, principal: testExecutor }],
      writesEnabled: () => Promise.resolve(false),
      enabledEnvironments: () => Promise.resolve([]),
    });
    const response = await app.request(`/api/v1/deployments/${id}/successor`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(successor),
    });
    expect(response.status).toBe(200);
    expect(
      await context.cluster.database.deployment.findUniqueOrThrow({
        where: { id },
      }),
    ).toMatchObject({ workflowRunId: "successor-1", handoffAt: null });
  });

  test("an ordinary service never hands off", async () => {
    const { id, outgoing, successor } = await ownedDeployment(
      "ordinary",
      false,
    );
    await expect(
      context.delivery.handOff(id, outgoing, testExecutor),
    ).rejects.toThrow(/Only a self-hosted service/u);
    await expect(
      context.delivery.claimHandoff(id, successor, testExecutor),
    ).rejects.toThrow(/holds no handoff marker/u);
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
    // A handed-off deployment passes only through its successor's handoff claim (D8).
    await context.delivery.handOff(deployment.id, owner, testExecutor);
    await expect(
      context.delivery.claim(deployment.id, testExecutor),
    ).rejects.toThrow(/successor's handoff claim/u);
  });
});

/** A verified temporal build of its own worker image, and the set it composed. */
async function publishTemporal(number: number) {
  const build = await context.delivery.publish(
    {
      requestId: `temporal/${String(number)}`,
      serviceId: "temporal",
      sourceRevision: String(number).repeat(40),
      ciUrl: `https://woodpecker.sjer.red/repos/1/pipeline/${String(number)}`,
      verifiedAt: new Date().toISOString(),
      artifacts: [
        {
          id: `temporal-worker-${String(number)}`,
          component: "worker",
          kind: "image",
          uri: "docker.io/shepherdjerred/temporal-worker",
          version: `1.0.${String(number)}`,
          digest: `sha256:${String(number).repeat(64)}`,
        },
      ],
    },
    testPublisher,
    { repositoryId: 1, pipelineNumber: number },
  );
  await context.delivery.qualify(build.buildId, "verified", testExecutor);
  return context.cluster.database.versionSet.findFirstOrThrow({
    where: { qualifiedBuildId: build.buildId },
    include: { entries: true },
  });
}

/** The arcade artifact the set of temporal's next build mirrors. */
async function mirror(number: number) {
  const set = await publishTemporal(number);
  return set.entries.find((entry) => entry.component === "image:arcade-mirror")
    ?.artifactId;
}

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

  test("a pinned reference takes its source's newest live artifact when the referencing service composes (A5)", async () => {
    await context.cluster.database.componentReference.create({
      data: {
        serviceId: "temporal",
        component: "image:arcade-mirror",
        sourceServiceId: "arcade",
        sourceComponent: "server",
        mode: "pinned",
      },
    });
    expect(await mirror(3)).toBe("arcade-image");
    // arcade publishes a new live set; a pinned reference triggers nothing.
    const arcade = await context.delivery.publish(
      {
        requestId: "arcade/4",
        serviceId: "arcade",
        sourceRevision: "4".repeat(40),
        ciUrl: "https://woodpecker.sjer.red/repos/1/pipeline/4",
        verifiedAt: new Date().toISOString(),
        artifacts: [
          {
            id: "arcade-image-4",
            component: "server",
            kind: "image",
            uri: "docker.io/shepherdjerred/arcade",
            version: "1.0.4",
            digest: `sha256:${"4".repeat(64)}`,
          },
        ],
      },
      testPublisher,
      { repositoryId: 1, pipelineNumber: 4 },
    );
    await context.delivery.qualify(arcade.buildId, "verified", testExecutor);
    expect(
      await context.cluster.database.versionSet.count({
        where: { serviceId: "temporal" },
      }),
    ).toBe(1);
    // temporal's next build carries the source's new artifact, not the one
    // its live set carried.
    expect(await mirror(5)).toBe("arcade-image-4");
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
