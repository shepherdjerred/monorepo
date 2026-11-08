import { expect, test } from "vitest";
import { useDeliveryFixture } from "#testing/delivery-fixture.ts";
import { testExecutor } from "#testing/seed.ts";
import {
  arcadeRegistration,
  publishCiRunner,
  requestOnProd,
} from "#testing/model-fixture.ts";
import { createRecoveryInspector } from "#infrastructure/recovery.ts";
import { AUTO_RECOVERY_ACTOR } from "./auto-recovery.ts";

const context = useDeliveryFixture({ registration: arcadeRegistration });

const operationId = "22222222-2222-4222-8222-222222222222";

/** arcade/prod's sync was submitted, then the executor lost track of it. */
async function syncLeftAmbiguous() {
  await publishCiRunner(context.delivery);
  const deployment = await requestOnProd(context, "deploy");
  await context.delivery.claim(deployment.id, testExecutor);
  const requestId = crypto.randomUUID();
  await context.delivery.stage(
    deployment.id,
    {
      // arcade/prod runs the v1 argocd pipeline, whose sync stage is
      // `reconcile`; a model recipe records `step-sync`.
      key: "reconcile",
      status: "running",
      operationId: requestId,
      message: "Submitted the exact owned sync",
      evidence: [],
    },
    testExecutor,
  );
  await context.delivery.finish(
    deployment.id,
    {
      status: "failed",
      message: "External operation may still be active",
      recoveryRequired: true,
      evidence: [],
    },
    testExecutor,
  );
  return { deploymentId: deployment.id, requestId };
}

/** The arcade Application as the API's own reader sees it. */
function application(requestId: string, phase: string) {
  return {
    metadata: {
      name: "arcade",
      resourceVersion: "12345",
      annotations: { "delivery.shepherdjerred.com/environment": "arcade/prod" },
    },
    status: {
      operationState: {
        phase,
        finishedAt: "2026-11-07T00:00:00.000Z",
        operation: {
          info: [
            { name: "ci.sjer.red/request-id", value: requestId },
            { name: "ci.sjer.red/operation-id", value: operationId },
          ],
        },
      },
      resources: [],
    },
  };
}

test("a dispatch tick opens one intent per recovery-required deployment, once", async () => {
  const { deploymentId } = await syncLeftAmbiguous();
  const first = await context.delivery.reconcile([], testExecutor);
  expect(first.recoveryIntentsOpened).toEqual([`argo/auto-${deploymentId}`]);
  const intent = await context.cluster.database.recoveryIntent.findFirstOrThrow(
    { where: { deploymentId } },
  );
  expect(intent).toMatchObject({
    requestedBy: AUTO_RECOVERY_ACTOR.id,
    status: "pending",
  });
  // The deployment now has an intent: no second automatic attempt, even
  // after the first one ends.
  await context.cluster.database.recoveryIntent.update({
    where: { id: intent.id },
    data: { status: "failed" },
  });
  const second = await context.delivery.reconcile([], testExecutor);
  expect(second.recoveryIntentsOpened).toBeUndefined();
  expect(
    await context.cluster.database.recoveryIntent.count({
      where: { deploymentId },
    }),
  ).toBe(1);
});

test("an argo intent settles when the API's reader proves the operation finished", async () => {
  const { deploymentId, requestId } = await syncLeftAmbiguous();
  await context.delivery.reconcile([], testExecutor);
  const read = async () => application(requestId, "Succeeded");
  const settled = await context.delivery.settleAutomaticArgoIntents(
    createRecoveryInspector({ readApplication: read }),
    read,
  );
  expect(settled).toEqual([`argo/auto-${deploymentId}`]);
  const detail = await context.delivery.detail(deploymentId);
  expect(detail.deployment).toMatchObject({
    status: "failed",
    recoveryRequired: false,
  });
  expect(detail.environment.activeDeploymentId).toBeNull();
});

test.each([
  [
    "a running operation",
    (requestId: string) => application(requestId, "Running"),
  ],
  [
    "another request's operation",
    () => application(crypto.randomUUID(), "Succeeded"),
  ],
  ["a missing Application", () => null],
])("an argo intent stays pending for %s", async (_case, observe) => {
  const { deploymentId, requestId } = await syncLeftAmbiguous();
  await context.delivery.reconcile([], testExecutor);
  const read = async () => observe(requestId);
  const settled = await context.delivery.settleAutomaticArgoIntents(
    createRecoveryInspector({ readApplication: read }),
    read,
  );
  expect(settled).toEqual([]);
  expect(
    await context.cluster.database.deployment.findUniqueOrThrow({
      where: { id: deploymentId },
    }),
  ).toMatchObject({ recoveryRequired: true });
});
