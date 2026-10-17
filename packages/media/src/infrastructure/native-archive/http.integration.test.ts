import { afterAll, expect, test } from "vitest";
import { Hono } from "hono";
import { rm } from "node:fs/promises";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import type { MediaActor } from "#application/auth.ts";
import { MediaError } from "#application/errors.ts";
import { registerNativeRecoveryRoutes } from "#server/native-recovery-routes.ts";
import { PrismaNativeRecovery } from "#infrastructure/native-recovery/service.ts";
import { NativeLifecycleDetailSchema } from "#shared/native-recovery/lifecycle.ts";
import { NativeArchiveInventorySchema } from "#shared/native-recovery/archive-view.ts";
import { nativeArchiveFixture } from "#automation/native-archive/test-fixture.ts";

const harness = automationTestHarness();
const directories: string[] = [];
afterAll(async () => {
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});
test("archive HTTP accepts only cleanup IDs/current review, replays once, and hides inventory/detail from members or restricted owners", async () => {
  const db = harness.database();
  const f = await nativeArchiveFixture(db, harness.cipher, { chain: 2 });
  directories.push(f.file.directory);
  let actor: MediaActor = f.prior.actor;
  const app = new Hono<{
    Variables: { actor: MediaActor; requestId: string };
  }>();
  app.use("*", async (c, next) => {
    c.set("actor", actor);
    c.set("requestId", "archive-test");
    await next();
  });
  app.onError((error, c) =>
    error instanceof MediaError
      ? c.json(
          { error: { code: error.code, message: error.message } },
          error.status,
        )
      : c.json({ error: { code: "internal" } }, 500),
  );
  registerNativeRecoveryRoutes(app, new PrismaNativeRecovery(db));
  const inventory = await app.request("/api/v1/admin/native-recovery/archives");
  expect(inventory.status).toBe(200);
  expect(
    NativeArchiveInventorySchema.parse(await inventory.json()).cleanups.find(
      (item) => item.id === f.first.id,
    )?.reasons,
  ).toEqual([]);
  const key = crypto.randomUUID();
  const input = {
    restoreOperationId: f.restore.id,
    recoveryEpoch: f.runtime.recoveryEpoch,
    runtimeVersion: f.runtime.version,
    activation: "activate",
    cleanupIds: [f.first.id],
  };
  const post = (body: unknown) =>
    app.request("/api/v1/admin/native-recovery/archives", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify(body),
    });
  const invalid = await post({ ...input, assetIds: [f.first.assetId] });
  expect(invalid.status).toBe(400);
  const first = await post(input);
  expect(first.status).toBe(202);
  const response = await first.json();
  const again = await post(input);
  expect(again.status).toBe(202);
  expect(await again.json()).toEqual(response);
  const ids = z
    .object({ nativeRecoveryId: z.uuid(), operationId: z.uuid() })
    .parse(response);
  expect(await db.operation.count({ where: { id: ids.operationId } })).toBe(1);
  await f.prepare();
  await f.apply();
  const detail = await app.request(`/api/v1/admin/native-recovery/${f.planId}`);
  expect(detail.status).toBe(200);
  const parsed = NativeLifecycleDetailSchema.parse(await detail.json());
  expect(parsed.archiveContinuations).toHaveLength(1);
  expect(parsed.archiveContinuations?.[0]?.reasons).toContain(
    "archive_household_reconciliation_required",
  );
  actor = f.file.user;
  for (const url of [
    "/api/v1/admin/native-recovery/archives",
    `/api/v1/admin/native-recovery/${f.planId}`,
  ]) {
    const denied = await app.request(url);
    expect(denied.status).toBe(403);
    expect(await denied.text()).not.toContain(f.canonicalPath);
  }
  actor = f.prior.actor;
  await db.mediaUser.update({
    where: { id: actor.id },
    data: { restricted: true },
  });
  const deniedInventory = await app.request(
    "/api/v1/admin/native-recovery/archives",
  );
  const deniedDetail = await app.request(
    `/api/v1/admin/native-recovery/${f.planId}`,
  );
  expect(deniedInventory.status).toBe(403);
  expect(deniedDetail.status).toBe(403);
});
