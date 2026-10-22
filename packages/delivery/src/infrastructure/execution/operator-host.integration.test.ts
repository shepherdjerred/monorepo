import { expect, test } from "vitest";
import type { Principal } from "#shared/contract.ts";
import { useDeliveryFixture } from "#testing/delivery-fixture.ts";
import { publishVerifiedSet } from "#testing/published-set.ts";
import { testExecutor, testOperator } from "#testing/seed.ts";
import { declareAcquisitions, registerTestService } from "#testing/services.ts";

const context = useDeliveryFixture();
/** The operator tool's credential (X13): an attestor that never executes. */
const operatorTool: Principal = {
  id: "operator-tool",
  kind: "machine",
  scopes: ["read", "attest"],
};
const components = ["image:installer", "image:kubelet"];

/**
 * cluster-nodes/liskov: a node the operator upgrades by hand (section 5,
 * X13), deployed by a standalone `operator-run` recipe with no Application.
 */
async function nodeUpgrade() {
  const db = context.cluster.database;
  await registerTestService(db, "cluster-nodes");
  await declareAcquisitions(db, "cluster-nodes", components);
  await db.pipeline.create({
    data: {
      id: "cluster-nodes/liskov/1",
      definition: {
        kind: "operator-run",
        wrapped: { kind: "host", instance: "host:liskov", components },
        stages: ["talos-upgrade", "kubernetes-upgrade"],
      },
    },
  });
  await db.configuration.create({
    data: { id: "cluster-nodes/liskov/1", content: {} },
  });
  await db.environment.create({
    data: {
      id: "cluster-nodes/liskov",
      serviceId: "cluster-nodes",
      name: "liskov",
      pipelineRevisionId: "cluster-nodes/liskov/1",
      declaredConfigurationId: "cluster-nodes/liskov/1",
    },
  });
  const { set } = await publishVerifiedSet(context, {
    serviceId: "cluster-nodes",
    pipelineNumber: 93,
    sourceRevision: "d".repeat(40),
    artifacts: components.map((component, index) => ({
      id: `cluster-nodes/${component}`,
      component,
      kind: "image" as const,
      uri: `docker.io/siderolabs/${component.slice("image:".length)}`,
      version: "v1.14.2",
      digest: `sha256:${String(index + 1).repeat(64)}`,
    })),
  });
  const deployment = await context.delivery.createDeployment(
    {
      requestId: crypto.randomUUID(),
      environmentId: "cluster-nodes/liskov",
      versionSetRevisionId: set.id,
      expectedGeneration: 0,
      kind: "operator-run",
    },
    testOperator,
  );
  await context.delivery.claim(deployment.id, testExecutor);
  return deployment;
}

test("a standalone operator-run recipe locks only its host and settles each stage by attestation", async () => {
  const deployment = await nodeUpgrade();
  expect(deployment.kind).toBe("operator-run");
  expect(
    await context.cluster.database.targetLock.findMany({
      where: { deploymentId: deployment.id },
      select: { instance: true },
    }),
  ).toEqual([{ instance: "host:liskov" }]);
  for (const stage of ["talos-upgrade", "kubernetes-upgrade"])
    await context.delivery.attestStage(
      deployment.id,
      {
        stage,
        evidence: [
          {
            kind: "attestation",
            operationId: `${stage}/liskov`,
            summary: `${stage} log on liskov at the frozen installer and kubelet`,
          },
        ],
      },
      operatorTool,
    );
  const detail = await context.delivery.detail(deployment.id);
  expect(
    detail.stages
      .filter((stage) => stage.status === "succeeded")
      .map((stage) => stage.key)
      .toSorted(),
  ).toEqual(["attest/kubernetes-upgrade", "attest/talos-upgrade"]);
  expect(Object.keys(detail.versionSet.components).toSorted()).toEqual(
    components,
  );
});
