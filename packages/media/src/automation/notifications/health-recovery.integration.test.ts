import { expect, test, vi } from "vitest";
import { healthHarness, writerObservation } from "./health-fixture.ts";
import { createNotificationActivities } from "#automation/notifications.ts";
import { IntegrationError } from "#integrations/http.ts";
import { refreshWriterLease } from "#infrastructure/handoff/lease.ts";

const health = healthHarness();

test("accepted receipt survives a failed PG commit and is reconciled in observe without resending", async () => {
  const f = await health.setup();
  const delivery = await health.delivery(f.user.id);
  await f.db.$executeRawUnsafe(
    `CREATE FUNCTION fixture_fail_health_acceptance() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture commit failure'; END $$`,
  );
  await f.db.$executeRawUnsafe(
    `CREATE TRIGGER fixture_fail_health_acceptance BEFORE UPDATE ON "NotificationDelivery" FOR EACH ROW WHEN (NEW.state = 'accepted') EXECUTE FUNCTION fixture_fail_health_acceptance()`,
  );
  const input = {
    notificationId: delivery.id,
    operationId: crypto.randomUUID(),
  };
  try {
    expect(
      await createNotificationActivities(f.ctx).deliverMediaNotification(input),
    ).toMatchObject({ status: "unknown" });
  } finally {
    await f.db.$executeRawUnsafe(
      `DROP TRIGGER fixture_fail_health_acceptance ON "NotificationDelivery"`,
    );
    await f.db.$executeRawUnsafe(
      `DROP FUNCTION fixture_fail_health_acceptance()`,
    );
  }
  const attempt = await f.db.notificationDeliveryAttempt.findFirstOrThrow({
    where: { deliveryId: delivery.id },
  });
  expect(attempt).toMatchObject({
    state: "unknown",
    providerReceipt: "fixture-health-receipt",
    recoveryEpoch: 0,
  });
  f.ctx.reconcileNotification = async () => ({
    status: "delivered",
    recipient: f.user.email,
  });
  expect(
    await createNotificationActivities(f.ctx).deliverMediaNotification(input),
  ).toEqual({ status: "accepted", reason: null });
  expect(f.notify).toHaveBeenCalledOnce();
});

test("unknown outcomes never resend and known rejection requires an explicit current-authority retry", async () => {
  const f = await health.setup();
  const delivery = await health.delivery(f.user.id);
  let sends = 0;
  f.ctx.notify = async () => {
    sends++;
    throw new IntegrationError("postal", "authentication");
  };
  const activity = createNotificationActivities(f.ctx);
  const input = {
    notificationId: delivery.id,
    operationId: crypto.randomUUID(),
  };
  expect(await activity.deliverMediaNotification(input)).toMatchObject({
    status: "failed",
  });
  expect(await activity.deliverMediaNotification(input)).toMatchObject({
    status: "failed",
  });
  const rejected = await f.db.notificationDelivery.findUniqueOrThrow({
    where: { id: delivery.id },
  });
  const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 61_000);
  try {
    await f.service.retryDelivery(
      f.user,
      crypto.randomUUID(),
      delivery.id,
      rejected.version,
    );
  } finally {
    clock.mockRestore();
  }
  f.ctx.notify = async () => {
    sends++;
    throw new IntegrationError("postal", "outcome-unknown");
  };
  expect(await activity.deliverMediaNotification(input)).toMatchObject({
    status: "unknown",
  });
  expect(await activity.deliverMediaNotification(input)).toMatchObject({
    status: "unknown",
  });
  expect(sends).toBe(2);
  const unknown = await f.db.notificationDelivery.findUniqueOrThrow({
    where: { id: delivery.id },
  });
  await expect(
    f.service.retryDelivery(
      f.user,
      crypto.randomUUID(),
      delivery.id,
      unknown.version,
    ),
  ).rejects.toMatchObject({ code: "delivery_conflict" });
});

