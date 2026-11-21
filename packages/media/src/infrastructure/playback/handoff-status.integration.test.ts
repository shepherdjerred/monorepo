import { Database as SqliteDatabase } from "bun:sqlite";
import { Hono } from "hono";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import type { MediaActor } from "#application/auth.ts";
import { MediaError } from "#application/errors.ts";
import { refreshWriterLease } from "#infrastructure/handoff/lease.ts";
import { readFrozenPlaybackBytes } from "#migration/personal-state/frozen-playback.ts";
import { registerPlaybackRoutes } from "#server/household/playback.ts";
import {
  ImportPlaybackHistorySchema,
  PlaybackHandoffStatusSchema,
} from "#shared/household/playback.ts";
import { writerObservation } from "#testing/authority.ts";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { playbackHandoffReady } from "./handoff.ts";
import { PrismaPlaybackHistory } from "./service.ts";

let postgres: Awaited<ReturnType<typeof startMediaTestPostgres>>;
beforeAll(async () => {
  postgres = await startMediaTestPostgres();
});
afterAll(async () => {
  await postgres.close();
});

function frozenSnapshot() {
  const source = new SqliteDatabase(":memory:");
  try {
    source.run(`CREATE TABLE sessions (id INTEGER);
      CREATE TABLE session_history (
        id INTEGER PRIMARY KEY, user_id INTEGER, started INTEGER, stopped INTEGER,
        paused_counter INTEGER, view_offset INTEGER, media_type TEXT,
        platform TEXT, player TEXT);
      CREATE TABLE session_history_metadata (
        id INTEGER PRIMARY KEY, rating_key INTEGER, duration INTEGER,
        full_title TEXT, grandparent_title TEXT, live INTEGER);
      CREATE TABLE session_history_media_info (
        id INTEGER PRIMARY KEY, transcode_decision TEXT);
      INSERT INTO session_history VALUES (4,7,1000,1180,30,85000,'movie','Infuse','Living room');
      INSERT INTO session_history_metadata VALUES (4,99,100000,'Historical source title',NULL,0);
      INSERT INTO session_history_media_info VALUES (4,'direct play');`);
    return readFrozenPlaybackBytes(source.serialize());
  } finally {
    source.close();
  }
}

async function fixture() {
  const db = postgres.database;
  await db.legacyWriterLease.deleteMany();
  const server = crypto.randomUUID();
  const owner = await db.mediaUser.create({
    data: {
      plexAccountId: crypto.randomUUID(),
      displayName: "Owner",
      role: "owner",
    },
  });
  const activeSessions = vi.fn(async () => []);
  const ready = vi.fn(
    playbackHandoffReady(db, async () => ({ activeSessions })),
  );
  const service = new PrismaPlaybackHistory(
    db,
    server,
    () => new Date(),
    ready,
  );
  const app = new Hono<{
    Variables: { actor: MediaActor; requestId: string };
  }>();
  // Authentication is the HTTP fixture boundary; the service still reloads
  // the actual database actor before applying the existing owner-only gate.
  app.use(async (c, next) => {
    c.set("actor", owner);
    c.set("requestId", "handoff-status-fixture");
    await next();
  });
  app.onError((error, c) =>
    error instanceof MediaError
      ? c.json({ error: { code: error.code } }, error.status)
      : c.json({ error: { code: "internal_error" } }, 500),
  );
  registerPlaybackRoutes(app, service);
  const read = () => app.request("/api/v1/admin/playback/handoff");
  const status = async () => {
    const response = await read();
    expect(response.status).toBe(200);
    return PlaybackHandoffStatusSchema.parse(await response.json());
  };
  const state = async () => ({
    lease: await db.legacyWriterLease.findUnique({
      where: { id: "singleton" },
    }),
    runtime: await db.mediaRuntimeState.findUniqueOrThrow({
      where: { id: "singleton" },
    }),
    collector: await db.playbackCollector.findUnique({
      where: { serverMachineId: server },
    }),
    sessions: await db.playbackSession.count({
      where: { serverMachineId: server },
    }),
  });
  const importSnapshot = async () => {
    const snapshot = frozenSnapshot();
    const input = ImportPlaybackHistorySchema.parse({
      sourceInstanceId: server,
      serverMachineId: server,
      through: snapshot.through,
      rows: snapshot.rows,
      userBindings: [],
    });
    await service.importHistory(owner, input);
    return snapshot;
  };
  return {
    db,
    server,
    owner,
    service,
    ready,
    activeSessions,
    read,
    status,
    state,
    importSnapshot,
  };
}

