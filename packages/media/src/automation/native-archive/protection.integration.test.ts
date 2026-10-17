import { afterAll, expect, test, vi } from "vitest";
import { readFile, writeFile, rename, rm, mkdir, cp } from "node:fs/promises";
import path from "node:path";
import { automationTestHarness } from "#testing/automation.ts";
import { nativeLocalPath } from "#automation/native-recovery/files.ts";
import { createNativeArchiveFileActivities } from "./activities.ts";
import { readyArchiveCleanup } from "./cleanup-test-support.ts";
import { NativeArchiveExecutionSchema } from "#shared/native-recovery/archive.ts";
import { archivePurgeId, archivePurgeManifest } from "./purge-manifest.ts";
import { prepareMediaRestore } from "#infrastructure/recovery.ts";
import { assertArchiveCleanupFresh } from "./cleanup-authority.ts";
import { NativeArchiveCleanupNetworkEvidenceSchema } from "#shared/native-recovery/archive.ts";
import { reserveArchiveCurrentSubtitle } from "./fixtures/replacement.ts";

const harness = automationTestHarness();
const directories: string[] = [];
afterAll(async () => {
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});
async function fixture() {
  const f = await readyArchiveCleanup(harness.database(), harness.cipher);
  directories.push(f.file.directory);
  return f;
}

test.each(["same_bytes", "missing", "changed_ancestor"] as const)(
  "%s archive bytes cannot inherit the original physical grant",
  async (condition) => {
    const f = await fixture();
    const asset = await f.db.libraryAsset.findUniqueOrThrow({
      where: { id: f.first.assetId },
    });
    const local = nativeLocalPath(f.context, asset.path);
    const bytes = await readFile(local);
    if (condition === "missing") await rm(local);
    else if (condition === "same_bytes") {
      await rename(local, `${local}.foreign-original`);
      await writeFile(local, bytes);
    } else {
      const rollback = f.context.files.roots.movies.control + "/rollback";
      await rename(rollback, `${rollback}-foreign-original`);
      await mkdir(rollback);
      await writeFile(local, bytes);
    }
    expect(await f.activities.cleanupNativeArchiveFiles(f.input)).toEqual({
      status: "protected",
      reason: "archive_physical_identity_protected",
    });
    const continuation =
      await f.db.nativeArchiveCleanupContinuation.findUniqueOrThrow({
        where: { id: f.continuation.id },
      });
    expect(continuation.executionEvidence).toBeNull();
    expect(continuation.state).toBe("protected");
    expect(
      await f.db.libraryAsset.findUniqueOrThrow({ where: { id: asset.id } }),
    ).toMatchObject({ state: "superseded" });
  },
);

test.each([
  "hold",
  "purge_gate",
  "generation",
  "coordinator",
  "epoch",
] as const)(
  "current %s authority protects archive bytes",
  async (condition) => {
    const f = await fixture();
    switch (condition) {
      case "epoch":
        await prepareMediaRestore(f.db, {
          recoveryId: crypto.randomUUID(),
          expectedEpoch: f.input.recoveryEpoch,
          reason: "Actual second restore fences old cleanup",
        });
        break;
      case "hold":
        await f.db.retentionHold.create({
          data: {
            mediaId: f.file.media.id,
            userId: f.file.user.id,
            isPin: true,
          },
        });
        break;
      case "purge_gate":
        f.context.files.enabled.purge = () => Promise.resolve(false);
        break;
      case "generation":
        await f.db.mediaIntent.updateMany({
          where: { mediaId: f.file.media.id, edition: "default" },
          data: { generation: { increment: 1 } },
        });
        break;
      case "coordinator":
        await f.db.nativeArchiveCleanupContinuation.update({
          where: { id: f.continuation.id },
          data: { coordinatorOperationId: null, version: { increment: 1 } },
        });
        break;
    }
    expect(await f.activities.cleanupNativeArchiveFiles(f.input)).toMatchObject(
      { status: "protected" },
    );
    const old = await f.db.libraryAsset.findUniqueOrThrow({
      where: { id: f.first.assetId },
    });
    expect(await readFile(nativeLocalPath(f.context, old.path), "utf8")).toBe(
      f.publications[0]?.content,
    );
    const continuation =
      await f.db.nativeArchiveCleanupContinuation.findUniqueOrThrow({
        where: { id: f.continuation.id },
      });
    expect(continuation.executionEvidence).toBeNull();
  },
);