test.each(["pending", "rejected", "accepted", "unknown"] as const)(
  "restored %s health ledger stays fenced while a fresh revocation can alert",
  async (state) => {
    const f = await health.setup();
    const delivery = await health.delivery(f.user.id);
    const input = {
      notificationId: delivery.id,
      operationId: crypto.randomUUID(),
    };
    let sends = 0;
    f.ctx.notify = async () => {
      sends++;
      if (state === "rejected")
        throw new IntegrationError("postal", "authentication");
      if (state === "unknown")
        throw new IntegrationError("postal", "outcome-unknown");
      return { receipt: "old-health-receipt" };
    };
    if (state !== "pending")
      await createNotificationActivities(f.ctx).deliverMediaNotification(input);
    const historical = await f.db.notificationDelivery.findUniqueOrThrow({
      where: { id: delivery.id },
    });
    const attempts = await f.db.notificationDeliveryAttempt.findMany({
      where: { deliveryId: delivery.id },
    });
    await f.db.mediaRuntimeState.update({
      where: { id: "singleton" },
      data: { recoveryEpoch: 1, version: { increment: 1 } },
    });
    const receipt = vi.fn(async () => ({
      status: "delivered" as const,
      recipient: f.user.email,
    }));
    f.ctx.reconcileNotification = receipt;
    await createNotificationActivities(f.ctx).deliverMediaNotification(input);
    expect(sends).toBe(state === "pending" ? 0 : 1);
    expect(receipt).not.toHaveBeenCalled();
    expect(
      await f.db.notificationDeliveryAttempt.findMany({
        where: { deliveryId: delivery.id },
      }),
    ).toEqual(attempts);
    const preserved = await f.db.notificationDelivery.findUniqueOrThrow({
      where: { id: delivery.id },
    });
    expect(preserved.recoveryEpoch).toBe(0);
    if (state === "rejected")
      await expect(
        f.service.retryDelivery(
          f.user,
          crypto.randomUUID(),
          delivery.id,
          historical.version,
        ),
      ).rejects.toMatchObject({ code: "delivery_protected" });
    if (state === "accepted" || state === "unknown")
      await expect(
        f.service.reconcileDelivery(f.user, crypto.randomUUID(), delivery.id, {
          expectedVersion: historical.version,
        }),
      ).rejects.toMatchObject({ code: "delivery_protected" });
    await f.db.mediaRuntimeState.update({
      where: { id: "singleton" },
      data: {
        mode: "active",
        ownershipConfirmed: true,
        version: { increment: 1 },
      },
    });
    await refreshWriterLease(f.db, async () => writerObservation(false));
    const fresh = await health.delivery(f.user.id);
    expect(fresh.id).not.toBe(delivery.id);
    expect(fresh.recoveryEpoch).toBe(1);
    f.ctx.notify = async () => ({ receipt: "fresh-health-receipt" });
    expect(
      await createNotificationActivities(f.ctx).deliverMediaNotification({
        ...input,
        notificationId: fresh.id,
      }),
    ).toEqual({ status: "accepted", reason: null });
  },
);

test.each(["recipient", "version"] as const)(
  "late accepted receipt after %s change cannot claim current delivery authority",
  async (change) => {
    const f = await health.setup();
    const delivery = await health.delivery(f.user.id);
    const input = {
      notificationId: delivery.id,
      operationId: crypto.randomUUID(),
    };
    await createNotificationActivities(f.ctx).deliverMediaNotification(input);
    const historical = await f.db.notificationDelivery.update({
      where: { id: delivery.id },
      data: { providerStatus: "delivered" },
    });
    if (change === "recipient")
      await f.db.mediaUser.update({
        where: { id: f.user.id },
        data: { email: "new@example.test" },
      });
    else
      await f.db.mediaRuntimeState.update({
        where: { id: "singleton" },
        data: { version: { increment: 1 } },
      });
    const receipt = vi.fn(async () => ({
      status: "delivered" as const,
      recipient: f.user.email,
    }));
    f.ctx.reconcileNotification = receipt;
    expect(
      await createNotificationActivities(f.ctx).deliverMediaNotification(input),
    ).toMatchObject({
      status: "unknown",
      reason:
        change === "recipient"
          ? "receipt_recipient_changed"
          : "owner_health_superseded",
    });
    expect(receipt).not.toHaveBeenCalled();
    expect(
      await f.db.notificationDelivery.findUniqueOrThrow({
        where: { id: delivery.id },
      }),
    ).toEqual(historical);
  },
);
