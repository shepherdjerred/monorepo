import { beforeEach, expect, test } from "vitest";
import { useDeliveryFixture } from "#testing/delivery-fixture.ts";
import { testExecutor, testOperator, testPublisher } from "#testing/seed.ts";
import { DeliveryError } from "#domain/error.ts";
import {
  seedForum,
  baselineProof,
  qualifyForumReleaseFixture,
} from "./fixtures.ts";
import { freezeForumBaseline } from "./freezer.ts";
import { forumBundlePolicy } from "@shepherdjerred/ops-model/forum-bundle-policy.ts";
import { deliveryOperationId } from "#shared/operation-id.ts";

let sourceUnavailable = false;
const fixture = useDeliveryFixture({
  forumPolicyReader: () =>
    sourceUnavailable
      ? Promise.reject(new Error("Source unavailable"))
      : Promise.resolve(forumBundlePolicy),
});
beforeEach(async () => {
  sourceUnavailable = false;
  await seedForum(fixture.delivery);
});

test("first upgrade retains original baseline, rechecks native ownership before selection and replays without source availability", async () => {
  const { delivery } = fixture,
    context = await requested();
  await delivery.completeForumBaseline(
    context.intent.id,
    {
      expectedEnvironmentGeneration: 0,
      snapshotFingerprint: context.intent.snapshotFingerprint,
    },
    testExecutor,
    (input) => Promise.resolve(baselineProof(input)),
  );
  const selected = await qualifyForumReleaseFixture(delivery, "forum/full-ci");
  const input = {
    requestId: "forum/first-upgrade",
    environmentId: "storm-forum/prod",
    versionSetRevisionId: selected.id,
    expectedGeneration: 1,
    kind: "deploy" as const,
  };
  const deployment = await delivery.createDeployment(input, testOperator);
  expect(deployment.forumBaselineSnapshot?.intentId).toBe(context.intent.id);
  sourceUnavailable = true;
  await expect(
    delivery.createDeployment(input, testOperator),
  ).resolves.toMatchObject({ id: deployment.id });
  await expect(
    delivery.createDeployment(input, { ...testOperator, id: "other-operator" }),
  ).rejects.toThrow(/Request ID/u);
  sourceUnavailable = false;
  await delivery.claim(deployment.id, testExecutor);
  await expect(
    delivery.verifyForumDeploymentBaseline(
      deployment.id,
      testExecutor,
      (current) => Promise.resolve(baselineProof(current)),
    ),
  ).resolves.toEqual({ verified: true });
  await expect(
    delivery.verifyForumDeploymentBaseline(
      deployment.id,
      testExecutor,
      (current) =>
        Promise.resolve({
          ...baselineProof(current),
          application: {
            ...baselineProof(current).application,
            sourceFingerprint: "e".repeat(64),
          },
        }),
    ),
  ).rejects.toThrow(/changed since baseline/u);
  await delivery.stage(
    deployment.id,
    {
      key: "reconcile",
      status: "running",
      operationId: deliveryOperationId(deployment.id),
      message: "Candidate reconciliation intent recorded",
      evidence: [],
    },
    testExecutor,
  );
  await expect(
    delivery.verifyForumDeploymentBaseline(
      deployment.id,
      testExecutor,
      (current) => Promise.resolve(baselineProof(current)),
    ),
  ).rejects.toThrow(/before candidate selection/u);
});
async function requested() {
  const intent = await fixture.delivery.requestForumBaseline(
    {
      requestId: crypto.randomUUID(),
      environmentId: "storm-forum/prod",
      expectedEnvironmentGeneration: 0,
      imageArtifactId: "forum-image",
      bundleArtifactId: "forum-bundle",
      reason:
        "Independently observe the actual original installed forum before upgrade",
    },
    testOperator,
  );
  return fixture.delivery.forumBaseline(intent.id, testExecutor);
}

test("license publication remains outside CI, fair pending queue, terminal invalid bytes and original producer identity", async () => {
  const { delivery } = fixture,
    database = delivery.database;
  const build = await database.build.findFirstOrThrow({
    where: { sourceKind: "licensed-bundle" },
  });
  expect(build.repositoryId).toBeNull();
  expect(build.pipelineNumber).toBeNull();
  expect(build.ciUrl).toBeNull();
  expect(await delivery.versions("storm-forum")).toHaveLength(1);
  await database.build.update({
    where: { id: build.id },
    data: { status: "pending" },
  });
  const pending = await delivery.pendingForumBundles(testExecutor);
  expect(pending.builds).toEqual([{ id: build.id }]);
  await expect(
    delivery.qualifyForumBundle(build.id, testPublisher, () =>
      Promise.resolve(),
    ),
  ).rejects.toThrow(/execute/u);
  const failed = await delivery.qualifyForumBundle(build.id, testExecutor, () =>
    Promise.reject(new DeliveryError("INVALID", "Independent CRC failure")),
  );
  expect(failed.status).toBe("failed");
  await delivery.qualifyForumBundle(build.id, testExecutor, () => {
    throw new Error("Terminal result must not run verifier again");
  });
  const terminal = await database.build.findUniqueOrThrow({
    where: { id: build.id },
  });
  expect(terminal.qualificationReason).toBe("Independent CRC failure");
});

