import { afterAll, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { nativeFileFixture } from "#automation/native-recovery/test-fixture.ts";
import { settleTerminalPublication } from "#automation/native-recovery/terminal-test-support.ts";
import { videoSubtitleWhere } from "#automation/files/subtitle-lifecycle/ownership.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { snapshotArchiveFile } from "./file-snapshot.ts";
import { assertPriorNativeBinding } from "./prior-binding.ts";
import { recordVerifiedPublication } from "#automation/reconciliation/upgrade-cleanup.ts";
import { preparePhysicalPublication } from "#automation/plex-binding/test-fixture.ts";

const harness = automationTestHarness();
const directories: string[] = [];
afterAll(async () => {
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});
test.each([1, 2] as const)(
  "unchanged original published v%s receipt supplies exact raw grant and separate physical identity",
  async (version) => {
    const db = harness.database();
    const f = await nativeFileFixture(
      db,
      harness.cipher,
      "removed",
      version === 2
        ? {
            serverMachineId: "fixture-server",
            publication: preparePhysicalPublication,
            settle: settleTerminalPublication(db, "purged", {
              context: harness.context(),
            }),
          }
        : {
            settle: async (_file, published) => {
              await db.$transaction((tx) =>
                recordVerifiedPublication(tx, [published.entry.assetId], 0),
              );
              return published;
            },
          },
    );
    directories.push(f.file.directory);
    const approval = await f.review();
    await f.observe();
    await f.activities.applyNativeRecoveryFiles({
      planId: f.planId,
      operationId: z.uuid().parse(approval.operationId),
    });
    const receipt = await db.nativeRecoveryReceipt.findUniqueOrThrow({
      where: { planId: f.planId },
      include: { plan: true },
    });
    expect(
      z.object({ schemaVersion: z.number() }).parse(receipt.plan.scope)
        .schemaVersion,
    ).toBe(version);
    const before = JSON.stringify(receipt);
    const asset = await db.libraryAsset.findUniqueOrThrow({
      where: { id: f.asset.id },
      include: {
        coverage: { orderBy: { mediaId: "asc" }, include: { media: true } },
        subtitles: { where: videoSubtitleWhere, orderBy: { id: "asc" } },
      },
    });
    const file = await db.$transaction((tx) =>
      snapshotArchiveFile(tx, asset, {
        cleanups: [],
        cleanupIds: [],
        epoch: receipt.recoveryEpoch,
      }),
    );
    expect(file.authority.kind).toBe("prior_native_binding");
    if (file.authority.kind !== "prior_native_binding")
      throw new Error("Expected actual published binding");
    const rawBinding = z
      .object({
        bindings: z.array(z.object({ assetId: z.uuid() }).catchall(z.json())),
      })
      .parse(receipt.selection)
      .bindings.find((item) => item.assetId === asset.id);
    expect(file.authority).toMatchObject({
      receiptLifecycle: "published",
      receiptId: receipt.id,
      planHash: receipt.planHash,
      bindingHash: snapshotHash(z.json().parse(rawBinding)),
    });
    expect(file.authority.physicalEvidenceHash).toMatch(/^[a-f0-9]{64}$/u);
    await db.$transaction((tx) =>
      assertPriorNativeBinding(
        tx,
        file,
        file.authority.kind === "prior_native_binding"
          ? file.authority
          : z.never().parse(file.authority),
      ),
    );
    expect(
      JSON.stringify(
        await db.nativeRecoveryReceipt.findUniqueOrThrow({
          where: { id: receipt.id },
          include: { plan: true },
        }),
      ),
    ).toBe(before);
    const reference = file.authority;
    await expect(
      db.$transaction((tx) =>
        assertPriorNativeBinding(
          tx,
          { ...file, assetVersion: file.assetVersion + 1 },
          reference,
        ),
      ),
    ).rejects.toThrow("reference changed");
  },
);
