import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  agentHeaders,
  createClient,
  humanHeaders,
  publish,
  type TestClient,
} from "#testing/client.ts";
import { createMigratedDatabase } from "#testing/database.ts";
import { createTestRuntime, type TestRuntime } from "#testing/runtime.ts";
import { statusOf, textOf } from "#testing/response.ts";

const DAY = 86_400_000;
const old = (days: number) => new Date(Date.now() - days * DAY);
const Cleanup = z.object({
  status: z.string(),
  expiredSessions: z.number(),
  purgedBoards: z.number(),
  deletedBlobs: z.number(),
  prunedEvents: z.number(),
  more: z.boolean(),
});

let database: Awaited<ReturnType<typeof createMigratedDatabase>>;
let runtime: TestRuntime;
let agent: TestClient;
let human: TestClient;

beforeAll(async () => {
  database = await createMigratedDatabase();
  runtime = await createTestRuntime({
    db: database.db,
    databaseUrl: database.url,
    flagValues: { "artifacts-feedback-settle-seconds": 0 },
  });
  agent = createClient(runtime, agentHeaders("maintainer"));
  human = createClient(runtime, humanHeaders());
});
afterAll(async () => {
  await database.close();
});

async function cleanup(target: TestRuntime = runtime) {
  const response = await target.call("internal", "/trpc/maintenance.cleanup", {
    method: "POST",
    login: null,
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  expect(response.status).toBe(200);
  const body = z
    .object({ result: z.object({ data: Cleanup }) })
    .parse(await response.json());
  return body.result.data;
}

const page = (label: string) => ({
  "index.html": {
    body: `<p>${label} ${crypto.randomUUID()}</p>`,
    mediaType: "text/html",
  },
});

async function contentPath(versionId: string) {
  const view = z
    .object({ contentUrl: z.string().nullable() })
    .parse(await human.query("versions.get", { id: versionId }));
  return new URL(view.contentUrl ?? "https://x.invalid/").pathname;
}

describe("cleanup", () => {
  it("is reachable on the internal host only", async () => {
    const onApp = await runtime.call("app", "/trpc/maintenance.cleanup", {
      method: "POST",
      headers: { ...humanHeaders(), "Content-Type": "application/json" },
      body: "{}",
    });
    expect(onApp.status).toBe(404);
    const first = await cleanup();
    expect(first.status).toBe("ok");
  });

  it("expires upload sessions after their TTL and keeps committed ones", async () => {
    const committed = await publish(agent, page("committed"), {
      board: "sessions",
    });
    const open = await agent.json("/api/uploads", {
      body: {
        board: "sessions",
        title: "T",
        entryPath: "a.txt",
        idempotencyKey: crypto.randomUUID(),
        expectedCurrentVersionId: null,
        files: [
          {
            path: "a.txt",
            size: 1,
            sha256: "b".repeat(64),
            mediaType: "text/plain",
          },
        ],
      },
    });
    const uploadId = z.object({ uploadId: z.string() }).parse(open).uploadId;
    await database.db.uploadSession.updateMany({
      where: { id: { in: [uploadId, committed.created.uploadId] } },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const result = await cleanup();
    expect(result.expiredSessions).toBe(1);
    expect(
      await database.db.uploadSession.count({ where: { id: uploadId } }),
    ).toBe(0);
    expect(
      await database.db.uploadSession.count({
        where: { id: committed.created.uploadId },
      }),
    ).toBe(1);
  });

  it("purges idle and archived boards, but never a kept one, and keeps threads", async () => {
    const idle = await publish(agent, page("idle"), { board: "idle-board" });
    const archived = await publish(agent, page("archived"), {
      board: "archived-board",
    });
    const kept = await publish(agent, page("kept"), { board: "kept-board" });
    const fresh = await publish(agent, page("fresh"), { board: "fresh-board" });
    await human.mutate("boards.setKeep", { slug: "kept-board", keep: true });
    await human.mutate("boards.archive", {
      slug: "archived-board",
      archived: true,
    });
    const thread = z.object({ id: z.string() }).parse(
      await human.mutate("threads.create", {
        board: "idle-board",
        artifactId: idle.committed.artifactId,
        versionId: idle.committed.versionId,
        anchor: { type: "general" },
        body: "history that must survive",
      }),
    );
    await database.db.board.update({
      where: { slug: "idle-board" },
      data: { lastActivityAt: old(91) },
    });
    await database.db.board.update({
      where: { slug: "archived-board" },
      data: { archivedAt: old(8) },
    });
    await database.db.board.update({
      where: { slug: "kept-board" },
      data: { lastActivityAt: old(400), archivedAt: old(400) },
    });

    const idlePath = await contentPath(idle.committed.versionId);
    const keptPath = await contentPath(kept.committed.versionId);
    expect(await statusOf(runtime.call("content", idlePath))).toBe(200);
    const result = await cleanup();
    expect(result.purgedBoards).toBe(2);

    expect(await statusOf(runtime.call("content", idlePath))).toBe(404);
    expect(await statusOf(runtime.call("content", keptPath))).toBe(200);
    expect(
      await statusOf(
        runtime.call("content", await contentPath(fresh.committed.versionId)),
      ),
    ).toBe(200);
    const board = await database.db.board.findUniqueOrThrow({
      where: { slug: "idle-board" },
    });
    expect(board.expiredAt).not.toBeNull();
    const purged = await database.db.version.findUniqueOrThrow({
      where: { id: idle.committed.versionId },
    });
    expect(purged.purgedAt).not.toBeNull();
    expect(
      await database.db.versionFile.count({
        where: { versionId: idle.committed.versionId },
      }),
    ).toBe(0);
    expect(
      await database.db.versionFile.count({
        where: { versionId: archived.committed.versionId },
      }),
    ).toBe(0);
    expect(
      await database.db.versionFile.count({
        where: { versionId: kept.committed.versionId },
      }),
    ).toBe(1);
    expect(await database.db.thread.count({ where: { id: thread.id } })).toBe(
      1,
    );
    expect(
      await database.db.comment.count({ where: { threadId: thread.id } }),
    ).toBe(1);
    const again = await cleanup();
    expect(again.purgedBoards).toBe(0);
    const summary = z
      .object({ board: z.object({ expiresAt: z.string().nullable() }) })
      .parse(await human.query("boards.get", { slug: "kept-board" }));
    expect(summary.board.expiresAt).toBeNull();
  });
});

describe("orphan object sweep", () => {
  it("deletes old objects no Blob row names, and only those", async () => {
    const orphan = await publish(agent, page("referenced"), { board: "sweep" });
    const file = await database.db.versionFile.findFirstOrThrow({
      where: { versionId: orphan.committed.versionId },
      include: { blob: true },
    });
    runtime.store.setModified(file.blob.storageKey, old(5));
    runtime.store.put("objects/dead-upload-old", new Uint8Array([1]));
    runtime.store.setModified("objects/dead-upload-old", old(2));
    runtime.store.put("objects/in-flight-upload", new Uint8Array([2]));
    const result = await cleanup();
    expect(result.deletedBlobs).toBeGreaterThanOrEqual(1);
    const keys = runtime.store.keys();
    expect(keys).not.toContain("objects/dead-upload-old");
    expect(keys).toContain("objects/in-flight-upload");
    expect(keys).toContain(file.blob.storageKey);
  });

  it("pages through a large bucket across runs", async () => {
    for (let index = 0; index < 1100; index += 1) {
      const key = `objects/bulk-${String(index).padStart(5, "0")}`;
      runtime.store.put(key, new Uint8Array([1]));
      runtime.store.setModified(key, old(3));
    }
    let runs = 0;
    for (;;) {
      runs += 1;
      const result = await cleanup();
      if (!result.more || runs > 10) break;
    }
    expect(runs).toBeGreaterThan(1);
    expect(
      runtime.store.keys().filter((key) => key.startsWith("objects/bulk-")),
    ).toEqual([]);
  });
});

describe("cleanup of blobs and events", () => {
  it("deletes unreferenced blobs after the grace period, row first and then the object", async () => {
    const orphan = await publish(agent, page("orphan"), {
      board: "blob-board",
    });
    const files = await database.db.versionFile.findMany({
      where: { versionId: orphan.committed.versionId },
    });
    const blobs = await database.db.blob.findMany({
      where: { sha256: { in: files.map((file) => file.sha256) } },
    });
    expect(blobs).toHaveLength(1);
    const blob = blobs[0];
    if (blob === undefined) throw new Error("no blob");
    await database.db.blob.update({
      where: { sha256: blob.sha256 },
      data: { createdAt: new Date(Date.now() - 2 * DAY) },
    });
    const early = await cleanup();
    expect(early.deletedBlobs).toBe(0);
    expect(runtime.store.keys()).toContain(blob.storageKey);

    await database.db.versionFile.deleteMany({
      where: { versionId: orphan.committed.versionId },
    });
    await database.db.uploadFile.deleteMany({
      where: { uploadId: orphan.created.uploadId },
    });
    const result = await cleanup();
    expect(result.deletedBlobs).toBeGreaterThanOrEqual(1);
    expect(
      await database.db.blob.count({ where: { sha256: blob.sha256 } }),
    ).toBe(0);
    expect(runtime.store.keys()).not.toContain(blob.storageKey);
  });

  it("does not delete a blob a concurrent commit is referencing", async () => {
    const seed = await publish(agent, page("contended"), { board: "gc-race" });
    const [file] = await database.db.versionFile.findMany({
      where: { versionId: seed.committed.versionId },
    });
    if (file === undefined) throw new Error("no file");
    const blob = await database.db.blob.findUniqueOrThrow({
      where: { sha256: file.sha256 },
    });
    await database.db.versionFile.deleteMany({
      where: { versionId: seed.committed.versionId },
    });
    await database.db.uploadFile.deleteMany({
      where: { uploadId: seed.created.uploadId },
    });
    await database.db.blob.update({
      where: { sha256: blob.sha256 },
      data: { createdAt: new Date(Date.now() - 2 * DAY) },
    });

    // A commit in flight: its VersionFile insert holds a lock on the blob row.
    const held = Promise.withResolvers<undefined>();
    const inserted = Promise.withResolvers<undefined>();
    const committing = database.db.$transaction(async (tx) => {
      await tx.versionFile.create({
        data: {
          versionId: seed.committed.versionId,
          path: "index.html",
          sha256: blob.sha256,
          mediaType: "text/html",
        },
      });
      inserted.resolve(undefined);
      await held.promise;
    });
    await inserted.promise;
    const collecting = cleanup();
    await Bun.sleep(200);
    held.resolve(undefined);
    await committing;
    const result = await collecting;
    expect(result.deletedBlobs).toBe(0);
    expect(
      await database.db.blob.count({ where: { sha256: blob.sha256 } }),
    ).toBe(1);
    expect(runtime.store.keys()).toContain(blob.storageKey);
    expect(
      await database.db.versionFile.count({
        where: { versionId: seed.committed.versionId },
      }),
    ).toBe(1);
  });

  it("prunes events past retention and records the last successful run", async () => {
    const actor = await database.db.actor.findFirstOrThrow({
      where: { key: "agent:maintainer" },
    });
    await database.db.event.create({
      data: {
        boardId: null,
        kind: "test.old",
        entityId: "old",
        actorId: actor.id,
        requestId: "r",
        occurredAt: new Date(Date.now() - 40 * DAY),
        payload: {},
      },
    });
    const result = await cleanup();
    expect(result.prunedEvents).toBeGreaterThanOrEqual(1);
    expect(await database.db.event.count({ where: { kind: "test.old" } })).toBe(
      0,
    );
    const metrics = await textOf(
      runtime.call("internal", "/metrics", { login: null }),
    );
    const stamp =
      /artifacts_cleanup_last_success_timestamp_seconds (\d+)/u.exec(
        metrics,
      )?.[1] ?? "0";
    expect(Number(stamp)).toBeGreaterThan(Date.now() / 1000 - 60);
    expect(metrics).toContain("artifacts_undelivered_comments");
    expect(metrics).toContain("artifacts_oldest_unhandled_seconds");
  });

  it("reports paused and changes nothing while the flag is off", async () => {
    const paused = await createTestRuntime({
      db: database.db,
      flagValues: { "artifacts-enabled": false },
    });
    expect(await cleanup(paused)).toEqual({
      status: "paused",
      expiredSessions: 0,
      purgedBoards: 0,
      deletedBlobs: 0,
      prunedEvents: 0,
      more: false,
    });
  });
});
