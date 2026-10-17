import { afterAll, expect, test } from "vitest";
import { readFile, rm, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { nativeFileFixture } from "./test-fixture.ts";
import { prepareNativeFiles } from "./files.ts";
import { applyPreparedNative } from "./apply.ts";
import { prepareMediaRestore } from "#infrastructure/recovery.ts";
import { grantTestExclusionProofs } from "#testing/exclusion.ts";
import { createNativeRecoveryObserver } from "#migration/native-network/producer.ts";

const harness = automationTestHarness();
const directories: string[] = [];
afterAll(async () => {
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});
async function fixture(state: "seeding" | "removed" = "seeding") {
  const result = await nativeFileFixture(
    harness.database(),
    harness.context().cipher,
    state,
  );
  directories.push(result.file.directory);
  return result;
}
test.each(["seeding", "removed"] as const)(
  "real Media publication restores physical authority with %s torrent and keeps prior demand fenced",
  async (state) => {
    const f = await fixture(state);
    const approval = await f.review();
    await f.observe();
    const input = {
      planId: f.planId,
      operationId: z.uuid().parse(approval.operationId),
    };
    await f.activities.applyNativeRecoveryFiles(input);
    await f.activities.applyNativeRecoveryFiles(input);
    const db = harness.database();
    expect(
      await db.nativeRecoveryReceipt.count({ where: { planId: f.planId } }),
    ).toBe(1);
    expect(
      await db.libraryAsset.findUniqueOrThrow({ where: { id: f.asset.id } }),
    ).toMatchObject({
      ownershipEpoch: 1,
      version: f.asset.version + 1,
      state: "published",
      properties: f.asset.properties,
    });
    expect(
      await db.mediaIntent.findUniqueOrThrow({
        where: { mediaId: f.file.media.id },
      }),
    ).toMatchObject({ automationEpoch: 0 });
    expect(
      await db.acquisitionAttempt.findUniqueOrThrow({
        where: { id: f.published.attempt.id },
      }),
    ).toMatchObject({ recoveryEpoch: 0 });
    expect(
      await db.recoveryHold.findUniqueOrThrow({
        where: { mediaId: f.file.media.id },
      }),
    ).toMatchObject({ recoveryEpoch: 1, releasedAt: null });
    expect(
      await db.subtitleAsset.findUniqueOrThrow({
        where: { id: f.subtitle.id },
      }),
    ).toMatchObject({
      ownershipEpoch: 1,
      qualityStatus: "accepted",
      videoVersion: f.asset.version + 1,
      provenance: f.subtitle.provenance,
      matchingEvidence: f.subtitle.matchingEvidence,
    });
    expect(
      await db.mediaSubtitlePolicyVersion.findUniqueOrThrow({
        where: { id: f.policy.id },
      }),
    ).toMatchObject({ recoveryEpoch: 0 });
    expect(
      await db.mediaSubtitlePolicyVersion.findFirstOrThrow({
        where: { mediaId: f.file.media.id },
        orderBy: { version: "desc" },
      }),
    ).toMatchObject({ version: 1, recoveryEpoch: 1, rules: f.policy.rules });
    expect(
      await readFile(
        path.join(
          f.file.context.roots.movies.library,
          f.published.entry.libraryPath,
        ),
        "utf8",
      ),
    ).toBe(f.published.content);
  },
);
test("same bytes at a replaced inode require another native owner review", async () => {
  const f = await fixture();
  const approval = await f.review();
  const local = path.join(
    f.file.context.roots.movies.library,
    f.published.entry.libraryPath,
  );
  await writeFile(`${local}.replacement`, await readFile(local));
  await rename(`${local}.replacement`, local);
  await f.observe();
  const proof = await prepareNativeFiles(f.context, f.planId);
  await expect(
    applyPreparedNative(
      f.context,
      { planId: f.planId, operationId: z.uuid().parse(approval.operationId) },
      proof,
    ),
  ).rejects.toThrow("physical identity changed");
  expect(
    await harness
      .database()
      .nativeRecoveryReceipt.count({ where: { planId: f.planId } }),
  ).toBe(0);
});

test("a second restore resolves prior native receipt storage and grants only the next physical epoch", async () => {
  const f = await fixture("removed");
  const first = await f.review();
  await f.observe();
  await f.activities.applyNativeRecoveryFiles({
    planId: f.planId,
    operationId: z.uuid().parse(first.operationId),
  });
  const db = harness.database();
  const recoveryId = crypto.randomUUID();
  await prepareMediaRestore(db, {
    recoveryId,
    expectedEpoch: 1,
    reason: "Second synthetic restore",
  });
  const proofs = await grantTestExclusionProofs(db, f.prior.actor.id);
  for (const proof of proofs) {
    const roots =
      f.context.files.roots[
        proof.libraryRoot === "/data/movies" ? "movies" : "tv"
      ];
    await writeFile(
      path.join(roots.library, ".plexignore"),
      proof.rootMarkerAfter,
    );
    await writeFile(
      path.join(roots.control, ".plexignore"),
      proof.controlMarkerAfter,
    );
  }
  const restore = await db.operation.findUniqueOrThrow({
    where: { idempotencyKey: `restore-observe:${recoveryId}` },
  });
  const runtime = await db.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  const command = await f.service.prepare(f.prior.actor, crypto.randomUUID(), {
    restoreOperationId: restore.id,
    recoveryEpoch: 2,
    runtimeVersion: runtime.version,
    activation: "activate",
    assetIds: [f.asset.id],
  });
  const planId = z.uuid().parse(command.nativeRecoveryId);
  await createNativeRecoveryObserver(f.prior.context)(planId);
  await f.activities.prepareNativeRecoveryFiles({
    planId,
    operationId: z.uuid().parse(command.operationId),
  });
  const reviewed = await f.service.detail(f.prior.actor, planId);
  expect(
    reviewed.scope.storageRoots.every((root) => root.receipt.kind === "native"),
  ).toBe(true);
  const approval = await f.service.apply(
    f.prior.actor,
    crypto.randomUUID(),
    planId,
    {
      expectedVersion: reviewed.version,
      planHash: z.string().parse(reviewed.planHash),
      recoveryEpoch: 2,
      runtimeVersion: runtime.version,
      acknowledgePhysicalOwnershipOnly: true,
      acknowledgeRecoveryHolds: true,
      acknowledgeSubtitlePolicies: true,
    },
  );
  await createNativeRecoveryObserver(f.prior.context)(planId);
  await f.activities.applyNativeRecoveryFiles({
    planId,
    operationId: z.uuid().parse(approval.operationId),
  });
  expect(
    await db.libraryAsset.findUniqueOrThrow({ where: { id: f.asset.id } }),
  ).toMatchObject({ ownershipEpoch: 2, version: f.asset.version + 2 });
  expect(
    await db.subtitleAsset.findUniqueOrThrow({ where: { id: f.subtitle.id } }),
  ).toMatchObject({ ownershipEpoch: 2, qualityStatus: "accepted" });
  expect(
    await db.mediaIntent.findUniqueOrThrow({
      where: { mediaId: f.file.media.id },
    }),
  ).toMatchObject({ automationEpoch: 0 });
});
