import { defaultScope } from "#shared/editions/scope.ts";
import { targetWhere } from "#infrastructure/editions/targets.ts";
import { afterAll, expect, test } from "vitest";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { FileOperations } from "#filesystem/operations.ts";
import { FileLockError } from "#filesystem/advisory-lock.ts";
import { nativeFileFixture } from "./test-fixture.ts";
import { prepareNativeFiles } from "./files.ts";
import { applyPreparedNative } from "./apply.ts";

const harness = automationTestHarness();
const directories: string[] = [];
afterAll(async () => {
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});
async function fixture() {
  const f = await nativeFileFixture(
    harness.database(),
    harness.context().cipher,
  );
  directories.push(f.file.directory);
  const approval = await f.review();
  await f.observe();
  const prepared = await prepareNativeFiles(f.context, {
    planId: f.planId,
    operationId: z.uuid().parse(approval.operationId),
  });
  return {
    ...f,
    prepared,
    input: {
      planId: f.planId,
      operationId: z.uuid().parse(approval.operationId),
    },
  };
}
async function expectNoGrant(f: Awaited<ReturnType<typeof fixture>>) {
  const db = harness.database();
  expect(
    await db.nativeRecoveryReceipt.count({ where: { planId: f.planId } }),
  ).toBe(0);
  expect(
    await db.libraryAsset.findUniqueOrThrow({ where: { id: f.asset.id } }),
  ).toMatchObject({ ownershipEpoch: 0, version: f.asset.version });
  expect(
    await db.mediaIntent.findUniqueOrThrow({
      where: targetWhere(defaultScope(f.file.media.id)),
    }),
  ).toMatchObject({ automationEpoch: 0 });
  expect(
    await db.mediaRuntimeState.findUniqueOrThrow({
      where: { id: "singleton" },
    }),
  ).toMatchObject({ mode: "observe", ownershipConfirmed: false });
  expect(
    await db.applicationEvent.count({
      where: { mediaId: f.file.media.id, kind: "native_recovery_applied" },
    }),
  ).toBe(0);
}
test("an unresolved real import journal targeting an installed sidecar prevents native owner review and reownership", async () => {
  const f = await nativeFileFixture(
    harness.database(),
    harness.context().cipher,
  );
  directories.push(f.file.directory);
  const roots = f.file.context.roots.movies;
  const relative = path.relative(
    "/data/movies",
    z.string().parse(f.subtitle.path),
  );
  const original = await readFile(path.join(roots.library, relative));
  const replacement =
    "1\n00:00:00,000 --> 00:00:01,000\nPending subtitle replacement\n";
  const operationId = crypto.randomUUID();
  const downloadPath = `${operationId}.srt`;
  await writeFile(path.join(roots.downloads, downloadPath), replacement);
  const verifyPlexExclusion = f.context.files.verifyPlexExclusion;
  if (verifyPlexExclusion === undefined)
    throw new Error("Missing real proof validator");
  const operations = new FileOperations(roots, {
    verifyPlexExclusion,
    authorize: () =>
      Promise.reject(
        new Error("This test only stages an unresolved operation"),
      ),
    minimumFreeBytes: 0,
  });
  const staged = await operations.importFile({
    operationId,
    downloadPath,
    libraryPath: relative,
    sha256: createHash("sha256").update(replacement).digest("hex"),
    previousSha256: z.string().parse(f.subtitle.checksum),
    stopAfterStaging: true,
  });
  expect(staged.phase).toBe("staged");
  await expect(f.review()).rejects.toThrow("unresolved filesystem effect");
  const db = harness.database();
  expect(
    await db.nativeRecoveryReceipt.count({ where: { planId: f.planId } }),
  ).toBe(0);
  expect(
    await db.subtitleAsset.findUniqueOrThrow({ where: { id: f.subtitle.id } }),
  ).toMatchObject({
    ownershipEpoch: 0,
    state: "installed",
    version: f.subtitle.version,
  });
  expect(
    await db.libraryAsset.findUniqueOrThrow({ where: { id: f.asset.id } }),
  ).toMatchObject({ ownershipEpoch: 0, version: f.asset.version });
  expect(await operations.readManifest(operationId)).toMatchObject({
    phase: "staged",
  });
  expect(await readFile(path.join(roots.library, relative))).toEqual(original);
});
test.each(["contents", "ancestor"] as const)(
  "final native proof rejects %s drift after hashing with no ownership grant",
  async (mode) => {
    const f = await fixture();
    const local = path.join(
      f.file.context.roots.movies.library,
      f.published.entry.libraryPath,
    );
    if (mode === "contents")
      await writeFile(local, Buffer.alloc(f.published.content.length, "x"));
    else {
      const parent = path.dirname(local);
      await rename(parent, `${parent}.previous`);
      await mkdir(parent);
      await rename(
        path.join(`${parent}.previous`, path.basename(local)),
        local,
      );
    }
    await expect(
      applyPreparedNative(f.context, f.input, f.prepared),
    ).rejects.toThrow(mode === "ancestor" ? "ancestor" : "identity changed");
    await expectNoGrant(f);
  },
);
test.each([
  "lease",
  "storage",
  "worker",
  "owner",
  "restricted-owner",
  "runtime",
] as const)(
  "current %s authority revocation prevents applying a valid prior file proof",
  async (mode) => {
    const f = await fixture();
    const db = harness.database();
    if (mode === "lease")
      await db.legacyWriterLease.update({
        where: { id: "singleton" },
        data: {
          recoveryEpoch: f.runtime.recoveryEpoch,
          observedAt: new Date(),
          revokedAt: new Date(),
        },
      });
    if (mode === "storage")
      await db.mediaStorageAuthority.updateMany({
        data: {
          recoveryEpoch: f.runtime.recoveryEpoch,
          observedAt: new Date(),
          revokedAt: new Date(),
        },
      });
    if (mode === "worker") f.context.workerPodUid = "different-executing-pod";
    if (mode === "owner")
      await db.mediaUser.update({
        where: { id: f.prior.actor.id },
        data: { role: "member" },
      });
    if (mode === "restricted-owner")
      await db.mediaUser.update({
        where: { id: f.prior.actor.id },
        data: { restricted: true },
      });
    if (mode === "runtime")
      await db.mediaRuntimeState.update({
        where: { id: "singleton" },
        data: { version: { increment: 1 } },
      });
    await expect(
      applyPreparedNative(f.context, f.input, f.prepared),
    ).rejects.toThrow();
    await expectNoGrant(f);
  },
);
test("a changed filesystem journal rolls back authority rows written earlier in the same apply transaction", async () => {
  const f = await fixture();
  const db = harness.database();
  const before = await db.mediaStorageAuthority.findMany({
    orderBy: { rootPath: "asc" },
  });
  const journal = path.join(
    f.file.context.roots.movies.control,
    "journal",
    `${crypto.randomUUID()}.json`,
  );
  await writeFile(
    journal,
    JSON.stringify({ unresolved: "synthetic-new-filesystem-effect" }),
  );
  await expect(
    applyPreparedNative(f.context, f.input, f.prepared),
  ).rejects.toThrow("journal changed");
  await expectNoGrant(f);
  expect(
    await db.mediaStorageAuthority.findMany({ orderBy: { rootPath: "asc" } }),
  ).toEqual(before);
});
test("network expiry during exclusion validation under the real file lock cannot grant authority; fresh observation retries the same approval", async () => {
  const setup = await nativeFileFixture(
    harness.database(),
    harness.context().cipher,
  );
  directories.push(setup.file.directory);
  const approval = await setup.review();
  const input = {
    planId: setup.planId,
    operationId: z.uuid().parse(approval.operationId),
  };
  const expiresAt = Date.now() + 2000;
  setup.prior.quiescence.expiresAt = new Date(expiresAt).toISOString();
  await setup.observe(input);
  const prepared = await prepareNativeFiles(setup.context, input);
  const f = { ...setup, prepared, input };
  expect(prepared.plex.freshness.expiresAtMs).toBeLessThanOrEqual(expiresAt);
  const local = path.join(
    f.file.context.roots.movies.library,
    f.published.entry.libraryPath,
  );
  const proof = await f.prepared.content.verifiedFile(local);
  const validationReached = Promise.withResolvers<boolean>();
  const releaseValidation = Promise.withResolvers<boolean>();
  const original = f.context.files.verifyPlexExclusion;
  if (original === undefined) throw new Error("Missing real proof validator");
  const operations = new FileOperations(f.file.context.roots.movies, {
    verifyPlexExclusion: original,
    authorize: () => Promise.reject(new Error("Read-only test lock")),
  });
  let pausedUnderLock = false;
  f.context.files.verifyPlexExclusion = async (...args) => {
    await original(...args);
    if (pausedUnderLock) return;
    try {
      await operations.withFileIdentity(
        { ...proof, libraryPath: f.published.entry.libraryPath },
        () => Promise.resolve(),
      );
      return;
    } catch (error) {
      if (!(error instanceof FileLockError) || error.kind !== "busy")
        throw error;
    }
    pausedUnderLock = true;
    validationReached.resolve(true);
    await releaseValidation.promise;
  };
  const result = captureApply();
  async function captureApply() {
    try {
      const value = await applyPreparedNative(f.context, f.input, f.prepared);
      return { success: true as const, value };
    } catch (error) {
      return { success: false as const, error };
    }
  }
  async function endedBeforePause() {
    await result;
    throw new Error("Apply ended before validation pause");
  }
  try {
    await Promise.race([validationReached.promise, endedBeforePause()]);
    expect(pausedUnderLock).toBe(true);
    expect(Date.now()).toBeLessThan(expiresAt);
    await expect(
      operations.withFileIdentity(
        { ...proof, libraryPath: f.published.entry.libraryPath },
        () => Promise.resolve(),
      ),
    ).rejects.toThrow("lock busy");
    await new Promise((resolve) =>
      setTimeout(resolve, expiresAt - Date.now() + 25),
    );
  } finally {
    releaseValidation.resolve(true);
  }
  const outcome = await result;
  expect(outcome.success).toBe(false);
  if (!outcome.success)
    expect(outcome.error).toMatchObject({
      code: "verification_expired",
      reason: "verification_expired",
    });
  await expectNoGrant(f);
  f.context.files.verifyPlexExclusion = original;
  f.prior.quiescence.expiresAt = new Date(Date.now() + 90_000).toISOString();
  await f.observe(f.input);
  const retry = await prepareNativeFiles(f.context, f.input);
  await applyPreparedNative(f.context, f.input, retry);
  expect(
    await harness
      .database()
      .nativeRecoveryReceipt.count({ where: { planId: f.planId } }),
  ).toBe(1);
  expect(await readFile(local, "utf8")).toBe(f.published.content);
});
