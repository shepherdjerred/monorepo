import { describe, expect, test } from "vitest";
import { useDeliveryFixture } from "#testing/delivery-fixture.ts";
import { testExecutor, testOperator } from "#testing/seed.ts";
import type { ColdStartSnapshot } from "#shared/model/cold-start-contract.ts";
import { bootstrapChain } from "./snapshot.ts";

const context = useDeliveryFixture();
const admin = {
  ...testOperator,
  scopes: [...testOperator.scopes, "admin" as const],
};

/** Arcade is self-hosted here; a beta environment depends on arcade/prod (the chain). */
async function chainFixture() {
  const db = context.cluster.database;
  await db.service.update({
    where: { id: "arcade" },
    data: { selfHosted: true },
  });
  const prod = await db.environment.findUniqueOrThrow({
    where: { id: "arcade/prod" },
  });
  await db.environment.create({
    data: {
      id: "arcade/beta",
      serviceId: "arcade",
      name: "beta",
      pipelineRevisionId: prod.pipelineRevisionId,
      declaredConfigurationId: prod.declaredConfigurationId,
    },
  });
  await db.prerequisiteEdge.create({
    data: {
      dependentId: "arcade/beta",
      prerequisiteId: "arcade/prod",
      rule: "any-accepted",
    },
  });
}

async function acceptProd(operationId: string) {
  const env = await context.cluster.database.environment.findUniqueOrThrow({
    where: { id: "arcade/prod" },
  });
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
  await context.delivery.claim(deployment.id, testExecutor);
  await context.delivery.stage(
    deployment.id,
    {
      key: "reconcile",
      status: "succeeded",
      operationId,
      message: "Exact sync completed",
      evidence: [],
    },
    testExecutor,
  );
  await context.delivery.finish(
    deployment.id,
    {
      status: "succeeded",
      message: "Accepted",
      observedRevisionId: context.fixture.versionSet.id,
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

async function prodHold() {
  const env = await context.cluster.database.environment.findUniqueOrThrow({
    where: { id: "arcade/prod" },
  });
  return env.restoreHold;
}

function application(requestId: string) {
  return {
    metadata: { name: "arcade" },
    status: {
      operationState: {
        operation: {
          info: [{ name: "ci.sjer.red/request-id", value: requestId }],
        },
      },
    },
  };
}

describe("cold start (section 6)", () => {
  test("the bootstrap chain is the self-hosted environments and their prerequisites, prerequisites first", async () => {
    await chainFixture();
    expect(await bootstrapChain(context.cluster.database)).toEqual([
      "arcade/prod",
      "arcade/beta",
    ]);
  });

  test("an acceptance in the chain requires a snapshot whose receipt is backup evidence", async () => {
    const outside = await acceptProd("op-outside");
    expect(await context.delivery.coldStartRequirement(outside.id)).toEqual({
      required: false,
    });
    await chainFixture();
    const accepted = await acceptProd("op-1");
    const requirement = await context.delivery.coldStartRequirement(
      accepted.id,
    );
    if (!requirement.required) throw new Error("Expected a snapshot");
    const prod = requirement.snapshot.environments.find(
      (env) => env.id === "arcade/prod",
    );
    expect(prod).toMatchObject({
      bootstrapOrder: 0,
      accepted: { deploymentId: accepted.id, operationId: "op-1" },
    });
    expect(Object.keys(requirement.snapshot.recipes)).toEqual(["arcade/1"]);
    await context.delivery.recordColdStartReceipt(
      accepted.id,
      {
        fingerprint: requirement.fingerprint,
        uri: "s3://delivery-cold-start/snapshots/1.json",
        writtenAt: new Date().toISOString(),
      },
      testExecutor,
    );
    const backups = await context.cluster.database.evidence.findMany({
      where: { deploymentId: accepted.id, kind: "backup" },
    });
    expect(backups).toHaveLength(1);
  });

  test("a restore holds each mismatched environment until an operator or an acceptance settles it", async () => {
    await chainFixture();
    const accepted = await acceptProd("op-1");
    const requirement = await context.delivery.coldStartRequirement(
      accepted.id,
    );
    if (!requirement.required) throw new Error("Expected a snapshot");
    const matching = await context.delivery.reconcileAfterRestore(
      requirement.snapshot,
      admin,
      async () => application("op-1"),
    );
    expect(matching.environments.every((env) => !env.held)).toBe(true);
    expect(
      matching.environments.find((env) => env.environmentId === "arcade/prod"),
    ).toMatchObject({ live: "matches" });

    const older: ColdStartSnapshot = {
      ...requirement.snapshot,
      environments: requirement.snapshot.environments.map((env) => ({
        ...env,
        accepted: null,
      })),
    };
    const result = await context.delivery.reconcileAfterRestore(
      older,
      admin,
      async () => application("op-other"),
    );
    expect(
      result.environments.find((env) => env.environmentId === "arcade/prod"),
    ).toMatchObject({ held: true, live: "differs", snapshot: null });
    const held = await context.cluster.database.environment.findUniqueOrThrow({
      where: { id: "arcade/prod" },
    });
    expect(held.restoreHold).not.toBeNull();
    expect(held.acceptedDeploymentId).toBe(accepted.id);
    await context.cluster.database.environment.update({
      where: { id: "arcade/prod" },
      data: { automatic: true },
    });
    const selected = await context.delivery.reconcile(
      ["arcade/prod"],
      testExecutor,
    );
    expect(selected.deployments).toEqual([]);
    await context.delivery.settleRestoreHold(
      "arcade/prod",
      {
        reason: "Inspected the live Application against the record",
        evidence: "argocd app get arcade shows the accepted revision",
      },
      admin,
    );
    expect(await prodHold()).toBeNull();
    await expect(
      context.delivery.settleRestoreHold(
        "arcade/prod",
        { reason: "Nothing is held any more here", evidence: "none" },
        admin,
      ),
    ).rejects.toThrow(/holds no restore mismatch/u);
    await context.delivery.reconcileAfterRestore(older, admin);
    await acceptProd("op-2");
    expect(await prodHold()).toBeNull();
  });
});
