import { expect, test, vi } from "vitest";
import { automationTestHarness } from "#testing/automation.ts";
import { PrismaNotificationApplication } from "#infrastructure/notification-service.ts";
import { createNotificationActivities } from "#automation/notifications.ts";

const { database, context, fixture, cipher } = automationTestHarness();

test("actual explicit email verification can send in observe mode before the address is verified", async () => {
  const data = await fixture();
  const db = database();
  await db.mediaRuntimeState.update({
    where: { id: "singleton" },
    data: { mode: "observe", ownershipConfirmed: false },
  });
  const service = new PrismaNotificationApplication(db, cipher, null, {
    publicOrigin: "https://media.fixture",
  });
  await service.requestEmailVerification(
    data.user,
    crypto.randomUUID(),
    "verify@example.test",
  );
  const delivery = await db.notificationDelivery.findFirstOrThrow({
    where: { userId: data.user.id, event: { kind: "email_verification" } },
  });
  const ctx = context();
  const notify = vi.fn<typeof ctx.notify>(async (_message, mutation) => {
    if (mutation === undefined)
      throw new Error("Notification mutation guard missing");
    mutation.beforeMutation();
    return { receipt: "fixture-verification-receipt" };
  });
  ctx.notify = notify;
  expect(
    await createNotificationActivities(ctx).deliverMediaNotification({
      operationId: crypto.randomUUID(),
      notificationId: delivery.id,
    }),
  ).toEqual({ status: "accepted", reason: null });
  expect(notify).toHaveBeenCalledOnce();
  expect(notify).toHaveBeenCalledWith(
    expect.objectContaining({
      recipient: "verify@example.test",
      channel: "email",
    }),
    { beforeMutation: expect.any(Function) },
  );
  const user = await db.mediaUser.findUniqueOrThrow({
    where: { id: data.user.id },
  });
  expect(user.emailVerifiedAt).toBeNull();
});

test.each([
  "expired",
  "superseded",
  "restricted",
  "restored",
  "wrong_requester",
])("observe verification protects %s requests", async (change) => {
  const data = await fixture();
  const db = database();
  await db.mediaRuntimeState.update({
    where: { id: "singleton" },
    data: { mode: "observe", ownershipConfirmed: false },
  });
  const service = new PrismaNotificationApplication(db, cipher, null, {
    publicOrigin: "https://media.fixture",
  });
  await service.requestEmailVerification(
    data.user,
    crypto.randomUUID(),
    "verify@example.test",
  );
  const record = await db.emailVerification.findFirstOrThrow({
    where: { userId: data.user.id },
  });
  const delivery = await db.notificationDelivery.findFirstOrThrow({
    where: { userId: data.user.id, event: { kind: "email_verification" } },
    include: { event: true },
  });
  const token = cipher.decrypt(record.encryptedToken, `email:${record.id}`);
  if (change === "expired")
    await db.emailVerification.update({
      where: { id: record.id },
      data: { expiresAt: new Date(0) },
    });
  if (change === "restricted")
    await db.mediaUser.update({
      where: { id: data.user.id },
      data: { restricted: true },
    });
  if (change === "restored")
    await db.mediaRuntimeState.update({
      where: { id: "singleton" },
      data: { recoveryEpoch: { increment: 1 } },
    });
  if (change === "wrong_requester")
    await db.applicationEvent.update({
      where: { id: delivery.eventId },
      data: { actorId: null },
    });
  if (change === "superseded") {
    await db.emailVerification.update({
      where: { id: record.id },
      data: { createdAt: new Date(0) },
    });
    await service.requestEmailVerification(
      data.user,
      crypto.randomUUID(),
      "new@example.test",
    );
  }
  const notify = vi.fn(async () => ({ receipt: "must-not-send" }));
  expect(
    await createNotificationActivities({
      ...context(),
      notify,
    }).deliverMediaNotification({
      operationId: crypto.randomUUID(),
      notificationId: delivery.id,
    }),
  ).toMatchObject({ status: "failed" });
  expect(notify).not.toHaveBeenCalled();
  await expect(service.verifyEmail(data.user, token)).rejects.toMatchObject({
    code: "verification_invalid",
  });
});

test("observe verification is rate limited and its token is consumed exactly once", async () => {
  const data = await fixture();
  const db = database();
  await db.mediaRuntimeState.update({
    where: { id: "singleton" },
    data: { mode: "observe", ownershipConfirmed: false },
  });
  const service = new PrismaNotificationApplication(db, cipher, null, {
    publicOrigin: "https://media.fixture",
  });
  await service.requestEmailVerification(
    data.user,
    crypto.randomUUID(),
    "verify@example.test",
  );
  await expect(
    service.requestEmailVerification(
      data.user,
      crypto.randomUUID(),
      "other@example.test",
    ),
  ).rejects.toMatchObject({ code: "verification_rate_limited" });
  const record = await db.emailVerification.findFirstOrThrow({
    where: { userId: data.user.id },
  });
  const token = cipher.decrypt(record.encryptedToken, `email:${record.id}`);
  expect(await service.verifyEmail(data.user, token)).toEqual({
    status: "completed",
  });
  await expect(service.verifyEmail(data.user, token)).rejects.toMatchObject({
    code: "verification_invalid",
  });
  expect(
    await db.mediaUser.findUniqueOrThrow({ where: { id: data.user.id } }),
  ).toMatchObject({
    email: "verify@example.test",
    emailVerifiedAt: expect.any(Date),
  });
});
