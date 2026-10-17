import { expect, test, vi } from "vitest";
import {
  healthHarness,
  writerObservation,
  mountObservation,
} from "./health-fixture.ts";
import { refreshWriterLease } from "#infrastructure/handoff/lease.ts";
import { refreshStorageAuthorities } from "#infrastructure/handoff/storage-observer.ts";
import { createOutboxActivities } from "#automation/store.ts";
import { OwnerHealthSchema } from "#shared/notification-authority.ts";
import { createNotificationActivities } from "#automation/notifications.ts";

const health = healthHarness();

test.each(["writer", "storage"] as const)(
  "actual %s revocation atomically queues one current-version alert and dispatches it in observe",
  async (kind) => {
    const f = await health.setup(false);
    const db = f.db;
    if (kind === "writer")
      await refreshWriterLease(db, async () => writerObservation(false));
    else {
      await refreshWriterLease(db, async () => writerObservation(true));
      const mounts = mountObservation();
      for (const binding of mounts.bindings) {
        const data = {
          recoveryEpoch: 0,
          pvcUid: binding.canonical.pvcUid,
          volumeName: binding.canonical.volumeName,
          volumePath: binding.canonical.volumePath,
          workerPodUid: binding.canonical.podUid,
          evidence: mounts,
          observedAt: new Date(),
          expiresAt: new Date(Date.now() + 90_000),
          revokedAt: null,
        };
        await db.mediaStorageAuthority.upsert({
          where: { rootPath: binding.canonical.root },
          create: { rootPath: binding.canonical.root, ...data },
          update: data,
        });
      }
      const drift = {
        ...mounts,
        bindings: mounts.bindings.map((binding) => ({
          ...binding,
          canonical: { ...binding.canonical, pvcUid: "replaced-pvc" },
        })),
      };
      await refreshStorageAuthorities(db, {
        observe: async () => writerObservation(true),
        observeMountBindings: async () => drift,
        observeCanonicalMounts: () =>
          Promise.reject(
            new Error("Legacy fixture has no native storage observation"),
          ),
      });
    }
    const delivery = await health.delivery(f.user.id);
    const proof = OwnerHealthSchema.parse(delivery.event.payload);
    expect(
      await db.mediaRuntimeState.findUniqueOrThrow({
        where: { id: "singleton" },
      }),
    ).toMatchObject({
      mode: "observe",
      ownershipConfirmed: false,
      version: proof.runtimeVersion,
      recoveryEpoch: proof.recoveryEpoch,
    });
    expect(
      await db.applicationEvent.findUniqueOrThrow({
        where: { id: proof.sourceEventId },
      }),
    ).toMatchObject({
      kind:
        kind === "writer"
          ? "legacy_writer_authority_revoked"
          : "media_storage_authority_revoked",
    });
    await refreshWriterLease(db, async () => writerObservation(false));
    expect(
      await db.notificationDelivery.count({
        where: { eventId: delivery.eventId },
      }),
    ).toBe(1);
    const start = vi.fn(() => Promise.resolve());
    await createOutboxActivities(db, start).dispatchMediaOutbox();
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowType: "deliverMediaNotificationWorkflow",
        input: expect.objectContaining({ notificationId: delivery.id }),
      }),
    );
    expect(
      await createNotificationActivities(f.ctx).deliverMediaNotification({
        notificationId: delivery.id,
        operationId: crypto.randomUUID(),
      }),
    ).toEqual({ status: "accepted", reason: null });
    expect(f.notify).toHaveBeenCalledOnce();
    expect(
      await db.notificationDelivery.findUniqueOrThrow({
        where: { id: delivery.id },
      }),
    ).toMatchObject({
      state: "accepted",
      providerReceipt: "fixture-health-receipt",
    });
  },
);

test("notification insert failure rolls back revocation, source event, delivery and outbox", async () => {
  const f = await health.setup(false);
  const before = await f.db.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  await f.db.$executeRawUnsafe(
    `CREATE FUNCTION fixture_reject_health_delivery() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture delivery failure'; END $$`,
  );
  await f.db.$executeRawUnsafe(
    `CREATE TRIGGER fixture_reject_health_delivery BEFORE INSERT ON "NotificationDelivery" FOR EACH ROW EXECUTE FUNCTION fixture_reject_health_delivery()`,
  );
  try {
    await expect(
      refreshWriterLease(f.db, async () => writerObservation(false)),
    ).rejects.toThrow();
  } finally {
    await f.db.$executeRawUnsafe(
      `DROP TRIGGER fixture_reject_health_delivery ON "NotificationDelivery"`,
    );
    await f.db.$executeRawUnsafe(
      `DROP FUNCTION fixture_reject_health_delivery()`,
    );
  }
  expect(
    await f.db.mediaRuntimeState.findUniqueOrThrow({
      where: { id: "singleton" },
    }),
  ).toEqual(before);
  expect(
    await f.db.applicationEvent.count({
      where: {
        kind: "owner_health",
        payload: { path: ["runtimeVersion"], equals: before.version + 1 },
      },
    }),
  ).toBe(0);
  expect(
    await f.db.notificationDelivery.count({ where: { userId: f.user.id } }),
  ).toBe(0);
});

test("missing eligible personal channels records unavailability instead of a successful delivery", async () => {
  const f = await health.setup(false);
  await f.db.notificationPreference.update({
    where: { userId: f.user.id },
    data: { emailEnabled: false },
  });
  await refreshWriterLease(f.db, async () => writerObservation(false));
  expect(
    await f.db.notificationDelivery.count({
      where: { userId: f.user.id, event: { kind: "owner_health" } },
    }),
  ).toBe(0);
  expect(
    await f.db.applicationEvent.findFirst({
      where: { kind: "owner_health_delivery_unavailable" },
      orderBy: { createdAt: "desc" },
    }),
  ).toMatchObject({
    payload: expect.objectContaining({
      reason: "no_eligible_personal_channels",
    }),
  });
});
