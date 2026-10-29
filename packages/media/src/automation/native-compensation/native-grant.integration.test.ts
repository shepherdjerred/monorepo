import { afterEach, beforeEach, expect, test } from "vitest";
import { readFile, rm } from "node:fs/promises";
import { automationTestHarness } from "#testing/automation.ts";
import { workerFilePath } from "#automation/files/paths/locations.ts";
import { PublicationIntentSchema } from "#shared/publication-proof/intent.ts";
import { NativeCompensationCompletionSchema } from "#shared/native-recovery/compensation-runtime.ts";
import { nativeCompensationFixture } from "./test-fixture.ts";

const harness = automationTestHarness();
let fixture: Awaited<ReturnType<typeof nativeCompensationFixture>> | undefined;
beforeEach(async () => {
  fixture = await nativeCompensationFixture(
    harness.database(),
    harness.context().cipher,
    { nativePredecessor: true, abandonedReplacement: true },
  );
});
afterEach(async () => {
  if (fixture !== undefined)
    await rm(fixture.file.directory, { recursive: true, force: true });
});

test("a native-granted predecessor with an actually abandoned replacement candidate supports upgrade and compensation without changing its physical grant", async () => {
  const f = fixture;
  if (f?.priorNativeReceipt == null)
    throw new Error("Native-granted fixture missing");
  const db = harness.database();
  const intent = PublicationIntentSchema.parse(f.transition.intent);
  if (f.settledReplacement === null)
    throw new Error("Actual abandoned replacement fixture missing");
  expect(
    intent.entries[0]?.predecessor?.subtitleHistory.map((item) => item.id),
  ).toContain(f.settledReplacement.candidate.id);
  expect(
    intent.entries[0]?.predecessor?.subtitles.map((item) => item.id),
  ).not.toContain(f.settledReplacement.candidate.id);
  expect(intent.entries[0]?.originalGrant).toMatchObject({
    receiptId: f.priorNativeReceipt.id,
  });
  expect(f.interrupted.attempt.recoveryEpoch).toBe(1);
  expect(f.runtime.recoveryEpoch).toBe(2);
  await f.prepare();
  const input = await f.apply();
  await f.observe(input);
  expect(await f.activities.compensateNativePublicationFiles(input)).toEqual({
    status: "compensated",
    reason: null,
  });
  const completed =
    await db.nativePublicationCompensationContinuation.findUniqueOrThrow({
      where: { id: input.continuationId },
    });
  const evidence = NativeCompensationCompletionSchema.parse(
    completed.completion,
  );
  expect(evidence.predecessorBindings).toHaveLength(1);
  expect(
    await readFile(workerFilePath(f.file.context, f.canonicalPath), "utf8"),
  ).toBe(f.published.content);
  expect(
    await db.nativeRecoveryReceipt.findUniqueOrThrow({
      where: { id: f.priorNativeReceipt.id },
    }),
  ).toEqual(f.priorNativeReceipt);
  expect(
    await db.subtitleAsset.findUniqueOrThrow({
      where: { id: f.settledReplacement.candidate.id },
    }),
  ).toEqual(f.settledReplacement.candidate);
  expect(
    await db.subtitleReplacementReceipt.findUniqueOrThrow({
      where: { id: f.settledReplacement.receipt.id },
    }),
  ).toEqual(f.settledReplacement.receipt);
  expect(
    await db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: f.interrupted.attempt.id },
    }),
  ).toEqual(f.beforeRestore.attempt);
  expect(
    await db.mediaPublicationTransition.findUniqueOrThrow({
      where: { id: f.transition.id },
    }),
  ).toEqual(f.beforeRestore.transition);
  expect(completed.fenceRelease).toBeNull();
  expect(completed.verifiedPublication).toBeNull();
});
