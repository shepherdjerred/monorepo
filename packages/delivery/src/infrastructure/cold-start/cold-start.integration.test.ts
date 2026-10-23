import { beforeEach, describe, expect, test } from "vitest";
import { useDeliveryFixture } from "#testing/delivery-fixture.ts";
import { testExecutor, testOperator } from "#testing/seed.ts";
import type { ColdStartSnapshot } from "#shared/model/cold-start-contract.ts";
import type { ApplicationReader } from "#infrastructure/kubernetes/application-reader.ts";
import {
  arcadeCompoundRecipe,
  arcadeRegistration,
  publishCiRunner,
  requestOnProd,
} from "#testing/model-fixture.ts";
import { bootstrapChain } from "./snapshot.ts";

const context = useDeliveryFixture({ registration: arcadeRegistration });
beforeEach(async () => {
  await publishCiRunner(context.delivery);
});
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
  const deployment = await requestOnProd(context, "deploy");
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

/**
 * arcade/prod's accepted deployment as a compound recipe of two
 * Applications, each synced by its own sub-recipe stage (`subN-step-sync`).
 */
async function compoundAcceptance() {
  const accepted = await acceptProd("op-1");
  const db = context.cluster.database;
  await db.pipeline.create({
    data: {
      id: "arcade/5",
      definition: arcadeCompoundRecipe(),
    },
  });
  await db.deployment.update({
    where: { id: accepted.id },
    data: { pipelineRevisionId: "arcade/5" },
  });
  for (const [index, operationId] of ["op-a", "op-b"].entries())
    await db.stage.create({
      data: {
        id: `${accepted.id}/sub${String(index + 1)}`,
        deploymentId: accepted.id,
        key: `sub${String(index + 1)}-step-sync`,
        status: "succeeded",
        operationId,
        message: "Exact sync completed",
      },
    });
  return accepted;
}

async function prodHold() {
  const env = await context.cluster.database.environment.findUniqueOrThrow({
    where: { id: "arcade/prod" },
  });
  return env.restoreHold;
}

const CATALOG_REVISION = `sha256:${"c".repeat(64)}`;

/** The reconcile that names the catalog revision a snapshot is written under. */
async function reconciled() {
  await context.cluster.database.audit.create({
    data: {
      id: "catalog-reconciled",
      actor: testOperator.id,
      action: "catalog.reconciled",
      entityId: CATALOG_REVISION,
      requestId: "catalog-reconciled",
      metadata: {},
    },
  });
}

