import { afterEach, beforeEach, expect, test } from "vitest";
import {
  lstat,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { automationTestHarness } from "#testing/automation.ts";
import {
  nativeCompensationFixture,
  testCompensationExecution,
} from "#automation/native-compensation/test-fixture.ts";
import { createNativeCompensationFileActivities } from "#automation/native-compensation/activities.ts";
import { workerFilePath } from "#automation/files/paths/locations.ts";
import { publicationRecordNamespace } from "#filesystem/publication-proof/records.ts";
import type { NativeCompensationActivityInput } from "#shared/native-recovery/compensation-runtime.ts";
import { NativePlexProofRefSchema } from "#shared/plex-binding/native.ts";
import { z } from "zod";

const harness = automationTestHarness();
let fixture: Awaited<ReturnType<typeof nativeCompensationFixture>> | undefined;
let activity: NativeCompensationActivityInput | undefined;
beforeEach(async () => {
  fixture = await nativeCompensationFixture(
    harness.database(),
    harness.context().cipher,
  );
  await fixture.prepare();
  activity = await fixture.apply();
  expect(await fixture.observe(activity)).toEqual({
    status: "ready",
    reason: null,
  });
});
afterEach(async () => {
  if (fixture !== undefined)
    await rm(fixture.file.directory, { recursive: true, force: true });
  fixture = undefined;
  activity = undefined;
});

function current() {
  if (fixture === undefined || activity === undefined)
    throw new Error("Measured compensation fixture missing");
  const f = fixture;
  const input = activity;
  const canonical = workerFilePath(f.file.context, f.canonicalPath);
  const directory = path.join(
    f.file.context.roots.movies.control,
    publicationRecordNamespace({
      transitionId: f.transition.id,
      continuationId: input.continuationId,
    }),
  );
  return { f, input, canonical, directory, db: harness.database() };
}

async function assertNoExecution() {
  const { f, input, canonical, db } = current();
  expect(await readFile(canonical, "utf8")).toBe(f.interrupted.content);
  expect(
    await db.nativePublicationCompensationContinuation.findUniqueOrThrow({
      where: { id: input.continuationId },
    }),
  ).toMatchObject({
    executionEvidence: null,
    completion: null,
  });
  expect(
    await db.mediaPublicationTransition.findUniqueOrThrow({
      where: { id: f.transition.id },
    }),
  ).toEqual(f.beforeRestore.transition);
  expect(
    await db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: f.interrupted.attempt.id },
    }),
  ).toEqual(f.beforeRestore.attempt);
}

test("same-byte inode replacement after read-only hashing cannot initialize a namespace or record execution", async () => {
  const { f, input, canonical, directory } = current();
  const checkpoint = f.context.files.checkpoint;
  f.context.files.checkpoint = async (phase) => {
    await checkpoint(phase);
    if (phase !== "native-compensation-measured") return;
    const replacement = path.join(
      f.file.directory,
      "after-measurement-replacement",
    );
    await writeFile(replacement, await readFile(canonical));
    await rename(replacement, canonical);
  };
  expect(await f.activities.compensateNativePublicationFiles(input)).toEqual({
    status: "protected",
    reason: "compensation_physical_identity_protected",
  });
  await assertNoExecution();
  await expect(lstat(directory)).rejects.toMatchObject({ code: "ENOENT" });
});

