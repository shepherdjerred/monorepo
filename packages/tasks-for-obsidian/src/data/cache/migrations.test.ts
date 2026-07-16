import { describe, expect, test } from "bun:test";

import { CommandSchema } from "../sync/commands";
import {
  CURRENT_SCHEMA_VERSION,
  type MigrationStorage,
  migrateV1Queue,
  runMigrations,
} from "./migrations";

const clock = () => 1_750_000_000_000;

describe("migrateV1Queue", () => {
  test("converts every v1 mutation type to a valid v2 command", () => {
    const v1 = JSON.stringify([
      { id: "a", timestamp: 100, type: "create", payload: { title: "New" } },
      {
        id: "b",
        timestamp: 200,
        type: "update",
        taskId: "TaskNotes/x.md",
        payload: { title: "Renamed" },
      },
      { id: "c", timestamp: 300, type: "delete", taskId: "TaskNotes/y.md" },
      {
        id: "d",
        timestamp: 400,
        type: "toggle_status",
        taskId: "TaskNotes/z.md",
        payload: { status: "done" },
      },
      {
        id: "e",
        timestamp: new Date("2026-07-03T12:00:00").getTime(),
        type: "complete_instance",
        taskId: "TaskNotes/r.md",
      },
    ]);
    const commands = migrateV1Queue(v1, clock);
    expect(commands).toHaveLength(5);
    // all valid v2 commands
    for (const c of commands)
      expect(CommandSchema.safeParse(c).success).toBe(true);

    const types = commands.map((c) => c.type);
    expect(types).toEqual([
      "create",
      "update",
      "delete",
      "set_status",
      "set_instance_complete",
    ]);

    const setStatus = commands[3];
    expect(setStatus?.type === "set_status" && setStatus.status).toBe("done");

    const instance = commands[4];
    expect(instance?.type === "set_instance_complete" && instance.date).toBe(
      "2026-07-03",
    );
    expect(
      instance?.type === "set_instance_complete" && instance.completed,
    ).toBe(true);
  });

  test("drops unparseable entries, keeps the rest", () => {
    const v1 = JSON.stringify([
      { garbage: true },
      { id: "b", timestamp: 200, type: "delete", taskId: "TaskNotes/y.md" },
    ]);
    const commands = migrateV1Queue(v1, clock);
    expect(commands).toHaveLength(1);
    expect(commands[0]?.type).toBe("delete");
  });

  test("handles empty / null / malformed input", () => {
    expect(migrateV1Queue(null, clock)).toEqual([]);
    expect(migrateV1Queue("not json", clock)).toEqual([]);
    expect(migrateV1Queue("{}", clock)).toEqual([]);
  });
});

function memoryMigrationStorage(
  initial: {
    version?: number;
    legacy?: string | null;
    v2?: string | null;
  } = {},
): MigrationStorage & { state: () => { version: number; v2: string | null } } {
  let version = initial.version ?? 0;
  let legacy = initial.legacy ?? null;
  let v2 = initial.v2 ?? null;
  return {
    getSchemaVersion: () => Promise.resolve(version),
    setSchemaVersion: (v) => {
      version = v;
      return Promise.resolve();
    },
    getLegacyQueue: () => Promise.resolve(legacy),
    removeLegacyQueue: () => {
      legacy = null;
      return Promise.resolve();
    },
    getQueueV2: () => Promise.resolve(v2),
    setQueueV2: (data) => {
      v2 = data;
      return Promise.resolve();
    },
    state: () => ({ version, v2 }),
  };
}

describe("runMigrations", () => {
  test("v0 → v2 converts the legacy queue and bumps the version", async () => {
    const storage = memoryMigrationStorage({
      legacy: JSON.stringify([
        { id: "a", timestamp: 100, type: "delete", taskId: "TaskNotes/x.md" },
      ]),
    });
    await runMigrations(storage, clock);
    const { version, v2 } = storage.state();
    expect(version).toBe(CURRENT_SCHEMA_VERSION);
    expect(v2).not.toBeNull();
    expect(JSON.parse(v2 ?? "[]")).toHaveLength(1);
  });

  test("is idempotent — a second run does nothing", async () => {
    const storage = memoryMigrationStorage({
      legacy: JSON.stringify([
        { id: "a", timestamp: 100, type: "delete", taskId: "TaskNotes/x.md" },
      ]),
    });
    await runMigrations(storage, clock);
    const afterFirst = storage.state().v2;
    await runMigrations(storage, clock);
    expect(storage.state().v2).toBe(afterFirst);
  });

  test("already-current version is a no-op", async () => {
    const storage = memoryMigrationStorage({
      version: CURRENT_SCHEMA_VERSION,
      legacy: JSON.stringify([{ bogus: true }]),
    });
    await runMigrations(storage, clock);
    expect(storage.state().v2).toBeNull();
  });
});
