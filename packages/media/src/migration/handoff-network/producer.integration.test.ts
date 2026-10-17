import { expect, test } from "vitest";
import { automationTestHarness } from "#testing/automation.ts";
import { HandoffNetworkEvidenceSchema } from "#shared/handoff.ts";
import { createHandoffNetworkProducer } from "./producer.ts";
import { networkFixture } from "./test-fixture.ts";

const harness = automationTestHarness();
async function fixture() {
  return networkFixture(harness.database(), harness.context().cipher);
}

test("trusted observations append immutable receipts without activating or adopting files and claims", async () => {
  const { context, plan, actor } = await fixture();
  const producer = createHandoffNetworkProducer(context);
  const first = await producer(plan.id);
  const second = await producer(plan.id);
  expect(first.observationId).not.toBe(second.observationId);
  const row = await context.db.mediaHandoffObservation.findUniqueOrThrow({
    where: { id: first.observationId },
  });
  const evidence = HandoffNetworkEvidenceSchema.parse(row.evidence);
  expect(evidence.claims[0]).toMatchObject({
    userId: actor.id,
    accountId: actor.plexAccountId,
    userVersion: 0,
    mappingVersion: 0,
  });
  expect(evidence.mounts.bindings).toHaveLength(2);
  expect(evidence.plex).toHaveLength(1);
  expect(JSON.stringify(evidence)).not.toContain("synthetic-fixture-token");
  expect(
    await context.db.mediaRequest.count({ where: { userId: actor.id } }),
  ).toBe(0);
  expect(await context.db.libraryAsset.count()).toBe(0);
  expect(
    await context.db.mediaRuntimeState.findUniqueOrThrow({
      where: { id: "singleton" },
    }),
  ).toMatchObject({ mode: "observe", ownershipConfirmed: false });
  await expect(
    context.db.mediaHandoffObservation.update({
      where: { id: row.id },
      data: { evidenceHash: "a".repeat(64) },
    }),
  ).rejects.toThrow("immutable");
});

test("review revocation while external reads run prevents evidence insertion", async () => {
  const { context, plan, review } = await fixture();
  context.plex.machineIdentifier = async () => {
    await context.db.migrationBundleReview.update({
      where: { id: review.id },
      data: { status: "revoked", version: { increment: 1 } },
    });
    return "server";
  };
  await expect(
    createHandoffNetworkProducer(context)(plan.id),
  ).rejects.toMatchObject({ code: "handoff_review_changed" });
  expect(
    await context.db.mediaHandoffObservation.count({
      where: { planId: plan.id },
    }),
  ).toBe(0);
});

test("fresh account denial protects imported claims even when stored permissions allow them", async () => {
  const { context, plan } = await fixture();
  context.authentication.resolveServerAccess = () => Promise.resolve(null);
  await expect(
    createHandoffNetworkProducer(context)(plan.id),
  ).rejects.toMatchObject({ code: "handoff_claim_access_revoked" });
});

test("Plex exact path with a different TMDB identity cannot prove ownership", async () => {
  const { context, plan } = await fixture();
  const original = context.plex.metadata;
  context.plex.metadata = async (...args) => ({
    ...(await original(...args)),
    Guid: [{ id: "tmdb://999999999999" }],
  });
  await expect(
    createHandoffNetworkProducer(context)(plan.id),
  ).rejects.toMatchObject({ code: "handoff_plex_identity_unproved" });
});

test("changed requester mapping during a read invalidates the final snapshot", async () => {
  const { context, plan, actor } = await fixture();
  const original = context.authentication.resolveServerAccess;
  context.authentication.resolveServerAccess = async (token) => {
    await context.db.plexIdentityMapping.update({
      where: { userId: actor.id },
      data: { version: { increment: 1 } },
    });
    return original(token);
  };
  await expect(
    createHandoffNetworkProducer(context)(plan.id),
  ).rejects.toMatchObject({ code: "handoff_claim_changed" });
});

test("running legacy writer and changed source mount lineage protect before publication proof", async () => {
  const running = await fixture();
  running.context.observer.observe = () =>
    Promise.resolve({ ...running.quiescence, quiescent: false });
  await expect(
    createHandoffNetworkProducer(running.context)(running.plan.id),
  ).rejects.toMatchObject({ code: "handoff_legacy_writers_running" });
  const changed = await fixture();
  const original = changed.context.observer.observeMountBindings.bind(
    changed.context.observer,
  );
  changed.context.observer.observeMountBindings = async (...args) => {
    const result = await original(...args);
    const binding = result.bindings[0];
    if (!binding) throw new Error("Fixture missing mount");
    binding.source.deploymentUid = "replaced-controller";
    return result;
  };
  await expect(
    createHandoffNetworkProducer(changed.context)(changed.plan.id),
  ).rejects.toMatchObject({ code: "handoff_source_mount_changed" });
});

test("restore epoch advancement during a network observation fences its result", async () => {
  const { context, plan } = await fixture();
  context.plex.machineIdentifier = async () => {
    await context.db.mediaRuntimeState.update({
      where: { id: "singleton" },
      data: { recoveryEpoch: { increment: 1 }, version: { increment: 1 } },
    });
    return "server";
  };
  await expect(
    createHandoffNetworkProducer(context)(plan.id),
  ).rejects.toMatchObject({ code: "handoff_runtime_changed" });
  expect(
    await context.db.mediaHandoffObservation.count({
      where: { planId: plan.id },
    }),
  ).toBe(0);
});

test("expired observer evidence and managed-profile cloud tokens remain protected", async () => {
  const expired = await fixture();
  expired.context.observer.observe = () =>
    Promise.resolve({
      ...expired.quiescence,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
  await expect(
    createHandoffNetworkProducer(expired.context)(expired.plan.id),
  ).rejects.toMatchObject({ code: "handoff_observation_expired_or_changed" });
  const managed = await fixture();
  await managed.context.db.plexIdentityMapping.update({
    where: { userId: managed.actor.id },
    data: { kind: "managed", homeUserId: "managed-fixture" },
  });
  await expect(
    createHandoffNetworkProducer(managed.context)(managed.plan.id),
  ).rejects.toMatchObject({ code: "handoff_claim_identity_unproved" });
});
