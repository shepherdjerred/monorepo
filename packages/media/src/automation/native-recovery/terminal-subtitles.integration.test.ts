import { afterAll, expect, test } from "vitest";
import { rm, writeFile } from "node:fs/promises";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { nativeFileFixture } from "./test-fixture.ts";
import { settleReplacedRollback } from "./terminal-subtitle-test-support.ts";
import { nativeLocalPath, prepareNativeFiles } from "./files.ts";
import { applyPreparedNative } from "./apply.ts";
import path from "node:path";
import { prepareMediaRestore } from "#infrastructure/recovery.ts";
import { grantTestExclusionProofs } from "#testing/exclusion.ts";
import { preparePhysicalPublication } from "#automation/plex-binding/test-fixture.ts";

const harness = automationTestHarness();
const directories: string[] = [];
afterAll(async () => {
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});
async function fixture(cleanup = false) {
  const f = await nativeFileFixture(
    harness.database(),
    harness.context().cipher,
    "removed",
    {
      serverMachineId: "fixture-server",
      publication: preparePhysicalPublication,
      settle: settleReplacedRollback(
        harness.database(),
        harness.context().cipher,
        cleanup,
      ),
    },
  );
  directories.push(f.file.directory);
  return f;
}

test.each([false, true])(
  "actual rollback then validated replacement permits native restoration without adopting its archive (cleaned=%s)",
  async (cleanup) => {
    const f = await fixture(cleanup);
    const db = harness.database();
    const row = await db.subtitleReplacement.findFirstOrThrow({
      where: { assetId: f.asset.id },
      include: { receipt: true },
    });
    const historical = await db.subtitleAsset.findUniqueOrThrow({
      where: { id: row.oldSubtitleId },
    });
    const approval = await f.review();
    await f.observe();
    await f.activities.applyNativeRecoveryFiles({
      planId: f.planId,
      operationId: z.uuid().parse(approval.operationId),
    });
    expect(
      await db.subtitleAsset.findUniqueOrThrow({
        where: { id: row.oldSubtitleId },
      }),
    ).toEqual(historical);
    expect(
      await db.subtitleAsset.findUniqueOrThrow({
        where: { id: row.candidateSubtitleId },
      }),
    ).toMatchObject({
      state: "installed",
      qualityStatus: "accepted",
      ownershipEpoch: 1,
    });
    expect(
      await db.subtitleReplacement.findUniqueOrThrow({
        where: { id: row.id },
        include: { receipt: true },
      }),
    ).toEqual(row);
  },
);

test("a replaced rollback subtitle archive mutated after proof prevents native authority", async () => {
  const f = await fixture();
  const db = harness.database();
  const approval = await f.review();
  await f.observe();
  const prepared = await prepareNativeFiles(f.context, {
    planId: f.planId,
    operationId: z.uuid().parse(approval.operationId),
  });
  const replacement = await db.subtitleReplacement.findFirstOrThrow({
    where: { assetId: f.asset.id },
  });
  const old = await db.subtitleAsset.findUniqueOrThrow({
    where: { id: replacement.oldSubtitleId },
  });
  await writeFile(
    nativeLocalPath(f.context, z.string().parse(old.path)),
    "changed retained caption bytes",
  );
  await expect(
    applyPreparedNative(
      f.context,
      { planId: f.planId, operationId: z.uuid().parse(approval.operationId) },
      prepared,
    ),
  ).rejects.toThrow("Media file identity changed after verification");
  expect(
    await db.nativeRecoveryReceipt.count({ where: { planId: f.planId } }),
  ).toBe(0);
  expect(
    await db.subtitleAsset.findUniqueOrThrow({
      where: { id: replacement.candidateSubtitleId },
    }),
  ).toMatchObject({ ownershipEpoch: 0 });
});

test("replacement quality and exact subtitle bindings survive another native restore", async () => {
  const f = await fixture();
  const db = harness.database();
  const first = await f.review();
  await f.observe();
  await f.activities.applyNativeRecoveryFiles({
    planId: f.planId,
    operationId: z.uuid().parse(first.operationId),
  });
  const replacement = await db.subtitleReplacement.findFirstOrThrow({
    where: { assetId: f.asset.id },
  });
  const firstSubtitle = await db.subtitleAsset.findUniqueOrThrow({
    where: { id: replacement.candidateSubtitleId },
  });
  const archive = await db.subtitleAsset.findUniqueOrThrow({
    where: { id: replacement.oldSubtitleId },
  });
  const recoveryId = crypto.randomUUID();
  await prepareMediaRestore(db, {
    recoveryId,
    expectedEpoch: 1,
    reason: "Repeated restore after exact caption replacement",
  });
  for (const proof of await grantTestExclusionProofs(
    db,
    f.prior.actor.id,
    z.string().parse(f.file.context.serverMachineId),
  )) {
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
  await f.observe({ planId, operationId: z.uuid().parse(command.operationId) });
  await f.activities.prepareNativeRecoveryFiles({
    planId,
    operationId: z.uuid().parse(command.operationId),
  });
  const detail = await f.service.detail(f.prior.actor, planId);
  const approval = await f.service.apply(
    f.prior.actor,
    crypto.randomUUID(),
    planId,
    {
      expectedVersion: detail.version,
      planHash: z.string().parse(detail.planHash),
      recoveryEpoch: 2,
      runtimeVersion: runtime.version,
      acknowledgePhysicalOwnershipOnly: true,
      acknowledgeRecoveryHolds: true,
      acknowledgeSubtitlePolicies: true,
    },
  );
  await f.observe({
    planId,
    operationId: z.uuid().parse(approval.operationId),
  });
  await f.activities.applyNativeRecoveryFiles({
    planId,
    operationId: z.uuid().parse(approval.operationId),
  });
  expect(
    await db.subtitleAsset.findUniqueOrThrow({
      where: { id: replacement.candidateSubtitleId },
    }),
  ).toMatchObject({
    state: "installed",
    ownershipEpoch: 2,
    version: firstSubtitle.version + 1,
    videoVersion: z.int().parse(firstSubtitle.videoVersion) + 1,
    qualityStatus: firstSubtitle.qualityStatus,
    provenance: firstSubtitle.provenance,
    checksum: firstSubtitle.checksum,
  });
  expect(
    await db.subtitleAsset.findUniqueOrThrow({
      where: { id: replacement.oldSubtitleId },
    }),
  ).toEqual(archive);
  expect(
    await db.subtitleReplacement.findUniqueOrThrow({
      where: { id: replacement.id },
    }),
  ).toEqual(replacement);
});