test("a fresh native baseline accepts only original proof and never invents an accepted version set", async () => {
  const { delivery } = fixture,
    database = delivery.database,
    context = await requested();
  const input = {
    expectedEnvironmentGeneration: 0,
    snapshotFingerprint: context.intent.snapshotFingerprint,
  };
  const result = await delivery.completeForumBaseline(
    context.intent.id,
    input,
    testExecutor,
    async (observed) => baselineProof(observed),
  );
  expect(result.status).toBe("succeeded");
  const environment = await database.environment.findUniqueOrThrow({
    where: { id: "storm-forum/prod" },
  });
  expect(environment.generation).toBe(1);
  expect(environment.acceptedVersionSetRevisionId).toBeNull();
  expect(environment.acceptedForumBaselineIntentId).toBe(result.id);
  await expect(
    delivery.completeForumBaseline(
      context.intent.id,
      input,
      testExecutor,
      () => {
        throw new Error("Immutable success must not inspect twice");
      },
    ),
  ).resolves.toMatchObject({ status: "succeeded" });
  const snapshot = await database.$transaction(async (tx) => {
    const detail = await delivery.forumBaseline(result.id, testExecutor);
    return freezeForumBaseline(tx, detail);
  });
  expect(snapshot?.image.id).toBe("forum-image");
  expect(snapshot?.bundle.id).toBe("forum-bundle");
});

test("baseline is admin-only and rejects missing provenance, stale observations and environment races", async () => {
  const { delivery } = fixture,
    database = delivery.database,
    context = await requested(),
    input = {
      expectedEnvironmentGeneration: 0,
      snapshotFingerprint: context.intent.snapshotFingerprint,
    };
  await expect(
    delivery.requestForumBaseline(
      {
        requestId: crypto.randomUUID(),
        environmentId: "storm-forum/prod",
        expectedEnvironmentGeneration: 0,
        imageArtifactId: "forum-image",
        bundleArtifactId: "forum-bundle",
        reason: "This machine cannot request an original baseline",
      },
      testPublisher,
    ),
  ).rejects.toThrow(/admin/u);
  await expect(
    delivery.completeForumBaseline(
      context.intent.id,
      input,
      testExecutor,
      async () => ({
        ...baselineProof(context),
        observedAt: new Date(Date.now() - 60_000).toISOString(),
      }),
    ),
  ).rejects.toThrow(/freshness/u);
  await expect(
    delivery.completeForumBaseline(
      context.intent.id,
      input,
      testExecutor,
      async () => ({
        ...baselineProof(context),
        runtime: {
          ...baselineProof(context).runtime,
          bundleSha256: "e".repeat(64),
        },
      }),
    ),
  ).rejects.toThrow(/artifacts/u);
  await expect(
    delivery.completeForumBaseline(
      context.intent.id,
      input,
      testExecutor,
      async () => {
        await database.environment.update({
          where: { id: context.environment.id },
          data: { generation: { increment: 1 } },
        });
        return baselineProof(context);
      },
    ),
  ).rejects.toThrow(/generation/u);
  const retained = await database.forumBaselineIntent.findUniqueOrThrow({
    where: { id: context.intent.id },
  });
  expect(retained.status).toBe("pending");
});

test("failed baseline is immutable and cannot set original provenance or deployment acceptance", async () => {
  const { delivery } = fixture,
    database = delivery.database,
    context = await requested();
  const failed = await delivery.failForumBaseline(
    context.intent.id,
    "Original runtime has no supported authenticated observer",
    testExecutor,
  );
  expect(failed.status).toBe("failed");
  await expect(
    delivery.completeForumBaseline(
      context.intent.id,
      {
        expectedEnvironmentGeneration: 0,
        snapshotFingerprint: context.intent.snapshotFingerprint,
      },
      testExecutor,
      async () => baselineProof(context),
    ),
  ).rejects.toThrow(/immutable/u);
  const row = await database.environment.findUniqueOrThrow({
    where: { id: context.environment.id },
  });
  expect(row.acceptedForumBaselineIntentId).toBeNull();
  expect(row.acceptedVersionSetRevisionId).toBeNull();
});

test("a fresh admin observation may replace stale original provenance while prior proof remains immutable and no app is accepted", async () => {
  const { delivery } = fixture,
    first = await requested();
  const original = await delivery.completeForumBaseline(
    first.intent.id,
    {
      expectedEnvironmentGeneration: 0,
      snapshotFingerprint: first.intent.snapshotFingerprint,
    },
    testExecutor,
    (current) => Promise.resolve(baselineProof(current)),
  );
  const second = await delivery.requestForumBaseline(
    {
      requestId: "forum/fresh-original",
      environmentId: "storm-forum/prod",
      expectedEnvironmentGeneration: 1,
      imageArtifactId: "forum-image",
      bundleArtifactId: "forum-bundle",
      reason:
        "Reobserve the actual original after a safe interrupted initial admission",
    },
    testOperator,
  );
  await delivery.completeForumBaseline(
    second.id,
    {
      expectedEnvironmentGeneration: 1,
      snapshotFingerprint: second.snapshotFingerprint,
    },
    testExecutor,
    (current) => Promise.resolve(baselineProof(current)),
  );
  const previous = await delivery.forumBaseline(first.intent.id, testExecutor),
    environment = await delivery.database.environment.findUniqueOrThrow({
      where: { id: first.environment.id },
    });
  expect(previous.intent.status).toBe("succeeded");
  expect(previous.intent.proof).toEqual(original.proof);
  expect(environment.acceptedForumBaselineIntentId).toBe(second.id);
  expect(environment.generation).toBe(2);
  expect(environment.acceptedVersionSetRevisionId).toBeNull();
});