function reader(requestId: string): ApplicationReader {
  return async () => application(requestId);
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
    await expect(acceptProd("op-unreconciled")).resolves.toBeDefined();
    const unreconciled =
      await context.cluster.database.environment.findUniqueOrThrow({
        where: { id: "arcade/prod" },
      });
    await expect(
      context.delivery.coldStartRequirement(
        unreconciled.acceptedDeploymentId ?? "",
      ),
    ).rejects.toThrow(/No catalog was reconciled/u);
    await reconciled();
    const accepted = await acceptProd("op-1");
    const requirement = await context.delivery.coldStartRequirement(
      accepted.id,
    );
    if (!requirement.required) throw new Error("Expected a snapshot");
    expect(requirement.snapshot.catalogRevision).toBe(CATALOG_REVISION);
    const prod = requirement.snapshot.environments.find(
      (env) => env.environmentId === "arcade/prod",
    );
    expect(prod).toMatchObject({
      deploymentId: accepted.id,
      selection: {
        versionSetRevisionId: context.fixture.versionSet.id,
        recipeRevisionId: accepted.pipelineRevisionId,
      },
    });
    expect(Object.keys(prod?.artifacts ?? {})).not.toHaveLength(0);
    // The fingerprint covers the record, not the clock.
    const again = await context.delivery.coldStartRequirement(accepted.id);
    if (!again.required) throw new Error("Expected a snapshot");
    expect(again.fingerprint).toBe(requirement.fingerprint);
    await context.delivery.recordColdStartReceipt(
      accepted.id,
      {
        fingerprint: requirement.fingerprint,
        uri: "s3://homelab/delivery-cold-start/latest.json",
        writtenAt: new Date().toISOString(),
      },
      testExecutor,
    );
    const backups = await context.cluster.database.evidence.findMany({
      where: { deploymentId: accepted.id, kind: "backup" },
    });
    expect(backups).toHaveLength(1);
  });

  test("snapshots built at once take distinct, ordered microsecond write times (X7)", async () => {
    await chainFixture();
    await reconciled();
    const accepted = await acceptProd("op-concurrent");
    const requirements = await Promise.all(
      Array.from({ length: 6 }, async () =>
        context.delivery.coldStartRequirement(accepted.id),
      ),
    );
    const writtenAt = requirements.map((requirement) => {
      if (!requirement.required) throw new Error("Expected a snapshot");
      return requirement.snapshot.writtenAt;
    });
    for (const at of writtenAt)
      expect(at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u);
    // Built one at a time under one lock, no two share a write time.
    expect(new Set(writtenAt).size).toBe(writtenAt.length);
  });

  test("a restore holds each mismatched environment until an operator or an acceptance settles it", async () => {
    await chainFixture();
    await reconciled();
    const accepted = await acceptProd("op-1");
    const requirement = await context.delivery.coldStartRequirement(
      accepted.id,
    );
    if (!requirement.required) throw new Error("Expected a snapshot");
    const snapshot = requirement.snapshot;
    const matching = await context.delivery.reconcileAfterRestore(
      { requestId: "restore-1" },
      admin,
      { readSnapshot: async () => snapshot, readApplication: reader("op-1") },
    );
    expect(matching.environments.every((env) => env.status === "match")).toBe(
      true,
    );
    const prodMatch = matching.environments.find(
      (env) => env.id === "arcade/prod",
    );
    expect(prodMatch?.live).toEqual(prodMatch?.record);
    expect(prodMatch?.snapshot).toEqual(prodMatch?.record);

    // A live target another request synced holds even when the snapshot agrees.
    const drifted = await context.delivery.reconcileAfterRestore(
      { requestId: "restore-2" },
      admin,
      {
        readSnapshot: async () => snapshot,
        readApplication: reader("op-other"),
      },
    );
    expect(
      drifted.environments.find((env) => env.id === "arcade/prod"),
    ).toMatchObject({
      status: "held",
      live: null,
      reason: expect.stringMatching(/live target/u),
    });
    await context.delivery.settleRestoreHold(
      "arcade/prod",
      {
        reason: "Inspected the live Application against the record",
        evidence: "argocd app get arcade shows the accepted revision",
      },
      admin,
    );

    const older: ColdStartSnapshot = {
      ...snapshot,
      environments: snapshot.environments.filter(
        (env) => env.environmentId !== "arcade/prod",
      ),
    };
    const result = await context.delivery.reconcileAfterRestore(
      { requestId: "restore-3" },
      admin,
      { readSnapshot: async () => older, readApplication: reader("op-1") },
    );
    expect(
      result.environments.find((env) => env.id === "arcade/prod"),
    ).toMatchObject({ status: "held", snapshot: null });
    const held = await context.cluster.database.environment.findUniqueOrThrow({
      where: { id: "arcade/prod" },
    });
    expect(held.restoreHold).toMatchObject({
      catalogRevision: CATALOG_REVISION,
    });
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
    await context.delivery.reconcileAfterRestore(
      { requestId: "restore-4" },
      admin,
      { readSnapshot: async () => older },
    );
    expect(await prodHold()).not.toBeNull();
    await acceptProd("op-2");
    expect(await prodHold()).toBeNull();
  });

  test("a corrupt stored snapshot fails the restore check loudly", async () => {
    await expect(
      context.delivery.reconcileAfterRestore(
        { requestId: "restore-5" },
        admin,
        {
          readSnapshot: async () => ({ environments: [] }),
        },
      ),
    ).rejects.toThrow();
  });
});

describe("cold start of compound recipes (section 6)", () => {
  test("a compound recipe is checked through every Application it deploys", async () => {
    await chainFixture();
    await reconciled();
    const accepted = await compoundAcceptance();
    const requirement = await context.delivery.coldStartRequirement(
      accepted.id,
    );
    if (!requirement.required) throw new Error("Expected a snapshot");
    const restore = async (
      requestId: string,
      live: Record<string, string | null>,
    ) => {
      const result = await context.delivery.reconcileAfterRestore(
        { requestId },
        admin,
        {
          readSnapshot: async () => requirement.snapshot,
          readApplication: async (name) => {
            const request = live[name];
            if (request === undefined)
              throw new Error(`Unexpected Application ${name}`);
            return request === null ? null : application(request);
          },
        },
      );
      return result.environments.find((env) => env.id === "arcade/prod");
    };
    const matching = await restore("restore-compound-1", {
      arcade: "op-a",
      "arcade-server": "op-b",
    });
    expect(matching).toMatchObject({ status: "match" });
    expect(matching?.live).toEqual(matching?.record);
    // A missing second Application holds the environment.
    expect(
      await restore("restore-compound-2", {
        arcade: "op-a",
        "arcade-server": null,
      }),
    ).toMatchObject({
      status: "held",
      reason: "The live target does not exist",
    });
    await context.delivery.settleRestoreHold(
      "arcade/prod",
      {
        reason: "Recreated the server Application",
        evidence: "argocd app get",
      },
      admin,
    );
    // So does a second Application another request synced last.
    expect(
      await restore("restore-compound-3", {
        arcade: "op-a",
        "arcade-server": "op-other",
      }),
    ).toMatchObject({
      status: "held",
      live: null,
      reason: expect.stringMatching(/another selection/u),
    });
  });
});
