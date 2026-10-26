import { afterAll, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { automationTestHarness } from "#testing/automation.ts";
import { nativeArchiveFixture } from "#automation/native-archive/test-fixture.ts";
import { mappedPublicationFixture } from "#automation/publication-proof/test-fixture.ts";
import { NativeArchiveContinuationSchema } from "#shared/native-recovery/archive.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { resolveArchiveBindings } from "./bindings.ts";
import { assertPriorNativeBinding } from "./prior-binding.ts";
import { proofQueryAudit } from "#infrastructure/plex-binding/native/query-budget.test-support.ts";

const harness = automationTestHarness();
const directories: string[] = [];
afterAll(async () => {
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});

test("complete multiasset archive resolution shares the actual 100-row authority-read budget", async () => {
  const db = harness.database();
  const f = await nativeArchiveFixture(db, harness.context().cipher, {
    chain: 2,
    fileFactory: () => mappedPublicationFixture(db),
  });
  directories.push(f.file.directory);
  await f.prepare();
  const receiptId = await f.apply();
  const receipt = await db.nativeRecoveryReceipt.findUniqueOrThrow({
    where: { id: receiptId },
  });
  const continuation =
    await db.nativeArchiveCleanupContinuation.findFirstOrThrow({
      where: { receiptId },
    });
  const descriptor = NativeArchiveContinuationSchema.parse(
    continuation.descriptor,
  );
  const resolved = await db.$transaction((tx) =>
    resolveArchiveBindings(tx, receipt, descriptor),
  );
  expect(resolved.networkScope.files).toHaveLength(2);
  const first = resolved.networkScope.files[0];
  if (first?.authority.kind !== "prior_native_binding")
    throw new Error("Actual archive grant missing");
  const reference = first.authority;
  // Receipt+Plan (2), then both Batch+Operation+twoObservation graphs (4 each).
  const authorityReads = 10;
  // Both files reference the same actual receipt. This one scope walk queries
  // its immutable pair once and projects both grants from that queried graph.
  const resolutionReads = 1 + authorityReads;
  const resolutions = (100 - 1) / resolutionReads;
  expect(Number.isSafeInteger(resolutions)).toBe(true);
  await db.$transaction(async (tx) => {
    const budget = new PublicationAuthorityReadBudget();
    const audit = proofQueryAudit(tx);
    try {
      const currentReceipt = await tx.nativeRecoveryReceipt.findUniqueOrThrow({
        where: { id: receiptId },
      });
      budget.consume(1);
      for (let index = 0; index < resolutions; index++) {
        const current = await resolveArchiveBindings(
          tx,
          currentReceipt,
          descriptor,
          { budget },
        );
        expect(current.bindings).toHaveLength(2);
      }
      expect(budget.take).toBe(1);
      // resolveArchiveBindings retains its conservative extra charge per call.
      expect(await audit.returned()).toBe(100 - resolutions);
    } finally {
      audit.restore();
    }
  });
  await expect(
    db.$transaction(async (tx) => {
      const budget = new PublicationAuthorityReadBudget();
      for (let index = 0; index < 10; index++)
        await assertPriorNativeBinding(tx, first, reference, { budget });
      expect(budget.take).toBe(1);
      await resolveArchiveBindings(tx, receipt, descriptor, { budget });
    }),
  ).rejects.toThrow("100 total queried records");
});
