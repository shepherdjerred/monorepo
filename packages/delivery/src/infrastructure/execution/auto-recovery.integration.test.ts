import { expect, test, vi } from "vitest";
import { useDeliveryFixture } from "#testing/delivery-fixture.ts";
import { testExecutor, testOperator } from "#testing/seed.ts";
import {
  arcadeRegistration,
  publishCiRunner,
  requestOnProd,
} from "#testing/model-fixture.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import { createApplicationReader } from "#infrastructure/kubernetes/application-reader.ts";
import { createRecoveryInspector } from "#infrastructure/recovery.ts";
import {
  AUTO_RECOVERY_ACTOR,
  AUTO_RECOVERY_ATTEMPTS,
} from "./auto-recovery.ts";

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

/** The deployment's pending intent fails, as a reader refusal or outage ends it. */
async function failPending(deploymentId: string, finishedAt: Date) {
  const intent = await context.cluster.database.recoveryIntent.findFirstOrThrow(
    { where: { deploymentId, status: "pending" } },
  );
  await context.cluster.database.recoveryIntent.update({
    where: { id: intent.id },
    data: { status: "failed", finishedAt },
  });
}

const sixMinutesAgo = () => new Date(Date.now() - 6 * 60_000);

/**
 * Fails the pending intent now, then ticks before and after the backoff;
 * resolves the intents each tick opened.
 */
async function ticksAroundBackoff(deploymentId: string) {
  await failPending(deploymentId, new Date());
  const early = await context.delivery.reconcile([], testExecutor);
  await context.cluster.database.recoveryIntent.updateMany({
    where: { deploymentId },
    data: { finishedAt: sixMinutesAgo() },
  });
  const later = await context.delivery.reconcile([], testExecutor);
  return {
    early: early.recoveryIntentsOpened,
    later: later.recoveryIntentsOpened,
  };
}

test("a dispatch tick opens one intent per recovery-required deployment while it is pending", async () => {
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
  const second = await context.delivery.reconcile([], testExecutor);
  expect(second.recoveryIntentsOpened).toBeUndefined();
  expect(
    await context.cluster.database.recoveryIntent.count({
      where: { deploymentId },
    }),
  ).toBe(1);
});

test("a failed automatic intent is reopened only after the backoff", async () => {
  const { deploymentId } = await syncLeftAmbiguous();
  await context.delivery.reconcile([], testExecutor);
  expect(await ticksAroundBackoff(deploymentId)).toEqual({
    early: undefined,
    later: [`argo/auto-${deploymentId}-2`],
  });
});

test("automatic recovery stops after its bounded attempts", async () => {
  const { deploymentId } = await syncLeftAmbiguous();
  const opened: string[] = [];
  for (let attempt = 1; attempt <= AUTO_RECOVERY_ATTEMPTS + 1; attempt++) {
    const tick = await context.delivery.reconcile([], testExecutor);
    opened.push(...(tick.recoveryIntentsOpened ?? []));
    if (attempt <= AUTO_RECOVERY_ATTEMPTS)
      await failPending(deploymentId, sixMinutesAgo());
  }
  expect(opened).toEqual([
    `argo/auto-${deploymentId}`,
    ...[2, 3, 4, 5].map((n) => `argo/auto-${deploymentId}-${String(n)}`),
  ]);
  const result = await context.delivery.openAutomaticRecoveryIntents();
  expect(result.skipped).toContainEqual({
    deploymentId,
    reason: `automatic recovery stopped after ${String(AUTO_RECOVERY_ATTEMPTS)} attempts`,
  });
});

test("an operator's failed intent leaves the deployment to automatic attempts after the backoff", async () => {
  const { deploymentId } = await syncLeftAmbiguous();
  const detail = await context.delivery.detail(deploymentId);
  await context.delivery.requestRecoveryIntent(
    deploymentId,
    {
      requestId: "operator-attempt",
      reason: "Operator opened the intent before the dispatch tick",
      expectedGeneration: detail.environment.generation,
    },
    testOperator,
  );
  expect(await ticksAroundBackoff(deploymentId)).toEqual({
    early: undefined,
    later: [`argo/auto-${deploymentId}`],
  });
});

