import { beforeEach, afterAll, expect, test } from "vitest";
import { readFile, writeFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { automationTestHarness } from "#testing/automation.ts";
import { NativeArchiveFileEvidenceSchema } from "#shared/native-recovery/archive.ts";
import { FinishedNativeV2Schema } from "#shared/native-recovery/lifecycle.ts";
import { archiveCaptionFixture } from "./caption.test-support.ts";

const harness = automationTestHarness();
let fixture: Awaited<ReturnType<typeof archiveCaptionFixture>> | undefined;
const directories: string[] = [];
beforeEach(async ({ task }) => {
  fixture = await archiveCaptionFixture(
    harness.database(),
    harness.context(),
    task.name.includes("settled replacement"),
  );
  directories.push(fixture.f.file.directory);
});
afterAll(async () => {
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});

test("direct archive approval consumes exact compensated caption proof without another native rebaseline", async () => {
  if (fixture === undefined) throw new Error("Archive caption setup missing");
  const f = fixture;
  const finished = FinishedNativeV2Schema.parse(f.plan.plan);
  expect(
    NativeArchiveFileEvidenceSchema.omit({ capturedAt: true })
      .parse(finished.files)
      .subtitleEvidence?.map((item) => item.assetId),
  ).toEqual([f.f.asset.id]);
  await f.observer(f.plan.id);
  await f.files.applyNativeArchiveFiles(f.applyInput);
  expect(
    await harness
      .database()
      .nativeRecoveryReceipt.count({ where: { planId: f.plan.id } }),
  ).toBe(1);
  const continuation = await harness
    .database()
    .nativePublicationCompensationContinuation.findUniqueOrThrow({
      where: { id: f.input.continuationId },
    });
  expect(continuation.completion).toEqual(f.completion);
});

test("same-byte installation journal replacement after archive review refuses the grant", async () => {
  if (fixture === undefined) throw new Error("Archive caption setup missing");
  const f = fixture;
  const journal = path.join(
    f.f.file.roots.control,
    "journal",
    `${f.operation.id}.json`,
  );
  await writeFile(`${journal}.replacement`, await readFile(journal));
  await rename(`${journal}.replacement`, journal);
  await f.observer(f.plan.id);
  await expect(f.files.applyNativeArchiveFiles(f.applyInput)).rejects.toThrow();
  expect(
    await harness
      .database()
      .nativeRecoveryReceipt.count({ where: { planId: f.plan.id } }),
  ).toBe(0);
});

test("settled replacement of an original compensated caption proves its retained archive instead of the old canonical inode", async () => {
  if (fixture?.replacement == null)
    throw new Error("Actual replacement setup missing");
  const f = fixture;
  const before = f.replacement;
  if (before === null) throw new Error("Actual replacement receipt missing");
  const finished = FinishedNativeV2Schema.parse(f.plan.plan);
  const evidence = NativeArchiveFileEvidenceSchema.omit({
    capturedAt: true,
  }).parse(finished.files).subtitleEvidence;
  expect(
    evidence?.[0]?.evidence.files.some(
      (file) =>
        file.canonicalPath.endsWith(`/rollback/${before.importOperationId}`) &&
        file.identity !== null,
    ),
  ).toBe(true);
  await f.observer(f.plan.id);
  await f.files.applyNativeArchiveFiles(f.applyInput);
  expect(
    await harness.database().subtitleReplacement.findUniqueOrThrow({
      where: { id: before.id },
      include: { receipt: true },
    }),
  ).toEqual(before);
  const continuation = await harness
    .database()
    .nativePublicationCompensationContinuation.findUniqueOrThrow({
      where: { id: f.input.continuationId },
    });
  expect(continuation.completion).toEqual(f.completion);
});