test("intent changing during hashing cannot mint execution identity or unlink", async () => {
  const f = await fixture();
  let changed = false;
  f.context.files.checkpoint = async (phase) => {
    if (phase === "native-archive-cleanup-hashing" && !changed) {
      changed = true;
      await f.db.mediaIntent.updateMany({
        where: { mediaId: f.file.media.id, edition: "default" },
        data: { generation: { increment: 1 }, desiredPresence: false },
      });
    }
  };
  expect(await f.activities.cleanupNativeArchiveFiles(f.input)).toMatchObject({
    status: "protected",
    reason: "archive_generation_changed",
  });
  expect(changed).toBe(true);
  const continuation =
    await f.db.nativeArchiveCleanupContinuation.findUniqueOrThrow({
      where: { id: f.continuation.id },
    });
  expect(continuation.executionEvidence).toBeNull();
});

test("an exact-looking purge journal without persisted execution cannot explain missing archive bytes", async () => {
  const f = await fixture();
  const asset = await f.db.libraryAsset.findUniqueOrThrow({
    where: { id: f.first.assetId },
  });
  const local = nativeLocalPath(f.context, asset.path);
  const operationId = archivePurgeId(f.continuation.id, asset.path);
  await writeFile(
    path.join(
      f.context.files.roots.movies.control,
      "journal",
      `${operationId}.json`,
    ),
    JSON.stringify({
      version: 1,
      operationId,
      kind: "purge",
      source: local,
      target: local,
      sha256: asset.checksum,
      previousSha256: null,
      phase: "complete",
    }),
  );
  await rm(local);
  expect(await f.activities.cleanupNativeArchiveFiles(f.input)).toEqual({
    status: "protected",
    reason: "archive_physical_identity_protected",
  });
  expect(
    await f.db.nativeArchiveCleanupContinuation.findUniqueOrThrow({
      where: { id: f.continuation.id },
    }),
  ).toMatchObject({
    state: "protected",
    executionEvidence: null,
    completion: null,
  });
  expect(
    await f.db.libraryAsset.findUniqueOrThrow({ where: { id: asset.id } }),
  ).toMatchObject({ state: "superseded" });
});

test.each(["same_bytes", "journal_directory"] as const)(
  "%s substitution after execution persistence is rejected before unlink",
  async (condition) => {
    const f = await fixture();
    const asset = await f.db.libraryAsset.findUniqueOrThrow({
      where: { id: f.first.assetId },
    });
    const local = nativeLocalPath(f.context, asset.path);
    const bytes = await readFile(local);
    let changed = false;
    f.context.files.checkpoint = async (phase) => {
      if (phase !== "native-archive-execution-committed" || changed) return;
      changed = true;
      if (condition === "same_bytes") {
        await rename(local, `${local}.foreign-original`);
        await writeFile(local, bytes);
        return;
      }
      const row = await f.db.nativeArchiveCleanupContinuation.findUniqueOrThrow(
        { where: { id: f.continuation.id } },
      );
      const execution = NativeArchiveExecutionSchema.parse(
        row.executionEvidence,
      );
      const participant = execution.participants[0];
      if (participant === undefined)
        throw new Error("Missing execution participant");
      const journal = archivePurgeManifest(f.context, row.id, participant);
      const directory = path.join(
        f.context.files.roots.movies.control,
        "journal",
      );
      await writeFile(
        path.join(directory, `${journal.operationId}.json`),
        JSON.stringify(journal),
      );
      await rename(directory, `${directory}-original`);
      await cp(`${directory}-original`, directory, { recursive: true });
    };
    expect(await f.activities.cleanupNativeArchiveFiles(f.input)).toEqual({
      status: "protected",
      reason: "archive_physical_identity_protected",
    });
    expect(changed).toBe(true);
    expect(await readFile(local)).toEqual(bytes);
    const row = await f.db.nativeArchiveCleanupContinuation.findUniqueOrThrow({
      where: { id: f.continuation.id },
    });
    expect(row.state).toBe("protected");
    expect(row.executionEvidence).not.toBeNull();
    expect(row.completion).toBeNull();
  },
);