test("an intent an operator opens concurrently wins, and the tick skips the deployment", async () => {
  const { deploymentId } = await syncLeftAmbiguous();
  const detail = await context.delivery.detail(deploymentId);
  const original = context.delivery.requestRecoveryIntent;
  const race = vi
    .spyOn(context.delivery, "requestRecoveryIntent")
    .mockImplementationOnce(async function (this: Delivery, ...args) {
      // The operator's request commits between the tick's read and write.
      await original.call(
        this,
        deploymentId,
        {
          requestId: "operator-race",
          reason: "Operator opened the intent during the dispatch tick",
          expectedGeneration: detail.environment.generation,
        },
        testOperator,
      );
      return original.apply(this, args);
    });
  try {
    const result = await context.delivery.openAutomaticRecoveryIntents();
    expect(result.opened).toEqual([]);
    expect(result.skipped).toEqual([
      {
        deploymentId,
        reason: "another recovery intent was opened concurrently",
      },
    ]);
  } finally {
    race.mockRestore();
  }
  expect(
    await context.cluster.database.recoveryIntent.findMany({
      where: { deploymentId },
      select: { id: true, status: true },
    }),
  ).toEqual([{ id: "argo/operator-race", status: "pending" }]);
});

test("an argo intent settles when the API's reader proves the operation finished", async () => {
  const { deploymentId, requestId } = await syncLeftAmbiguous();
  await context.delivery.reconcile([], testExecutor);
  const read = async () => application(requestId, "Succeeded");
  const settled = await context.delivery.settleAutomaticArgoIntents(
    createRecoveryInspector({ readApplication: read }),
  );
  expect(settled).toEqual([`argo/auto-${deploymentId}`]);
  const detail = await context.delivery.detail(deploymentId);
  expect(detail.deployment).toMatchObject({
    status: "failed",
    recoveryRequired: false,
  });
  expect(detail.environment.activeDeploymentId).toBeNull();
});

test("an argo intent settles with one readback per Application of a compound recipe", async () => {
  const { deploymentId } = await syncLeftAmbiguous();
  await context.delivery.reconcile([], testExecutor);
  const companion = "44444444-4444-4444-8444-444444444444";
  const settled = await context.delivery.settleAutomaticArgoIntents(
    async (_detail, input) =>
      [companion, operationId].map((identity) => ({
        kind: "reconciliation" as const,
        operationId: identity,
        summary: `Independent Application readback, operation ${identity}. ${input.reason}`,
      })),
  );
  expect(settled).toEqual([`argo/auto-${deploymentId}`]);
  const detail = await context.delivery.detail(deploymentId);
  expect(detail.deployment.recoveryRequired).toBe(false);
  expect(
    detail.evidence
      .filter((entry) => entry.kind === "reconciliation")
      .map((entry) => entry.operationId),
  ).toEqual(expect.arrayContaining([companion, operationId]));
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
  [
    "a Kubernetes API that does not answer",
    () => {
      throw Object.assign(new Error("connect"), { code: "ECONNREFUSED" });
    },
  ],
])("an argo intent stays pending for %s", async (_case, observe) => {
  const { deploymentId, requestId } = await syncLeftAmbiguous();
  await context.delivery.reconcile([], testExecutor);
  const read = createApplicationReader(async () => observe(requestId));
  const settled = await context.delivery.settleAutomaticArgoIntents(
    createRecoveryInspector({ readApplication: read }),
  );
  expect(settled).toEqual([]);
  expect(
    await context.cluster.database.deployment.findUniqueOrThrow({
      where: { id: deploymentId },
    }),
  ).toMatchObject({ recoveryRequired: true });
});
