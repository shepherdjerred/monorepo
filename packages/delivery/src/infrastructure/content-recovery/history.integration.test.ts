import { expect, test } from "vitest";
import { forumBundlePolicy } from "@shepherdjerred/ops-model/forum-bundle-policy.ts";
import { useDeliveryFixture } from "#testing/delivery-fixture.ts";
import {
  contentBarrier,
  contentNativeReceipt,
  contentObservation,
} from "#testing/content-recovery-fixture.ts";
import { testExecutor, testOperator } from "#testing/seed.ts";
import { seedBrowserForum } from "#testing/browser-forum.ts";
import { seedContentRecovery } from "#testing/browser-content-recovery.ts";
import { fingerprint } from "#infrastructure/delivery-records.ts";
import { freezeRecoveredForumRuntime } from "#infrastructure/forum/recovered-runtime.ts";

const scope = useDeliveryFixture({
  forumPolicyReader: () => Promise.resolve(forumBundlePolicy),
});

test("Forum settlement covers more than forty historical native Jobs and only exempts the exact current repair child before effects", async () => {
  const deployment = await seedBrowserForum(scope.delivery);
  await seedContentRecovery(scope.delivery, deployment.id);
  let id = "browser/content/pending";
  for (let attempt = 0; attempt < 2; attempt++) {
    for (let job = 0; job < 20; job++) {
      const native = contentNativeReceipt(id, "repair");
      native.receipt.name += `-${String(job)}`;
      await scope.delivery.recordContentRecoveryNative(
        id,
        native,
        testExecutor,
      );
    }
    await scope.delivery.failContentRecovery(
      id,
      "Before producer suspension all native attempts were inspected as terminal",
      testExecutor,
    );
    const detail = await scope.delivery.detail(deployment.id);
    id = `forum/history/${String(attempt)}`;
    await scope.delivery.requestContentRecovery(
      deployment.id,
      {
        requestId: id,
        expectedEnvironmentGeneration: detail.environment.generation,
        reason:
          "Inspect all original and historical native executors before the same frozen Forum repair",
      },
      testOperator,
    );
  }
  const active = contentNativeReceipt(id, "repair");
  await scope.delivery.recordContentRecoveryNative(id, active, testExecutor);
  await scope.delivery.recordContentRecoveryBarrier(
    id,
    contentBarrier,
    testExecutor,
  );
  const context = await scope.delivery.contentRecovery(id, testExecutor);
  const observed = contentObservation(context);
  expect(observed.nativeJobs).toHaveLength(42);
  const exceptCurrent = observed.nativeJobs.filter(
    (job) => job.uid !== active.receipt.uid,
  );
  await scope.delivery.admitContentRecoveryRepair(
    id,
    {
      ...observed,
      nativeJobs: exceptCurrent,
      activeRepairJobUIDs: [active.receipt.uid],
    },
    testExecutor,
  );
  const proof = {
    ...observed,
    settlement: {
      state: "desired" as const,
      fingerprint: context.expectedSettlements.desired,
    },
    proofSummary:
      "Independent Forum runtime and full original native history match the frozen candidate after all children stopped",
  };
  for (const nativeJobs of [exceptCurrent, observed.nativeJobs.slice(1)])
    await expect(
      scope.delivery.completeContentRecovery(
        id,
        { ...proof, nativeJobs },
        testExecutor,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  const settled = await scope.delivery.completeContentRecovery(
    id,
    proof,
    testExecutor,
  );
  expect(settled.status).toBe("succeeded");
  const original = await scope.delivery.detail(deployment.id);
  expect(original.deployment.status).toBe("failed");
  expect(original.environment.acceptedVersionSetRevisionId).toBeNull();
  await scope.delivery.restoredContentRecovery(
    id,
    {
      expectedEnvironmentGeneration: original.environment.generation,
      snapshotFingerprint: context.intent.snapshotFingerprint,
      observedAt: new Date().toISOString(),
      journalFingerprint: fingerprint(contentBarrier),
      deploymentUID: contentBarrier.deploymentUID,
      templateFingerprint: contentBarrier.templateFingerprint,
      replicas: 1,
      readyPodUIDs: ["restored-dispatch-pod"],
    },
    testExecutor,
  );
  const next = await scope.delivery.createDeployment(
    {
      requestId: "forum/after-desired-recovery",
      environmentId: original.environment.id,
      expectedGeneration: original.environment.generation,
      versionSetRevisionId: original.versionSet.id,
      kind: "deploy",
    },
    testOperator,
  );
  const detail = await scope.delivery.detail(next.id);
  expect(detail.deployment.forumBaselineSnapshot).toBeNull();
  expect(detail.previousAcceptedVersionSet).toBeNull();
  expect(detail.forumRecoveredRuntime).toEqual({
    recoveryIntentId: id,
    deploymentId: original.deployment.id,
    image: original.versionSet.components["image:storm-forum"],
    bundle: original.versionSet.components["archive:forum-bundle"],
    xenforoVersion: original.configuration.content["forum.xenforoVersion"],
  });
  expect(
    await scope.cluster.database.$transaction((tx) =>
      freezeRecoveredForumRuntime(tx, {
        environmentId: original.environment.id,
        pipeline: original.pipeline,
        acceptedAt: new Date(Date.now() + 1000),
      }),
    ),
  ).toBeNull();
});