async function prepareSeal(f: Awaited<ReturnType<typeof fixture>>) {
  await refreshWriterLease(f.db, async () => writerObservation(true));
  const { legacyWriterObservation } = await f.status();
  if (legacyWriterObservation === null)
    throw new Error("Expected actual stored observation");
  const snapshot = await f.importSnapshot();
  const checkpoint = await f.status();
  return {
    snapshot,
    checkpoint,
    input: {
      sourceInstanceId: f.server,
      through: snapshot.through,
      expectedVersion: checkpoint.version,
      expectedSessions: snapshot.expectedSessions,
      snapshotDigest: snapshot.snapshotDigest,
      quiescenceCapturedAt: legacyWriterObservation.capturedAt,
      inventoryDigest: legacyWriterObservation.inventoryDigest,
    },
  };
}

test("owner GET round-trips only stored observation metadata without changing state or calling readiness", async () => {
  const f = await fixture();
  const observation = writerObservation(true);
  await refreshWriterLease(f.db, async () => observation);
  const before = await f.state();
  const { legacyWriterObservation } = await f.status();
  expect(legacyWriterObservation).toEqual({
    capturedAt: observation.capturedAt,
    expiresAt: observation.expiresAt,
    inventoryDigest: observation.inventoryDigest,
  });
  expect(await f.state()).toEqual(before);
  expect(f.ready).not.toHaveBeenCalled();
  expect(f.activeSessions).not.toHaveBeenCalled();
});

test.each(["member", "demoted", "restricted"] as const)(
  "%s cannot read observation metadata through the owner GET",
  async (access) => {
    const f = await fixture();
    await refreshWriterLease(f.db, async () => writerObservation(true));
    await f.db.mediaUser.update({
      where: { id: f.owner.id },
      data: access === "restricted" ? { restricted: true } : { role: "member" },
    });
    if (access === "member") f.owner.role = "member";
    const before = await f.state();
    const response = await f.read();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: "forbidden" } });
    expect(await f.state()).toEqual(before);
    expect(f.ready).not.toHaveBeenCalled();
  },
);

test("absent or genuinely revoked writer observations return null", async () => {
  const f = await fixture();
  const absent = await f.status();
  expect(absent.legacyWriterObservation).toBeNull();
  await refreshWriterLease(f.db, async () => writerObservation(false));
  const before = await f.state();
  expect(before.lease?.revokedAt).toBeInstanceOf(Date);
  const revoked = await f.status();
  expect(revoked.legacyWriterObservation).toBeNull();
  expect(await f.state()).toEqual(before);
});

test("malformed unrevoked stored evidence fails loudly instead of becoming missing or guessed proof", async () => {
  const f = await fixture();
  await refreshWriterLease(f.db, async () => writerObservation(true));
  await f.db.legacyWriterLease.update({
    where: { id: "singleton" },
    data: {
      observation: { ...writerObservation(true), inventoryDigest: "invalid" },
    },
  });
  const before = await f.state();
  await expect(f.service.handoffStatus(f.owner)).rejects.toMatchObject({
    name: "ZodError",
  });
  const response = await f.read();
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: { code: "internal_error" } });
  expect(await f.state()).toEqual(before);
  expect(f.ready).not.toHaveBeenCalled();
});

test("genuine observation, frozen snapshot and exact imported manifest seal through the unchanged authority", async () => {
  const f = await fixture();
  const { checkpoint, snapshot, input } = await prepareSeal(f);
  expect(checkpoint.collectionStartedAt).toBeNull();
  expect(f.ready).not.toHaveBeenCalled();
  expect(checkpoint.sessions).toBe(snapshot.expectedSessions);
  expect(checkpoint.snapshotDigest).toBe(snapshot.snapshotDigest);
  const sealed = await f.service.sealHandoff(f.owner, input);
  const { collectionStartedAt } = await f.status();
  expect(collectionStartedAt).toBe(sealed.collectionStartedAt);
  expect(f.ready).toHaveBeenCalledTimes(1);
  expect(f.activeSessions).toHaveBeenCalledTimes(1);
});

test("a read-then-refreshed observation cannot authorize seal with stale metadata", async () => {
  const f = await fixture();
  const { input } = await prepareSeal(f);
  await refreshWriterLease(f.db, async () => ({
    ...writerObservation(true),
    inventoryDigest: "c".repeat(64),
  }));
  const refreshed = await f.status();
  expect(refreshed.legacyWriterObservation?.inventoryDigest).toBe(
    "c".repeat(64),
  );
  await expect(f.service.sealHandoff(f.owner, input)).rejects.toMatchObject({
    code: "stale_handoff",
  });
  const { collectionStartedAt } = await f.status();
  expect(collectionStartedAt).toBeNull();
  expect(f.ready).toHaveBeenCalledTimes(1);
  expect(f.activeSessions).toHaveBeenCalledTimes(1);
});
