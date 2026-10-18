import { beforeEach, expect, test } from "vitest";
import { useDeliveryFixture } from "#testing/delivery-fixture.ts";
import { staticRootFixture } from "#testing/static-root-fixture.ts";
import { testExecutor } from "#testing/seed.ts";
const context = useDeliveryFixture();
let fixture: Awaited<ReturnType<typeof staticRootFixture>>;
beforeEach(async () => {
  fixture = await staticRootFixture(context.cluster.database);
});

test("pending root publication prevents front-first activation and a newer accepted root may retain the same original archive", async () => {
  const selected = await fixture.publishSite(11);
  await fixture.publishRoot(1001, selected.artifactId);
  const deployment = await fixture.siteIntent(selected.versionId);
  await expect(
    fixture.delivery.claim(deployment.id, testExecutor),
  ).rejects.toThrow("exact original site archive");
  const newer = await fixture.publishRoot(1002, selected.artifactId);
  await fixture.delivery.qualify(newer.buildId, "verified", testExecutor);
  const root = await fixture.acceptRoot(newer.buildId);
  const claimed = await fixture.delivery.claim(deployment.id, testExecutor);
  expect(
    claimed.evidence.some(
      (item) =>
        item.operationId === root.id &&
        item.summary.includes(selected.artifactId),
    ),
  ).toBe(true);
  expect(root.platformSnapshot?.kind).toBe("root-release");
  if (root.platformSnapshot?.kind !== "root-release")
    throw new Error("Expected root snapshot");
  expect(root.platformSnapshot.siteArtifacts[fixture.environmentId]).toBe(
    selected.artifactId,
  );
});
test("site-only sources use current infrastructure and explicit rollback preserves genuine earlier root history", async () => {
  const selected = await fixture.publishSite(12),
    deployment = await fixture.siteIntent(selected.versionId);
  await fixture.delivery.claim(deployment.id, testExecutor);
  await fixture.acceptSite(deployment);
  const newer = await fixture.publishRoot(1003, selected.artifactId);
  await fixture.delivery.qualify(newer.buildId, "verified", testExecutor);
  await fixture.acceptRoot(newer.buildId);
  const rollback = await fixture.siteIntent(
    fixture.baseline.versionId,
    "rollback",
  );
  const claimed = await fixture.delivery.claim(rollback.id, testExecutor);
  const rootProof = claimed.evidence.find((item) =>
    item.id.includes("/root-prerequisite/"),
  );
  expect(rootProof?.operationId).toBe(fixture.root.id);
  expect(rootProof?.summary).toContain("rollback-history");
});
test("root and site effects serialize without changing artifact selections", async () => {
  const selected = await fixture.publishSite(13),
    deployment = await fixture.siteIntent(selected.versionId);
  await fixture.delivery.claim(deployment.id, testExecutor);
  const root = await fixture.rootIntent(
    fixture.root.platformSnapshot!.source.id,
  );
  await expect(fixture.delivery.claim(root.id, testExecutor)).rejects.toThrow(
    "independent site effects",
  );
  await fixture.acceptSite(deployment);
  await fixture.delivery.claim(root.id, testExecutor);
  const next = await fixture.siteIntent(fixture.baseline.versionId, "rollback");
  await expect(fixture.delivery.claim(next.id, testExecutor)).rejects.toThrow(
    "Root infrastructure",
  );
});