test("deadline crossing a real runtime lock rolls back with an un-aborted invocation", async () => {
  const f = await fixture();
  const acquired = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();
  const held = f.db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "MediaRuntimeState" WHERE id='singleton' FOR UPDATE`;
    acquired.resolve(undefined);
    await release.promise;
  });
  await acquired.promise;
  const controller = new AbortController();
  let expired = false;
  const activities = createNativeArchiveFileActivities(f.context, () => ({
    signal: controller.signal,
    assertActive: () => {
      if (expired) throw new Error("Exact invocation deadline expired");
    },
    checkpoint: () => Promise.resolve(),
  }));
  const running = activities.cleanupNativeArchiveFiles(f.input);
  const rejected = expect(running).rejects.toThrow(
    "Exact invocation deadline expired",
  );
  // Observe the actual blocked backend instead of depending on an elapsed sleep.
  let waiting = false;
  for (let tries = 0; !waiting && tries < 100; tries++) {
    const rows = await f.db.$queryRaw<
      { blocked: boolean }[]
    >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND pid<>pg_backend_pid()) AS blocked`;
    waiting = rows[0]?.blocked === true;
  }
  expired = true;
  release.resolve(undefined);
  await held;
  await rejected;
  expect(waiting).toBe(true);
  expect(controller.signal.aborted).toBe(false);
  const continuation =
    await f.db.nativeArchiveCleanupContinuation.findUniqueOrThrow({
      where: { id: f.continuation.id },
    });
  expect(continuation.executionEvidence).toBeNull();
  expect(await f.activities.cleanupNativeArchiveFiles(f.input)).toEqual({
    status: "cleaned",
  });
});

test("cancellation during hashing leaves execution uncommitted and bytes intact", async () => {
  const f = await fixture();
  const controller = new AbortController();
  f.context.files.checkpoint = async (phase) => {
    if (phase === "native-archive-cleanup-hashing")
      controller.abort(new Error("Exact invocation cancelled"));
  };
  const activities = createNativeArchiveFileActivities(f.context, () => ({
    signal: controller.signal,
    assertActive: () => {
      controller.signal.throwIfAborted();
    },
    checkpoint: () => Promise.resolve(),
  }));
  await expect(activities.cleanupNativeArchiveFiles(f.input)).rejects.toThrow(
    "Exact invocation cancelled",
  );
  const continuation =
    await f.db.nativeArchiveCleanupContinuation.findUniqueOrThrow({
      where: { id: f.continuation.id },
    });
  expect(continuation.executionEvidence).toBeNull();
  expect(continuation.completion).toBeNull();
  const asset = await f.db.libraryAsset.findUniqueOrThrow({
    where: { id: f.first.assetId },
  });
  expect(await readFile(nativeLocalPath(f.context, asset.path), "utf8")).toBe(
    f.publications[0]?.content,
  );
});

test("the original seven-day rollback window prevents an early files invocation without any hashing or unlink", async () => {
  const f = await readyArchiveCleanup(harness.database(), harness.cipher, {
    publicationAgeDays: 0,
    observe: false,
  });
  directories.push(f.file.directory);
  let hashed = false;
  f.context.files.checkpoint = async (phase) => {
    if (phase === "native-archive-cleanup-hashing") hashed = true;
  };
  expect(f.first.expiresAt.getTime()).toBeGreaterThan(Date.now());
  expect(await f.activities.cleanupNativeArchiveFiles(f.input)).toEqual({
    status: "protected",
    reason: "archive_rollback_window_incomplete",
  });
  expect(hashed).toBe(false);
  const row = await f.db.nativeArchiveCleanupContinuation.findUniqueOrThrow({
    where: { id: f.continuation.id },
  });
  expect(row).toMatchObject({
    state: "protected",
    executionEvidence: null,
    completion: null,
  });
  const asset = await f.db.libraryAsset.findUniqueOrThrow({
    where: { id: f.first.assetId },
  });
  expect(await readFile(nativeLocalPath(f.context, asset.path), "utf8")).toBe(
    f.publications[0]?.content,
  );
  expect(
    await f.db.upgradeCleanup.findUniqueOrThrow({ where: { id: f.first.id } }),
  ).toEqual(f.first);
});

