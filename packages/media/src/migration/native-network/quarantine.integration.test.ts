import { afterAll, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { automationTestHarness } from "#testing/automation.ts";
import { nativeQuarantineFixture } from "#automation/native-quarantine/test-fixture.ts";
import { NativeQuarantineNetworkEvidenceSchema } from "#shared/native-recovery/quarantine.ts";
import {
  createNativeQuarantineObserver,
  type NativeQuarantineObserverContext,
} from "./quarantine.ts";
import { refreshStorageAuthorities } from "#infrastructure/handoff/storage-observer.ts";
import { resolveNativeStorageRoots } from "#infrastructure/native-recovery/storage-provenance.ts";
import { NativeStorageAuthoritySchema } from "#shared/canonical-storage.ts";

const harness = automationTestHarness();
const directories: string[] = [];
afterAll(async () => {
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});
async function fixture() {
  const result = await nativeQuarantineFixture(
    harness.database(),
    harness.context().cipher,
  );
  directories.push(result.file.directory);
  return result;
}

test("committed quarantine network observation proves absence without watched or ownership authority", async () => {
  const f = await fixture();
  await f.observe();
  const row = await f.db.nativeRecoveryObservation.findFirstOrThrow({
    where: { planId: f.planId, kind: "network" },
  });
  const proof = NativeQuarantineNetworkEvidenceSchema.parse(row.evidence);
  expect(proof.plex).toEqual([
    expect.objectContaining({
      mediaId: f.file.media.id,
      state: "quarantined_absent",
      activePlayback: false,
      canonicalPath: f.canonicalPath,
    }),
  ]);
  expect(
    await f.db.libraryAsset.findUniqueOrThrow({ where: { id: f.asset.id } }),
  ).toMatchObject({ state: "quarantined", ownershipEpoch: 0 });
  expect(
    await f.db.nativeRecoveryReceipt.count({ where: { planId: f.planId } }),
  ).toBe(0);
});

test.each([
  "part",
  "session",
  "unknown-session",
  "incomplete",
  "duplicate",
  "scope",
  "pvc",
] as const)(
  "quarantine observer protects %s evidence before recording authority",
  async (kind) => {
    const f = await fixture();
    const context: NativeQuarantineObserverContext = f.observerContext;
    const item = {
      ratingKey: "native",
      title: "Selected quarantined title",
      type: "movie",
      Media: [{ Part: [{ id: 1, file: f.canonicalPath }] }],
    };
    if (kind === "part")
      context.plex.libraryPage = () =>
        Promise.resolve({ total: 1, items: [item] });
    if (kind === "session")
      context.plex.activeSessions = () => Promise.resolve([item]);
    if (kind === "unknown-session")
      context.plex.activeSessions = () =>
        Promise.resolve([
          { ratingKey: "unknown", title: "Unknown stream", type: "movie" },
        ]);
    if (kind === "incomplete")
      context.plex.libraryPage = () => Promise.resolve({ total: 1, items: [] });
    if (kind === "duplicate")
      context.plex.libraryPage = () =>
        Promise.resolve({
          total: 2,
          items: [
            { ...item, Media: [] },
            { ...item, Media: [] },
          ],
        });
    if (kind === "scope")
      context.plex.libraryPage = async () => {
        await f.db.libraryAsset.update({
          where: { id: f.asset.id },
          data: { version: { increment: 1 } },
        });
        return { total: 0, items: [] };
      };
    if (kind === "pvc") {
      const original = context.observer.observeCanonicalMounts.bind(
        context.observer,
      );
      context.observer.observeCanonicalMounts = async (...args) => {
        const evidence = await original(...args);
        return {
          ...evidence,
          mounts: evidence.mounts.map((mount) => ({
            ...mount,
            pvcUid: "unapproved-new-pvc",
          })),
        };
      };
    }
    await expect(
      createNativeQuarantineObserver(context)(f.planId),
    ).rejects.toThrow();
    expect(
      await f.db.nativeRecoveryObservation.count({
        where: { planId: f.planId },
      }),
    ).toBe(0);
  },
);

test("applied quarantine preserves exact storage approval through a same-volume Pod replacement", async () => {
  const f = await fixture();
  const reviewedRoots = await resolveNativeStorageRoots(f.db);
  const continuation = await f.apply();
  const roots = await resolveNativeStorageRoots(f.db);
  // Installation retains the exact approvals consumed by the reviewed plan;
  // discovering a newer receipt must never substitute a different authority.
  expect(roots).toEqual(reviewedRoots);
  const receipt = await f.db.nativeRecoveryReceipt.findUniqueOrThrow({
    where: { planId: f.planId },
  });
  expect(continuation.receiptId).toBe(receipt.id);
  const installed = await f.db.mediaStorageAuthority.findMany();
  expect(installed).toHaveLength(2);
  for (const row of installed)
    expect(
      NativeStorageAuthoritySchema.parse(row.evidence).approvedRoots,
    ).toEqual(reviewedRoots);
  for (const mount of f.prior.canonical.mounts)
    mount.podUid = "replacement-native-quarantine-pod";
  f.observerContext.observer.observeMountBindings = () =>
    Promise.reject(new Error("Native quarantine cannot invent manager mounts"));
  await refreshStorageAuthorities(f.db, f.observerContext.observer);
  expect(await f.db.mediaStorageAuthority.findMany()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        workerPodUid: "replacement-native-quarantine-pod",
        revokedAt: null,
        recoveryEpoch: 1,
      }),
    ]),
  );
  expect(
    await f.db.mediaRuntimeState.findUniqueOrThrow({
      where: { id: "singleton" },
    }),
  ).toMatchObject({ mode: "active", recoveryEpoch: 1 });
  for (const mount of f.prior.canonical.mounts) mount.pvcUid = "foreign-pvc";
  await refreshStorageAuthorities(f.db, f.observerContext.observer);
  expect(
    await f.db.mediaRuntimeState.findUniqueOrThrow({
      where: { id: "singleton" },
    }),
  ).toMatchObject({ mode: "observe", ownershipConfirmed: false });
});
