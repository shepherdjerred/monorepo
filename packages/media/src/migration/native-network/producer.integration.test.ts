import { defaultScope } from "#shared/editions/scope.ts";
import { targetWhere } from "#infrastructure/editions/targets.ts";
import { expect, test } from "vitest";
import { automationTestHarness } from "#testing/automation.ts";
import { createNativeRecoveryObserver } from "./producer.ts";
import { nativeNetworkFixture } from "./test-fixture.ts";
import { NativeRecoveryNetworkEvidenceSchema } from "#shared/native-recovery.ts";

const harness = automationTestHarness();
const fixture = () =>
  nativeNetworkFixture(harness.database(), harness.context().cipher);
test("native network capture uses approved canonical storage without inventing legacy file associations", async () => {
  const f = await fixture();
  f.context.observer.observeMountBindings = () =>
    Promise.reject(new Error("No legacy source aliases in native recovery"));
  const result = await createNativeRecoveryObserver(f.context)(f.nativePlan.id);
  const row = await f.context.db.nativeRecoveryObservation.findUniqueOrThrow({
    where: { id: result.observationId },
  });
  const evidence = NativeRecoveryNetworkEvidenceSchema.parse(row.evidence);
  expect(evidence.plex).toEqual([
    expect.objectContaining({
      mediaId: f.media.id,
      canonicalPath: f.asset.path,
    }),
  ]);
  expect(evidence.mounts.mounts.map((mount) => mount.root)).toEqual([
    "/data/movies",
    "/data/tv",
  ]);
  expect(
    await f.context.db.libraryAsset.findUniqueOrThrow({
      where: { id: f.asset.id },
    }),
  ).toMatchObject({ ownershipEpoch: 0, version: 0 });
  expect(
    await f.context.db.mediaRuntimeState.findUniqueOrThrow({
      where: { id: "singleton" },
    }),
  ).toMatchObject({ mode: "observe", recoveryEpoch: 1 });
  expect(
    await f.context.db.recoveryHold.findUniqueOrThrow({
      where: targetWhere(defaultScope(f.media.id)),
    }),
  ).toMatchObject({ releasedAt: null });
});
test.each(["pvc", "expired", "writers", "version", "coverage"])(
  "native capture protects %s drift before publishing observation",
  async (mode) => {
    const f = await fixture();
    const original = f.context.plex.libraryPage;
    f.context.plex.libraryPage = async (...args) => {
      const result = await original(...args);
      if (mode === "version")
        await f.context.db.mediaRuntimeState.update({
          where: { id: "singleton" },
          data: { version: { increment: 1 } },
        });
      if (mode === "coverage")
        await f.context.db.libraryAsset.update({
          where: { id: f.asset.id },
          data: { version: { increment: 1 } },
        });
      return result;
    };
    if (mode === "pvc") {
      const mount = f.canonical.mounts[0];
      if (!mount) throw new Error("Missing fixture mount");
      mount.pvcUid = "replaced-pvc";
    }
    if (mode === "expired") f.canonical.expiresAt = new Date(0).toISOString();
    if (mode === "writers") {
      const controller = f.quiescence.controllers[0];
      if (!controller) throw new Error("Missing fixture controller");
      controller.desired = 1;
    }
    await expect(
      createNativeRecoveryObserver(f.context)(f.nativePlan.id),
    ).rejects.toThrow();
    expect(
      await f.context.db.nativeRecoveryObservation.count({
        where: { planId: f.nativePlan.id },
      }),
    ).toBe(0);
  },
);
