import { expect, test } from "vitest";
import { healthHarness } from "./health-fixture.ts";
import { OwnerHealthSchema } from "#shared/notification-authority.ts";
import { createNotificationActivities } from "#automation/notifications.ts";

const health = healthHarness();
test.each([
  "generic",
  "available",
  "warning",
  "missing_source",
  "bad_source",
  "missing_binding",
  "member",
  "restricted",
  "disabled",
  "unverified",
  "discord_unavailable",
  "old_epoch",
  "new_version",
  "active",
] as const)("%s cannot send an owner health notification", async (mode) => {
  const f = await health.setup();
  const d = await health.delivery(f.user.id);
  const proof = OwnerHealthSchema.parse(d.event.payload);
  if (mode === "generic" || mode === "available" || mode === "warning")
    await f.db.applicationEvent.update({
      where: { id: d.eventId },
      data: {
        kind: {
          generic: "system_intervention",
          available: "media_available",
          warning: "retention_warning",
        }[mode],
        payload: { items: [], ownerOnly: true, recoveryEpoch: 0 },
      },
    });
  if (mode === "missing_source")
    await f.db.applicationEvent.delete({ where: { id: proof.sourceEventId } });
  if (mode === "bad_source")
    await f.db.applicationEvent.update({
      where: { id: proof.sourceEventId },
      data: { kind: "untrusted_event" },
    });
  if (mode === "missing_binding")
    await f.db.applicationEvent.update({
      where: { id: d.eventId },
      data: { payload: { reason: proof.reason } },
    });
  if (mode === "member")
    await f.db.mediaUser.update({
      where: { id: f.user.id },
      data: { role: "member" },
    });
  if (mode === "restricted")
    await f.db.mediaUser.update({
      where: { id: f.user.id },
      data: { restricted: true },
    });
  if (mode === "disabled")
    await f.db.notificationPreference.update({
      where: { userId: f.user.id },
      data: { emailEnabled: false },
    });
  if (mode === "unverified")
    await f.db.mediaUser.update({
      where: { id: f.user.id },
      data: { emailVerifiedAt: null },
    });
  if (mode === "discord_unavailable") {
    await f.db.notificationDelivery.update({
      where: { id: d.id },
      data: { channel: "discord" },
    });
    await f.db.mediaUser.update({
      where: { id: f.user.id },
      data: { discordId: "1".repeat(18) },
    });
    await f.db.notificationPreference.update({
      where: { userId: f.user.id },
      data: { discordEnabled: true },
    });
  }
  if (mode === "old_epoch")
    await f.db.mediaRuntimeState.update({
      where: { id: "singleton" },
      data: { recoveryEpoch: 1 },
    });
  if (mode === "new_version")
    await f.db.mediaRuntimeState.update({
      where: { id: "singleton" },
      data: { version: { increment: 1 } },
    });
  if (mode === "active")
    await f.db.mediaRuntimeState.update({
      where: { id: "singleton" },
      data: { mode: "active", ownershipConfirmed: true },
    });
  expect(
    await createNotificationActivities(f.ctx).deliverMediaNotification({
      notificationId: d.id,
      operationId: crypto.randomUUID(),
    }),
  ).toMatchObject({ status: "failed" });
  expect(f.notify).not.toHaveBeenCalled();
});
