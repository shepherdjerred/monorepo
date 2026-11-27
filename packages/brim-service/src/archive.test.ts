import { Database } from "bun:sqlite";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createMemoryObjectStore } from "@shepherdjerred/toolkit/lib/brim/sync/object-store.ts";
import { defaultBrimSyncPaths } from "@shepherdjerred/toolkit/lib/brim/sync/paths.ts";
import { pushArchive } from "@shepherdjerred/toolkit/lib/brim/sync/push.ts";
import { syncRoots } from "@shepherdjerred/toolkit/lib/brim/sync/roots.ts";
import { defaultHistoryPaths } from "@shepherdjerred/toolkit/lib/history/paths.ts";
import { expect, test } from "vitest";
import { openBrimArchive } from "./archive.ts";

const codec = (bytes: Uint8Array) => Promise.resolve(bytes);

test("indexes multiple workstation archives across replay and preserves Cursor row links", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "brim-archive-"));
  const store = createMemoryObjectStore();
  const archive = await openBrimArchive({
    home: path.join(dir, "cluster"),
    store,
    open: codec,
    loadQuotaSnapshots: () => Promise.resolve(null),
  });
  try {
    for (const machineId of ["macbook", "windows"]) {
      const home = path.join(dir, machineId);
      const dbPath = defaultHistoryPaths(home).cursorConversationDb;
      await mkdir(path.dirname(dbPath), { recursive: true });
      const database = new Database(dbPath);
      database.run(
        `CREATE TABLE conversations (fts_rowid INTEGER, source TEXT, scope TEXT, id TEXT, title TEXT, updated_at TEXT)`,
      );
      database.run(`CREATE VIRTUAL TABLE conversation_fts USING fts5(body)`);
      database.run(
        `INSERT INTO conversation_fts (rowid, body) VALUES (762, 'Example indexed chat')`,
      );
      database.run(
        `INSERT INTO conversations VALUES (762, 'local', 'proj', 'same-id', ?, '2026-11-26T09:00:00Z')`,
        [machineId],
      );
      database.close();
      await pushArchive({
        store,
        seal: codec,
        open: null,
        paths: defaultBrimSyncPaths(home),
        machineId,
        displayName: machineId,
        platform: machineId === "windows" ? "win32" : "darwin",
        roots: syncRoots({}, home, true),
      });
    }
    await archive.refresh();
    await archive.refresh();
    expect(archive.status().devices.map((device) => device.machineId)).toEqual([
      "macbook",
      "windows",
    ]);
    const result = await archive.read(
      new Request("http://brim/v1/search?q=Example"),
    );
    expect(result?.status).toBe(200);
    expect(await result?.json()).toMatchObject({
      sessions: [
        expect.objectContaining({ source: "cursor-mirror" }),
        expect.objectContaining({ source: "cursor-mirror" }),
      ],
    });
  } finally {
    archive.close();
    await rm(dir, { recursive: true, force: true });
  }
});
