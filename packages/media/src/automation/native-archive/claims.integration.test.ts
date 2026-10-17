import { afterAll, expect, test } from "vitest";
import { rm, readFile } from "node:fs/promises";
import { automationTestHarness } from "#testing/automation.ts";
import { nativeLocalPath } from "#automation/native-recovery/files.ts";
import { LEGACY_CLAIM_PROTECTION } from "#infrastructure/recovery/legacy-claims/protection.ts";
import { buildRecoveryClaims } from "#infrastructure/recovery/legacy-claims/projection.ts";
import { readyArchiveCleanup } from "./cleanup-test-support.ts";
import { captureArchiveClaim } from "./fixtures/late-claim.ts";

const harness = automationTestHarness();
const directories: string[] = [];
afterAll(async () => {
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});
test.each([
  { mapped: false, phase: "before" },
  { mapped: true, phase: "before" },
  { mapped: false, phase: "hashing" },
  { mapped: true, phase: "hashing" },
])(
  "late capture %j reopens a durable household hold and preserves every byte",
  async ({ mapped, phase: when }) => {
    const f = await readyArchiveCleanup(harness.database(), harness.cipher);
    directories.push(f.file.directory);
    let captured = false;
    if (when === "before") {
      await captureArchiveClaim(f, mapped);
      captured = true;
    }
    f.context.files.checkpoint = async (phase) => {
      if (phase === "native-archive-cleanup-hashing" && !captured) {
        captured = true;
        await captureArchiveClaim(f, mapped);
      }
    };
    expect(await f.activities.cleanupNativeArchiveFiles(f.input)).toEqual({
      status: "protected",
      reason: "archive_legacy_claims_unresolved",
    });
    expect(captured).toBe(true);
    const claims = await buildRecoveryClaims(f.db, {
      planIds: [],
      mediaIds: [f.file.media.id],
    });
    if (mapped) {
      expect(claims.claims).toHaveLength(1);
      expect(claims.blockers).toEqual([]);
    } else {
      expect(claims.claims).toEqual([]);
      expect(claims.blockers).toEqual(["legacy_claim_requester_unmapped"]);
    }
    expect(
      await f.db.recoveryHold.findUniqueOrThrow({
        where: {
          mediaId_edition: { mediaId: f.file.media.id, edition: "default" },
        },
      }),
    ).toMatchObject({ releasedAt: null, reason: LEGACY_CLAIM_PROTECTION });
    const asset = await f.db.libraryAsset.findUniqueOrThrow({
      where: { id: f.first.assetId },
    });
    expect(asset.state).toBe("superseded");
    expect(await readFile(nativeLocalPath(f.context, asset.path), "utf8")).toBe(
      f.publications[0]?.content,
    );
    expect(
      await f.db.nativeArchiveCleanupContinuation.findUniqueOrThrow({
        where: { id: f.continuation.id },
      }),
    ).toMatchObject({
      state: "protected",
      executionEvidence: null,
      completion: null,
    });
  },
);
