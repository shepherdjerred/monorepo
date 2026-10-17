import { expect, test } from "vitest";
import { Hono } from "hono";
import type { MediaActor } from "#application/auth.ts";
import { MediaError } from "#application/errors.ts";
import { automationTestHarness } from "#testing/automation.ts";
import { registerCapacityRoutes } from "#server/capacity-routes.ts";
import { PrismaCapacityAdministration } from "./service.ts";
import { readCapacityView } from "./read.ts";
import { renderCapacityMetrics } from "./metrics.ts";
import { capacityFixture, capacityRows } from "./test-support.ts";
import { snapshotHash } from "#migration/profile-import.ts";

const { database } = automationTestHarness();
test("observe-mode read/metrics preserve exact large/zero bytes without authority or collection", async () => {
  const db = database();
  const f = await capacityFixture(db);
  const before = await db.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  expect(await db.mediaStorageAuthority.count()).toBe(0);
  const view = await new PrismaCapacityAdministration(db, () =>
    Promise.resolve(false),
  ).capacity(f.actor);
  expect(view).toMatchObject({
    samplingEnabled: false,
    roles: [
      {
        role: "movies",
        state: "current",
        totalBytes: "9007199254740993",
        availableBytes: "0",
      },
      {
        role: "tv",
        state: "current",
        totalBytes: "9007199254740993",
        availableBytes: "0",
      },
    ],
  });
  expect(renderCapacityMetrics(view)).toContain(
    'media_storage_capacity_available_bytes{role="movies"} 0',
  );
  expect(renderCapacityMetrics(view)).toContain(
    'media_storage_capacity_total_bytes{role="tv"} 9007199254740993',
  );
  expect(JSON.stringify(view)).not.toMatch(
    /pvc|podUid|data\/|binding|inode|device|revision/iu,
  );
  expect(
    await db.mediaRuntimeState.findUniqueOrThrow({
      where: { id: "singleton" },
    }),
  ).toEqual(before);
  expect(await db.mediaStorageAuthority.count()).toBe(0);
});

