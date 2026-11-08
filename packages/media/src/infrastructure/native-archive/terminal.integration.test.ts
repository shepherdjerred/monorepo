import { afterAll, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { readyArchiveCleanup } from "#automation/native-archive/cleanup-test-support.ts";
import { NativeArchiveCompletionSchema } from "#shared/native-recovery/archive.ts";
import { archiveClosure } from "./closure.ts";
import { archiveTerminalDependency } from "./terminal.ts";
import { archiveCompletionDependency } from "./completion.ts";

const harness = automationTestHarness();
const directories: string[] = [];
afterAll(async () => {
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});
test("actual completed archive is a strict terminal dependency; altered parent/evidence/journal contracts fail", async () => {
  const db = harness.database();
  const f = await readyArchiveCleanup(db, harness.cipher);
  directories.push(f.file.directory);
  expect(await f.activities.cleanupNativeArchiveFiles(f.input)).toEqual({
    status: "cleaned",
  });
  const closure = await db.$transaction((tx) =>
    archiveClosure(tx, [f.first.id]),
  );
  const terminal = await db.$transaction((tx) =>
    archiveTerminalDependency(tx, f.first, closure.assets),
  );
  expect(terminal.kind).toBe("archive_completion");
  const row = await db.nativeArchiveCleanupContinuation.findUniqueOrThrow({
    where: { id: f.continuation.id },
    include: { receipt: { include: { plan: true } } },
  });
  const old = closure.assets.find((asset) => asset.id === f.first.assetId);
  const successor = closure.assets.find(
    (asset) => asset.id === f.first.successorAssetId,
  );
  if (old === undefined || successor === undefined)
    throw new Error("Completed closure missing");
  const changedEpoch = {
    ...row,
    receipt: { ...row.receipt, recoveryEpoch: row.recoveryEpoch + 1 },
  };
  expect(() =>
    archiveCompletionDependency(changedEpoch, f.first, old, successor),
  ).toThrow("parent receipt");
  const selection = z.record(z.string(), z.json()).parse(row.receipt.selection);
  const changedFiles = {
    ...row,
    receipt: {
      ...row.receipt,
      selection: {
        ...selection,
        fileEvidence: {
          ...z.record(z.string(), z.json()).parse(selection["fileEvidence"]),
          journalDigest: "0".repeat(64),
        },
      },
    },
  };
  expect(() =>
    archiveCompletionDependency(changedFiles, f.first, old, successor),
  ).toThrow("parent receipt");
  const completion = NativeArchiveCompletionSchema.parse(row.completion);
  const corruptJournal = {
    ...row,
    completion: z.record(z.string(), z.json()).parse({
      ...completion,
      journals: completion.journals.map((journal, index) =>
        index === 0 ? { ...journal, operationId: "foreign-purge" } : journal,
      ),
    }),
  };
  expect(() =>
    archiveCompletionDependency(corruptJournal, f.first, old, successor),
  ).toThrow("journal or absence");
  const wrongDescriptor = {
    ...row,
    descriptor: {
      ...z.record(z.string(), z.json()).parse(row.descriptor),
      selectedCleanupId: crypto.randomUUID(),
    },
  };
  expect(() =>
    archiveCompletionDependency(wrongDescriptor, f.first, old, successor),
  ).toThrow();
});