test.each(["expiry", "cancel"] as const)(
  "original SDK %s after hashing prevents all namespace and execution writes",
  async (kind) => {
    const { f, input, directory } = current();
    const controller = new AbortController();
    const failure = new Error("Original SDK measurement deadline expired");
    let expired = false;
    const checkpoint = f.context.files.checkpoint;
    f.context.files.checkpoint = async (phase) => {
      await checkpoint(phase);
      if (phase !== "native-compensation-measured") return;
      if (kind === "cancel") controller.abort(failure);
      else expired = true;
    };
    const activities = createNativeCompensationFileActivities(
      f.context,
      () => ({
        expiresAtMs: Date.now() + 300_000,
        signal: controller.signal,
        checkpoint: () => Promise.resolve(),
        assertActive: () => {
          controller.signal.throwIfAborted();
          if (expired) throw failure;
        },
      }),
    );
    await expect(
      activities.compensateNativePublicationFiles(input),
    ).rejects.toBe(failure);
    await assertNoExecution();
    await expect(lstat(directory)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

test("a real newer Network observation cannot replace pinned proof A after hashing", async () => {
  const { f, input, directory, db } = current();
  const result = z.object({ nativePlexProof: NativePlexProofRefSchema });
  const operation = await db.operation.findUniqueOrThrow({
    where: { id: input.operationId },
  });
  const original = result.parse(operation.result).nativePlexProof;
  const checkpoint = f.context.files.checkpoint;
  let replaced = false;
  f.context.files.checkpoint = async (phase) => {
    await checkpoint(phase);
    if (phase !== "native-compensation-measured") return;
    expect(await f.observe(input)).toEqual({ status: "ready", reason: null });
    const observed = await db.operation.findUniqueOrThrow({
      where: { id: input.operationId },
    });
    const next = result.parse(observed.result).nativePlexProof;
    expect(next.batchId).not.toBe(original.batchId);
    replaced = true;
  };
  expect(await f.activities.compensateNativePublicationFiles(input)).toEqual({
    status: "protected",
    reason: "scope_changed",
  });
  expect(replaced).toBe(true);
  await assertNoExecution();
  await expect(lstat(directory)).rejects.toMatchObject({ code: "ENOENT" });
});

test("failure after authorized empty namespace initialization leaves no execution grant and retry revalidates it", async () => {
  const { f, input, directory, canonical } = current();
  const failure = new Error("Synthetic process boundary before execution CAS");
  const checkpoint = f.context.files.checkpoint;
  f.context.files.checkpoint = async (phase) => {
    await checkpoint(phase);
    if (phase === "native-compensation-namespace-initialized") throw failure;
  };
  await expect(
    f.activities.compensateNativePublicationFiles(input),
  ).rejects.toBe(failure);
  expect(await readdir(directory)).toEqual([]);
  await assertNoExecution();
  f.context.files.checkpoint = checkpoint;
  expect(await f.activities.compensateNativePublicationFiles(input)).toEqual({
    status: "compensated",
    reason: null,
  });
  expect(await readFile(canonical, "utf8")).toBe(f.published.content);
});

test.each([false, true])(
  "committed execution with removed namespace=%s preserves truthful retry boundaries",
  async (removeNamespace) => {
    const { f, input, directory, canonical, db } = current();
    const failure = new Error(
      "Synthetic process boundary after execution commit",
    );
    const checkpoint = f.context.files.checkpoint;
    f.context.files.checkpoint = async (phase) => {
      await checkpoint(phase);
      if (phase === "native-compensation-execution-committed") throw failure;
    };
    await expect(
      f.activities.compensateNativePublicationFiles(input),
    ).rejects.toBe(failure);
    const recorded =
      await db.nativePublicationCompensationContinuation.findUniqueOrThrow({
        where: { id: input.continuationId },
      });
    expect(recorded.executionEvidence).not.toBeNull();
    expect(recorded.completion).toBeNull();
    expect(await readdir(directory)).toEqual([]);
    expect(await readFile(canonical, "utf8")).toBe(f.interrupted.content);
    f.context.files.checkpoint = checkpoint;
    if (removeNamespace) await rm(directory, { recursive: true });
    const activities = createNativeCompensationFileActivities(
      f.context,
      testCompensationExecution,
    );
    if (removeNamespace) {
      expect(await activities.compensateNativePublicationFiles(input)).toEqual({
        status: "protected",
        reason: "compensation_physical_identity_protected",
      });
      await expect(lstat(directory)).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readFile(canonical, "utf8")).toBe(f.interrupted.content);
      expect(
        await db.nativePublicationCompensationContinuation.findUniqueOrThrow({
          where: { id: input.continuationId },
        }),
      ).toMatchObject({
        state: "protected",
        executionEvidence: recorded.executionEvidence,
        descriptor: recorded.descriptor,
        descriptorHash: recorded.descriptorHash,
        completion: null,
      });
    } else {
      expect(await activities.compensateNativePublicationFiles(input)).toEqual({
        status: "compensated",
        reason: null,
      });
      expect(await readFile(canonical, "utf8")).toBe(f.published.content);
    }
  },
);