test("renewed proof preserves original sample time; epoch drift suppresses bytes", async () => {
  const db = database();
  const f = await capacityFixture(db, Date.now() - 180_000);
  const renewals = await capacityRows(Date.now());
  for (const row of renewals)
    await db.mediaCapacityObservation.update({
      where: { role: row.role },
      data: {
        cycleRevision: 2n,
        mountResultRevision: 2n,
        cycleStartedAt: row.cycleStartedAt,
        mountObservedAt: row.mountObservedAt,
        mountCompletedAt: row.mountCompletedAt,
        mountExpiresAt: row.mountExpiresAt,
        mountEvidence: row.mountEvidence,
      },
    });
  const fresh = await f.service.capacity(f.actor);
  expect(fresh.roles.every((row) => row.state === "current")).toBe(true);
  expect(fresh.roles[0]?.sampledAt).toBe(new Date(f.now).toISOString());
  await db.mediaRuntimeState.update({
    where: { id: "singleton" },
    data: { recoveryEpoch: 1 },
  });
  const restored = await f.service.capacity(f.actor);
  expect(
    restored.roles.every(
      (row) => row.state === "old_epoch" && row.availableBytes === null,
    ),
  ).toBe(true);
  expect(renderCapacityMetrics(restored)).not.toMatch(
    /media_storage_capacity_available_bytes\{role/u,
  );
});

test("missing, stale, future, expired and failed observations never fabricate zero capacity", async () => {
  const db = database();
  const f = await capacityFixture(db);
  await db.mediaCapacityObservation.deleteMany();
  const missing = await f.service.capacity(f.actor);
  expect(missing.roles.every((row) => row.state === "missing")).toBe(true);
  await db.mediaCapacityObservation.createMany({ data: f.rows });
  const earlier = new Date(f.now - 301_000);
  await db.mediaCapacityObservation.update({
    where: { role: "movies" },
    data: {
      sampleStartedAt: earlier,
      sampleObservedAt: earlier,
      sampleCompletedAt: earlier,
    },
  });
  const future = new Date(f.now + 30_000);
  await db.mediaCapacityObservation.update({
    where: { role: "tv" },
    data: { sampleObservedAt: future, sampleCompletedAt: future },
  });
  const view = await readCapacityView(db, {
    samplingEnabled: true,
    now: new Date(f.now),
  });
  expect(view.roles.map((row) => row.state)).toEqual(["stale", "future"]);
  expect(view.roles.every((row) => row.availableBytes === null)).toBe(true);
  const expired = await readCapacityView(db, {
    samplingEnabled: true,
    now: new Date(f.now + 121_000),
  });
  expect(expired.roles.every((row) => row.reason === "mount_expired")).toBe(
    true,
  );
  await db.$executeRaw`UPDATE "MediaCapacityObservation" SET "mountOutcome"='unavailable', "mountReason"='mount_observation_failed', "mountObservedAt"=NULL, "mountExpiresAt"=NULL, "mountBinding"=NULL, "mountBindingDigest"=NULL, "mountEvidence"=NULL`;
  const failed = await f.service.capacity(f.actor);
  expect(failed.roles.every((row) => row.state === "unavailable")).toBe(true);
});

test("a new matching mount proof cannot relabel old worker samples", async () => {
  const db = database();
  const f = await capacityFixture(db);
  for (const row of f.rows) {
    const binding = { ...row.mountBinding, workerPodUid: "replacement-worker" };
    const evidence = {
      ...row.mountEvidence,
      mounts: row.mountEvidence.mounts.map((mount) => ({
        ...mount,
        podUid: "replacement-worker",
      })),
    };
    await db.mediaCapacityObservation.update({
      where: { role: row.role },
      data: {
        cycleRevision: 2n,
        mountResultRevision: 2n,
        mountBinding: binding,
        mountBindingDigest: snapshotHash(binding),
        mountEvidence: evidence,
      },
    });
  }
  const result = await f.service.capacity(f.actor);
  expect(
    result.roles.every(
      (row) => row.state === "root_changed" && row.totalBytes === null,
    ),
  ).toBe(true);
  expect(renderCapacityMetrics(result)).not.toMatch(
    /media_storage_capacity_total_bytes\{role/u,
  );
  expect(await db.mediaStorageAuthority.count()).toBe(0);
});

test("actual owner route rechecks current role/restriction and returns no private evidence", async () => {
  const db = database();
  const f = await capacityFixture(db);
  const app = new Hono<{
    Variables: { actor: MediaActor; requestId: string };
  }>();
  app.use(async (c, next) => {
    c.set("actor", f.actor);
    c.set("requestId", "capacity-test");
    await next();
  });
  app.onError((error, c) => {
    if (error instanceof MediaError)
      return c.json({ error: { code: error.code } }, error.status);
    throw error;
  });
  registerCapacityRoutes(app, f.service);
  const response = await app.request("/api/v1/admin/capacity");
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    schemaVersion: 1,
    samplingEnabled: true,
  });
  await db.mediaUser.update({
    where: { id: f.actor.id },
    data: { role: "member" },
  });
  const demoted = await app.request("/api/v1/admin/capacity");
  expect(demoted.status).toBe(403);
  await db.mediaUser.update({
    where: { id: f.actor.id },
    data: { role: "owner", restricted: true },
  });
  const restricted = await app.request("/api/v1/admin/capacity");
  expect(restricted.status).toBe(403);
});

test("required runtime and malformed internal binding fail loudly", async () => {
  const db = database();
  const f = await capacityFixture(db);
  await db.mediaCapacityObservation.update({
    where: { role: "movies" },
    data: { mountBindingDigest: "f".repeat(64) },
  });
  await expect(f.service.capacity(f.actor)).rejects.toThrow(
    "Invalid stored capacity mount evidence",
  );
  await db.mediaRuntimeState.delete({ where: { id: "singleton" } });
  await expect(
    readCapacityView(db, { samplingEnabled: true }),
  ).rejects.toMatchObject({ code: "P2025" });
  await db.mediaRuntimeState.create({ data: { id: "singleton" } });
});
