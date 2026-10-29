import { expect, test } from "vitest";
import { healthHarness } from "./health-fixture.ts";
import { createNotificationActivities } from "#automation/notifications.ts";

const health = healthHarness();

test.each([
  "epoch",
  "version",
  "activate",
  "restrict",
  "recipient",
  "preference",
] as const)(
  "committed %s change between claim and final send prevents transport",
  async (change) => {
    const f = await health.setup();
    const delivery = await health.delivery(f.user.id);
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const work = createNotificationActivities({
      ...f.ctx,
      checkpoint: async () => {
        entered.resolve(undefined);
        await release.promise;
      },
    }).deliverMediaNotification({
      notificationId: delivery.id,
      operationId: crypto.randomUUID(),
    });
    await entered.promise;
    try {
      if (change === "epoch")
        await f.db.mediaRuntimeState.update({
          where: { id: "singleton" },
          data: { recoveryEpoch: 1 },
        });
      if (change === "version")
        await f.db.mediaRuntimeState.update({
          where: { id: "singleton" },
          data: { version: { increment: 1 } },
        });
      if (change === "activate")
        await f.db.mediaRuntimeState.update({
          where: { id: "singleton" },
          data: { mode: "active", ownershipConfirmed: true },
        });
      if (change === "restrict")
        await f.db.mediaUser.update({
          where: { id: f.user.id },
          data: { restricted: true },
        });
      if (change === "recipient")
        await f.db.mediaUser.update({
          where: { id: f.user.id },
          data: { email: "changed@example.test" },
        });
      if (change === "preference")
        await f.db.notificationPreference.update({
          where: { userId: f.user.id },
          data: { emailEnabled: false },
        });
    } finally {
      release.resolve(undefined);
    }
    expect(await work).toMatchObject({
      status: "failed",
      reason: "authority_changed_before_send",
    });
    expect(f.notify).not.toHaveBeenCalled();
    expect(
      await f.db.notificationDeliveryAttempt.findFirstOrThrow({
        where: { deliveryId: delivery.id },
      }),
    ).toMatchObject({ state: "rejected", recoveryEpoch: 0 });
  },
);

test("runtime and recipient SHARE locks serialize restore, restriction and preference changes through transport acceptance", async () => {
  const f = await health.setup();
  const delivery = await health.delivery(f.user.id);
  const entered = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();
  const work = createNotificationActivities({
    ...f.ctx,
    notify: async () => {
      entered.resolve(undefined);
      await release.promise;
      return { receipt: "locked-receipt" };
    },
  }).deliverMediaNotification({
    notificationId: delivery.id,
    operationId: crypto.randomUUID(),
  });
  await entered.promise;
  try {
    for (const target of ["runtime", "user", "preference"] as const)
      await expect(
        f.db.$transaction(async (tx) => {
          await tx.$executeRaw`SET LOCAL lock_timeout = '100ms'`;
          if (target === "runtime")
            await tx.mediaRuntimeState.update({
              where: { id: "singleton" },
              data: { recoveryEpoch: 1 },
            });
          if (target === "user")
            await tx.mediaUser.update({
              where: { id: f.user.id },
              data: { restricted: true },
            });
          if (target === "preference")
            await tx.notificationPreference.update({
              where: { userId: f.user.id },
              data: { emailEnabled: false },
            });
        }),
      ).rejects.toThrow(/lock timeout/u);
  } finally {
    release.resolve(undefined);
  }
  expect(await work).toEqual({ status: "accepted", reason: null });
});
