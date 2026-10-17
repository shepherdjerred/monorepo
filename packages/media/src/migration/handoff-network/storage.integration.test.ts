import { expect, test } from "vitest";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { refreshStorageAuthorities } from "#infrastructure/handoff/storage-observer.ts";
import { networkFixture } from "./test-fixture.ts";
import { createHandoffNetworkProducer } from "./producer.ts";
import { HandoffNetworkEvidenceSchema } from "#shared/handoff.ts";
import { MountEvidenceSchema } from "#shared/legacy-observer.ts";

const harness = automationTestHarness();
async function fixture() {
  const resultFixture = await networkFixture(
    harness.database(),
    harness.context().cipher,
  );
  const { context, plan, quiescence } = resultFixture;
  const result = await createHandoffNetworkProducer(context)(plan.id);
  const row = await context.db.mediaHandoffObservation.findUniqueOrThrow({
    where: { id: result.observationId },
  });
  const evidence = HandoffNetworkEvidenceSchema.parse(row.evidence);
  await context.db.mediaStorageAuthority.deleteMany();
  const serialized = JSON.stringify(evidence.mounts);
  for (const binding of evidence.mounts.bindings) {
    const mount = binding.canonical;
    await context.db.mediaStorageAuthority.create({
      data: {
        rootPath: mount.root,
        recoveryEpoch: 0,
        pvcUid: mount.pvcUid,
        volumeName: mount.volumeName,
        volumePath: mount.volumePath,
        workerPodUid: mount.podUid,
        evidence: z.record(z.string(), z.json()).parse(JSON.parse(serialized)),
        observedAt: new Date(evidence.mounts.capturedAt),
        expiresAt: new Date(evidence.mounts.expiresAt),
      },
    });
  }
  const lease = {
    recoveryEpoch: 0,
    targetsDigest: quiescence.targetsDigest,
    configurationDigest: quiescence.configurationDigest,
    observation: quiescence,
    observedAt: new Date(quiescence.capturedAt),
    expiresAt: new Date(quiescence.expiresAt),
    revokedAt: null,
  };
  await context.db.legacyWriterLease.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", ...lease },
    update: lease,
  });
  await context.db.mediaRuntimeState.update({
    where: { id: "singleton" },
    data: { mode: "active", ownershipConfirmed: true },
  });
  return resultFixture;
}
test("replacement files Pod on identical storage refreshes authority without changing epoch", async () => {
  const { context } = await fixture();
  const original = context.observer.observeMountBindings.bind(context.observer);
  context.observer.observeMountBindings = async (...args) => {
    const result = await original(...args);
    for (const binding of result.bindings)
      binding.canonical.podUid = "replacement-pod";
    return result;
  };
  await refreshStorageAuthorities(context.db, context.observer);
  const roots = await context.db.mediaStorageAuthority.findMany();
  expect(
    roots.every(
      (row) => row.workerPodUid === "replacement-pod" && row.revokedAt === null,
    ),
  ).toBe(true);
  expect(
    await context.db.mediaRuntimeState.findUniqueOrThrow({
      where: { id: "singleton" },
    }),
  ).toMatchObject({ mode: "active", recoveryEpoch: 0 });
});
test.each(["pvc", "subpath", "unavailable"])(
  "%s change revokes active authority without adopting the changed mount",
  async (mode) => {
    const { context } = await fixture();
    const original = context.observer.observeMountBindings.bind(
      context.observer,
    );
    context.observer.observeMountBindings = async (...args) => {
      if (mode === "unavailable") throw new Error("Sanitized test failure");
      const result = await original(...args);
      for (const binding of result.bindings) {
        if (mode === "pvc") binding.canonical.pvcUid = "new-pvc";
        else binding.canonical.volumePath = "different/subpath";
      }
      return result;
    };
    await refreshStorageAuthorities(context.db, context.observer);
    const roots = await context.db.mediaStorageAuthority.findMany();
    expect(
      roots.every(
        (row) =>
          row.revokedAt !== null &&
          row.pvcUid !== "new-pvc" &&
          row.volumePath === "",
      ),
    ).toBe(true);
    expect(
      await context.db.mediaRuntimeState.findUniqueOrThrow({
        where: { id: "singleton" },
      }),
    ).toMatchObject({
      mode: "observe",
      ownershipConfirmed: false,
      recoveryEpoch: 0,
    });
  },
);

test.each([
  "uid",
  "generation",
  "spec",
  "source_pvc",
  "source_root",
  "source_subpath",
])(
  "fresh lease cannot authorize %s drift from the approved source binding",
  async (mode) => {
    const { context, quiescence } = await fixture();
    const before = await context.db.mediaStorageAuthority.findUniqueOrThrow({
      where: { rootPath: "/data/movies" },
    });
    const original = context.observer.observeMountBindings.bind(
      context.observer,
    );
    context.observer.observeMountBindings = async (...args) => {
      const result = await original(...args);
      const source = result.bindings.find(
        (binding) => binding.source.deployment === "media-radarr",
      )?.source;
      const controller = quiescence.controllers.find(
        (item) => item.name === "media-radarr",
      );
      if (!source || !controller) throw new Error("Radarr fixture missing");
      if (mode === "uid") source.deploymentUid = "replacement-radarr";
      if (mode === "generation") source.generation += 1;
      if (mode === "spec") source.specDigest = "f".repeat(64);
      if (mode === "source_pvc") source.pvcUid = "replacement-source-pvc";
      if (mode === "source_root") source.root = "/different-source-root";
      if (mode === "source_subpath")
        source.volumePath = "changed-source-subpath";
      controller.uid = source.deploymentUid;
      controller.generation = source.generation;
      controller.observedGeneration = source.generation;
      controller.specDigest = source.specDigest;
      await context.db.legacyWriterLease.update({
        where: { id: "singleton" },
        data: {
          observation: quiescence,
          observedAt: new Date(),
          version: { increment: 1 },
        },
      });
      return result;
    };
    await refreshStorageAuthorities(context.db, context.observer);
    const after = await context.db.mediaStorageAuthority.findUniqueOrThrow({
      where: { rootPath: "/data/movies" },
    });
    expect(after.revokedAt).not.toBeNull();
    expect(after.evidence).toEqual(before.evidence);
    expect(
      MountEvidenceSchema.parse(after.evidence).bindings.find(
        (binding) => binding.source.deployment === "media-radarr",
      )?.source.deploymentUid,
    ).toBe("media-radarr-uid");
    expect(
      await context.db.mediaRuntimeState.findUniqueOrThrow({
        where: { id: "singleton" },
      }),
    ).toMatchObject({
      mode: "observe",
      ownershipConfirmed: false,
      recoveryEpoch: 0,
    });
  },
);
