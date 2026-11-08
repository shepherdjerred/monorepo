import { afterAll, expect, test } from "vitest";
import { Hono } from "hono";
import { rm } from "node:fs/promises";
import { automationTestHarness } from "#testing/automation.ts";
import type { MediaActor } from "#application/auth.ts";
import { PrismaNativeRecovery } from "#infrastructure/native-recovery/service.ts";
import { NativeLifecycleDetailSchema } from "#shared/native-recovery/lifecycle.ts";
import { MediaError } from "#application/errors.ts";
import { registerNativeRecoveryRoutes } from "#server/native-recovery-routes.ts";
import { nativeQuarantineFixture } from "#automation/native-quarantine/test-fixture.ts";

const harness = automationTestHarness();
const directories: string[] = [];
afterAll(async () => {
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});
test("native owner HTTP reads reject members and a newly restricted owner without exposing physical review", async () => {
  const f = await nativeQuarantineFixture(
    harness.database(),
    harness.context().cipher,
  );
  directories.push(f.file.directory);
  let actor: MediaActor = f.prior.actor;
  const app = new Hono<{
    Variables: { actor: MediaActor; requestId: string };
  }>();
  app.use("*", async (c, next) => {
    c.set("actor", actor);
    c.set("requestId", "fixture");
    await next();
  });
  app.onError((error, c) =>
    error instanceof MediaError
      ? c.json(
          { error: { code: error.code, message: error.message } },
          error.status,
        )
      : c.json(
          {
            error: { code: "internal", message: "Unexpected fixture failure" },
          },
          500,
        ),
  );
  registerNativeRecoveryRoutes(
    app,
    new PrismaNativeRecovery(harness.database()),
  );
  const inventory = await app.request("/api/v1/admin/native-recovery");
  const detail = await app.request(`/api/v1/admin/native-recovery/${f.planId}`);
  expect(inventory.status).toBe(200);
  expect(detail.status).toBe(200);
  expect(
    NativeLifecycleDetailSchema.parse(await detail.json()).scope,
  ).toMatchObject({ schemaVersion: 2, lifecycleKind: "committed_quarantine" });
  await f.apply();
  const appliedResponse = await app.request(
    `/api/v1/admin/native-recovery/${f.planId}`,
  );
  const applied = NativeLifecycleDetailSchema.parse(
    await appliedResponse.json(),
  );
  expect(applied.continuations).toHaveLength(1);
  expect(applied.continuations[0]).toMatchObject({
    state: "pending",
    currentPositiveMediaIds: [],
    media: [{ id: f.file.media.id, availability: "quarantined" }],
  });
  actor = f.file.user;
  const denied = await app.request(`/api/v1/admin/native-recovery/${f.planId}`);
  expect(denied.status).toBe(403);
  expect(await denied.text()).not.toContain(f.canonicalPath);
  actor = f.prior.actor;
  await harness.database().mediaUser.update({
    where: { id: actor.id },
    data: { restricted: true, version: { increment: 1 } },
  });
  const restrictedInventory = await app.request(
    "/api/v1/admin/native-recovery",
  );
  const restrictedDetail = await app.request(
    `/api/v1/admin/native-recovery/${f.planId}`,
  );
  expect(restrictedInventory.status).toBe(403);
  expect(restrictedDetail.status).toBe(403);
  expect(
    await harness
      .database()
      .nativeRecoveryReceipt.count({ where: { planId: f.planId } }),
  ).toBe(1);
});
