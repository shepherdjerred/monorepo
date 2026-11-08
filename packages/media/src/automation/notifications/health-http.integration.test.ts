import { Hono } from "hono";
import { expect, test, vi } from "vitest";
import type { MediaActor } from "#application/auth.ts";
import { MediaError } from "#application/errors.ts";
import { registerNotificationActions } from "#server/notification-actions.ts";
import { createNotificationActivities } from "#automation/notifications.ts";
import { IntegrationError } from "#integrations/http.ts";
import { PrismaMediaApplication } from "#infrastructure/media-service.ts";
import { healthHarness } from "./health-fixture.ts";

const health = healthHarness();

test("HTTP retries enforce recipient, version and exact health authority; DTO exposes only sanitized context", async () => {
  const f = await health.setup();
  const delivery = await health.delivery(f.user.id);
  f.ctx.notify = async () => {
    throw new IntegrationError("postal", "authentication");
  };
  await createNotificationActivities(f.ctx).deliverMediaNotification({
    operationId: crypto.randomUUID(),
    notificationId: delivery.id,
  });
  const rejected = await f.db.notificationDelivery.findUniqueOrThrow({
    where: { id: delivery.id },
  });
  let actor: MediaActor = f.user;
  const app = new Hono<{
    Variables: { actor: MediaActor; requestId: string };
  }>();
  app.use("*", async (c, next) => {
    c.set("actor", actor);
    c.set("requestId", crypto.randomUUID());
    await next();
  });
  app.onError((error, c) =>
    error instanceof MediaError
      ? c.json({ code: error.code }, error.status)
      : c.json({ code: "unexpected" }, 500),
  );
  registerNotificationActions(app, f.service);
  const retry = (version: number) =>
    app.request(`/api/v1/notifications/${delivery.id}/retry`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({ expectedVersion: version }),
    });
  actor = await f.db.mediaUser.create({
    data: {
      plexAccountId: crypto.randomUUID(),
      displayName: "Other owner",
      role: "owner",
    },
  });
  const forbidden = await retry(rejected.version);
  expect(forbidden.status).toBe(403);
  actor = f.user;
  const conflict = await retry(rejected.version + 1);
  expect(conflict.status).toBe(409);
  const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 61_000);
  try {
    const queued = await retry(rejected.version);
    expect(queued.status).toBe(202);
  } finally {
    clock.mockRestore();
  }
  await createNotificationActivities(f.ctx).deliverMediaNotification({
    operationId: crypto.randomUUID(),
    notificationId: delivery.id,
  });
  const latest = await f.db.notificationDelivery.findUniqueOrThrow({
    where: { id: delivery.id },
  });
  await f.db.mediaRuntimeState.update({
    where: { id: "singleton" },
    data: { recoveryEpoch: { increment: 1 } },
  });
  const restored = await retry(latest.version);
  expect(await restored.json()).toEqual({
    code: "delivery_protected",
  });
  const items = await new PrismaMediaApplication(f.db, {
    keepDays: 30,
  }).notifications(f.user);
  expect(items.find((item) => item.id === delivery.id)?.event).toEqual({
    mediaId: null,
    kind: "owner_health",
    healthReason: "legacy_writer_authority_revoked",
    healthState: "superseded",
  });
  expect(JSON.stringify(items)).not.toContain("sourceEventId");
  expect(JSON.stringify(items)).not.toContain("evidenceDigest");
});