test("an unowned current-file subtitle neighbor yields visible protection without unlinking", async () => {
  const f = await fixture();
  const current = nativeLocalPath(f.context, f.canonicalPath);
  await writeFile(
    current.replace(/\.[^.]+$/u, ".unowned.srt"),
    "Foreign neighboring subtitle",
  );
  expect(await f.activities.cleanupNativeArchiveFiles(f.input)).toEqual({
    status: "protected",
    reason: "archive_physical_identity_protected",
  });
  expect(
    await f.db.nativeArchiveCleanupContinuation.findUniqueOrThrow({
      where: { id: f.continuation.id },
    }),
  ).toMatchObject({
    state: "protected",
    executionEvidence: null,
    completion: null,
  });
  const asset = await f.db.libraryAsset.findUniqueOrThrow({
    where: { id: f.first.assetId },
  });
  expect(await readFile(nativeLocalPath(f.context, asset.path), "utf8")).toBe(
    f.publications[0]?.content,
  );
});

test("current immutable network evidence becomes typed protection when its clock window is no longer valid", async () => {
  const f = await fixture();
  const observation = await f.db.nativeRecoveryObservation.findFirstOrThrow({
    where: { planId: f.planId, kind: "archive_cleanup_network" },
  });
  const network = NativeArchiveCleanupNetworkEvidenceSchema.parse(
    observation.evidence,
  );
  expect(() => assertArchiveCleanupFresh(network)).not.toThrow();
  try {
    vi.useFakeTimers({ toFake: ["Date"] }).setSystemTime(
      Date.parse(network.expiresAt) + 1,
    );
    expect(() => assertArchiveCleanupFresh(network)).toThrow(
      expect.objectContaining({ reason: "archive_network_evidence_expired" }),
    );
    vi.setSystemTime(Date.parse(network.capturedAt) - 1);
    expect(() => assertArchiveCleanupFresh(network)).toThrow(
      expect.objectContaining({ reason: "archive_network_evidence_expired" }),
    );
  } finally {
    vi.useRealTimers();
  }
  expect(
    await f.db.nativeRecoveryObservation.findUniqueOrThrow({
      where: { id: observation.id },
    }),
  ).toEqual(observation);
});

test.each(["owner", "replacement"] as const)(
  "%s authority changing after observation returns a visible protected continuation",
  async (condition) => {
    const f = await fixture();
    if (condition === "owner")
      await f.db.mediaUser.update({
        where: { id: f.prior.actor.id },
        data: { role: "member", version: { increment: 1 } },
      });
    else {
      await reserveArchiveCurrentSubtitle(f, harness.cipher);
      expect(
        await f.db.subtitleReplacement.count({
          where: {
            assetId: f.published.entry.assetId,
            reservationActive: true,
          },
        }),
      ).toBe(1);
    }
    expect(await f.activities.cleanupNativeArchiveFiles(f.input)).toEqual({
      status: "protected",
      reason:
        condition === "owner"
          ? "archive_owner_changed"
          : "archive_subtitle_replacement_unsettled",
    });
    expect(
      await f.db.nativeArchiveCleanupContinuation.findUniqueOrThrow({
        where: { id: f.continuation.id },
      }),
    ).toMatchObject({
      state: "protected",
      executionEvidence: null,
      completion: null,
    });
    const asset = await f.db.libraryAsset.findUniqueOrThrow({
      where: { id: f.first.assetId },
    });
    expect(await readFile(nativeLocalPath(f.context, asset.path), "utf8")).toBe(
      f.publications[0]?.content,
    );
  },
);
