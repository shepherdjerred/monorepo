import { defaultScope } from "#shared/editions/scope.ts";
import { targetWhere } from "#infrastructure/editions/targets.ts";
import { afterAll, expect, test } from "vitest";
import { rm, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { nativeQuarantineFixture } from "./test-fixture.ts";

const harness = automationTestHarness();
const directories: string[] = [];
afterAll(async () => {
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});
async function fixture() {
  const f = await nativeQuarantineFixture(
    harness.database(),
    harness.context().cipher,
  );
  directories.push(f.file.directory);
  return f;
}

test("committed quarantine rebaseline preserves bytes, qualities, decisions and demand while granting only exact physical authority", async () => {
  const f = await fixture();
  const decisions = await f.db.retentionDecision.findMany({
    where: { mediaId: f.file.media.id },
  });
  const intent = await f.db.mediaIntent.findUniqueOrThrow({
    where: targetWhere(defaultScope(f.file.media.id)),
  });
  const subtitles = await f.db.subtitleAsset.findMany({
    where: { assetId: f.asset.id },
    orderBy: { id: "asc" },
  });
  const before = await f.bytes();
  const continuation = await f.apply();
  expect(await f.bytes()).toBe(before);
  expect(
    await f.db.libraryAsset.findUniqueOrThrow({ where: { id: f.asset.id } }),
  ).toMatchObject({ state: "quarantined", ownershipEpoch: 1, version: 2 });
  expect(
    await f.db.retentionDecision.findMany({
      where: { mediaId: f.file.media.id },
    }),
  ).toEqual(decisions);
  expect(
    await f.db.mediaIntent.findUniqueOrThrow({
      where: targetWhere(defaultScope(f.file.media.id)),
    }),
  ).toEqual(intent);
  const after = await f.db.subtitleAsset.findMany({
    where: { assetId: f.asset.id },
    orderBy: { id: "asc" },
  });
  expect(
    after.map((row) => [
      row.id,
      row.qualityStatus,
      row.provenance,
      row.matchingEvidence,
    ]),
  ).toEqual(
    subtitles.map((row) => [
      row.id,
      row.qualityStatus,
      row.provenance,
      row.matchingEvidence,
    ]),
  );
  expect(
    after.every(
      (row) =>
        row.state === "quarantined" &&
        row.ownershipEpoch === 1 &&
        row.videoVersion === 2,
    ),
  ).toBe(true);
  expect(continuation).toMatchObject({
    state: "pending",
    executionEvidence: null,
    restoration: null,
    recoveryEpoch: 1,
  });
  expect(
    await f.db.recoveryHold.findUniqueOrThrow({
      where: targetWhere(defaultScope(f.file.media.id)),
    }),
  ).toMatchObject({ releasedAt: null });
});

test("fresh positive continuation restores all exact participants once without rewriting old retention history", async () => {
  const f = await fixture();
  const continuation = await f.apply();
  const old = await f.db.retentionDecision.findMany({
    where: { mediaId: f.file.media.id },
  });
  const input = await f.positiveRestore();
  expect(await f.activities.restoreNativeQuarantineFiles(input)).toEqual({
    status: "restored",
  });
  expect(
    await readFile(
      path.join(f.file.roots.library, f.published.entry.libraryPath),
      "utf8",
    ),
  ).toBe(f.published.content);
  const result = await f.db.nativeQuarantineContinuation.findUniqueOrThrow({
    where: { id: continuation.id },
  });
  expect(result).toMatchObject({ state: "restored" });
  expect(
    await f.db.mediaItem.findUniqueOrThrow({ where: { id: f.file.media.id } }),
  ).toMatchObject({ availability: "importing" });
  expect(
    await f.db.retentionDecision.findMany({
      where: { mediaId: f.file.media.id },
    }),
  ).toEqual(old);
  expect(await f.activities.restoreNativeQuarantineFiles(input)).toEqual({
    status: "restored",
  });
  const replayed = await f.db.nativeQuarantineContinuation.findUniqueOrThrow({
    where: { id: continuation.id },
  });
  expect(replayed.restoration).toEqual(result.restoration);
  expect(
    await f.db.libraryAsset.findUniqueOrThrow({ where: { id: f.asset.id } }),
  ).toMatchObject({ version: 3, state: "published" });
});

test.each([
  "move-linked",
  "move-unlinked",
  "native-quarantine-restored-before-commit",
])(
  "cold retry reconciles exact own transition after %s interruption",
  async (phase) => {
    const f = await fixture();
    const continuation = await f.apply();
    const input = await f.positiveRestore();
    let interrupted = false;
    f.context.files.checkpoint = (current) => {
      if (!interrupted && current === phase) {
        interrupted = true;
        return Promise.reject(new Error("Synthetic process interruption"));
      }
      return Promise.resolve();
    };
    await expect(
      f.activities.restoreNativeQuarantineFiles(input),
    ).rejects.toThrow("Synthetic process interruption");
    expect(interrupted).toBe(true);
    expect(
      await f.db.libraryAsset.findUniqueOrThrow({ where: { id: f.asset.id } }),
    ).toMatchObject({ version: 2, state: "quarantined" });
    const interruptedRow =
      await f.db.nativeQuarantineContinuation.findUniqueOrThrow({
        where: { id: continuation.id },
      });
    expect(interruptedRow.executionEvidence).not.toBeNull();
    f.context.files.checkpoint = () => Promise.resolve();
    expect(await f.activities.restoreNativeQuarantineFiles(input)).toEqual({
      status: "restored",
    });
    expect(
      await f.db.libraryAsset.findUniqueOrThrow({ where: { id: f.asset.id } }),
    ).toMatchObject({ version: 3, state: "published" });
  },
);

test("a same-byte foreign inode at the interrupted destination cannot be adopted", async () => {
  const f = await fixture();
  await f.apply();
  const input = await f.positiveRestore();
  f.context.files.checkpoint = (phase) =>
    phase === "move-unlinked"
      ? Promise.reject(new Error("interrupt"))
      : Promise.resolve();
  await expect(
    f.activities.restoreNativeQuarantineFiles(input),
  ).rejects.toThrow("interrupt");
  const target = path.join(f.file.roots.library, f.published.entry.libraryPath);
  const bytes = await readFile(target);
  await rename(target, `${target}.retained-original`);
  await writeFile(target, bytes);
  f.context.files.checkpoint = () => Promise.resolve();
  await expect(
    f.activities.restoreNativeQuarantineFiles(input),
  ).rejects.toThrow("identity changed");
  expect(
    await f.db.libraryAsset.findUniqueOrThrow({ where: { id: f.asset.id } }),
  ).toMatchObject({ state: "quarantined", version: 2 });
});

test("reviewed canonical absence and original quarantine inode both remain required at apply", async () => {
  const f = await fixture();
  const approval = await f.approve();
  await writeFile(
    path.join(f.file.roots.library, f.published.entry.libraryPath),
    f.published.content,
  );
  await f.observe();
  await expect(
    f.activities.applyNativeQuarantineFiles({
      planId: f.planId,
      operationId: z.uuid().parse(approval.operationId),
    }),
  ).rejects.toThrow("canonical destination exists");
  expect(
    await f.db.nativeRecoveryReceipt.count({ where: { planId: f.planId } }),
  ).toBe(0);
});
