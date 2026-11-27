import type {
  QueuedCommand,
  SyncResponse,
} from "@shepherdjerred/facet-protocol";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { project, task } from "#workspace/fixtures.ts";
import { LOCAL_INBOX_ID } from "./local-projection.ts";
import type { KeyValueStore } from "./session.ts";
import type { SyncFetch } from "./sync.ts";
import { WorkspaceEngine } from "./workspace-engine.ts";
import {
  LOCAL_WORKSPACE_KEY,
  type WorkspaceRecord,
  type WorkspaceStorage,
} from "./workspace-storage.ts";

function memoryValues(): KeyValueStore {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

function memoryWorkspace(): WorkspaceStorage {
  const records = new Map<string, WorkspaceRecord>();
  return {
    read: (key) => Promise.resolve(structuredClone(records.get(key))),
    update: (keys, transform) => {
      const staged = new Map<string, WorkspaceRecord>();
      for (const key of keys) {
        const record = records.get(key);
        if (record !== undefined) staged.set(key, structuredClone(record));
      }
      transform(staged);
      for (const key of keys) {
        const record = staged.get(key);
        if (record === undefined) records.delete(key);
        else records.set(key, structuredClone(record));
      }
      return Promise.resolve();
    },
  };
}

function snapshot(overrides: Partial<SyncResponse> = {}): SyncResponse {
  return {
    sync_token: "seq:1",
    full_sync: true,
    temp_id_mapping: {},
    sync_status: {},
    tasks: [],
    projects: [
      project({ id: "connected-inbox", name: "Inbox", is_inbox: true }),
    ],
    sections: [],
    labels: [],
    reminders: [],
    filters: [],
    ...overrides,
  };
}

const RequestSchema = z.object({
  commands: z.array(
    z.object({
      uuid: z.string(),
      temp_id: z.string().optional(),
      command: z.object({
        type: z.string(),
        args: z.record(z.string(), z.unknown()),
      }),
    }),
  ),
});

function whoami(scopes: string[]) {
  return Response.json({
    principal: { kind: "api_token", user_id: "fixture-user", scopes },
  });
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

function setup(fetchImpl: SyncFetch) {
  const storage = memoryWorkspace();
  const stores = { local: memoryValues(), session: memoryValues() };
  const createEngine = () =>
    new WorkspaceEngine({
      storage,
      stores,
      fetchImpl,
      pageOrigin: "https://facet.example",
      lock: (_key, action) => action(),
    });
  return { createEngine, storage, stores };
}

const fixtureCredentials = { token: "fixture", remember: false };

describe("workspace engine", () => {
  test("retains local changes and in-progress drafts across app reloads", async () => {
    const { createEngine } = setup(() =>
      Promise.reject(new Error("Unexpected server access.")),
    );
    const before = createEngine();
    await before.initialize();
    await before.startLocal();
    const saved = await before.enqueue(
      {
        type: "TaskAdd",
        args: {
          title: "File the application",
          project_id: LOCAL_INBOX_ID,
          due_date: "2026-11-27",
        },
      },
      { tempId: "local-task" },
    );
    expect(saved.tempId).toBe("local-task");
    await before.saveDraft("local-task", {
      title: "File the signed application",
    });

    const after = createEngine();
    await after.initialize();
    expect(after.getSnapshot().profile?.kind).toBe("local");
    expect(after.getSnapshot().data.tasks[0]).toMatchObject({
      title: "File the application",
      project_id: LOCAL_INBOX_ID,
      due_date: "2026-11-27",
    });
    expect(await after.getDraft("local-task")).toEqual({
      title: "File the signed application",
    });
    await after.removeLocalData();
    expect(after.getSnapshot().phase).toBe("setup");
    await expect(createEngine().initialize()).resolves.toBeUndefined();
  });

  test("refuses attaching local changes to a read-only token", async () => {
    const { createEngine, storage } = setup((input) =>
      Promise.resolve(
        requestUrl(input).endsWith("/whoami")
          ? whoami(["read"])
          : Response.json(snapshot()),
      ),
    );
    const engine = createEngine();
    await engine.startLocal();
    await engine.enqueue({
      type: "TaskAdd",
      args: { title: "Keep the local work", project_id: LOCAL_INBOX_ID },
    });
    await expect(
      engine.connect(fixtureCredentials, { attachLocal: true }),
    ).rejects.toThrow("write access");
    expect(engine.getSnapshot().data.tasks[0]?.title).toBe(
      "Keep the local work",
    );

    await engine.connect(fixtureCredentials);
    await engine.sync();
    expect(engine.getSnapshot().canWrite).toBe(false);
    const command = {
      type: "TaskAdd",
      args: { title: "Disallowed", project_id: "connected-inbox" },
    } as const;
    await expect(engine.enqueue(command)).rejects.toThrow("read-only");
    const local = await storage.read(LOCAL_WORKSPACE_KEY);
    expect(local?.outbox).toHaveLength(1);
  });

  test("transfers local work only after verification and replays the same receipt after a lost response", async () => {
    const attempts: string[] = [];
    let dropsResponse = true;
    const fixtureTask = task({
      id: "connected-task",
      title: "Keep the receipt",
      project_id: "connected-inbox",
    });
    const { createEngine, storage, stores } = setup((input, init) => {
      if (requestUrl(input).endsWith("/whoami"))
        return Promise.resolve(whoami(["read", "write"]));
      if (typeof init?.body !== "string")
        throw new TypeError("Fixture expected a JSON body.");
      const request = RequestSchema.parse(JSON.parse(init.body));
      const create = request.commands[0];
      if (create === undefined)
        return Promise.resolve(Response.json(snapshot()));
      attempts.push(create.uuid);
      expect(create.command.args["project_id"]).toBe("connected-inbox");
      if (dropsResponse)
        return Promise.reject(new TypeError("Connection dropped."));
      return Promise.resolve(
        Response.json(
          snapshot({
            full_sync: false,
            sync_token: "seq:2",
            tasks: [fixtureTask],
            temp_id_mapping: { "local-task": "connected-task" },
            sync_status: { [create.uuid]: "ok" },
          }),
        ),
      );
    });
    const engine = createEngine();
    await engine.startLocal();
    const { uuid } = await engine.enqueue(
      {
        type: "TaskAdd",
        args: { title: fixtureTask.title, project_id: LOCAL_INBOX_ID },
      },
      { tempId: "local-task" },
    );
    await engine.saveDraft("local-task", { description: "Unsaved note" });
    await engine.connect(fixtureCredentials, { attachLocal: true });
    await engine.sync();
    expect(engine.getSnapshot().syncStatus).toBe("offline");
    expect(engine.getSnapshot().pendingCount).toBe(1);
    expect(await storage.read(LOCAL_WORKSPACE_KEY)).toBeUndefined();

    dropsResponse = false;
    await engine.sync();
    expect(attempts.length).toBeGreaterThan(1);
    expect(new Set(attempts)).toEqual(new Set([uuid]));
    expect(engine.getSnapshot().pendingCount).toBe(0);
    expect(engine.getSnapshot().tempIdMapping["local-task"]).toBe(
      "connected-task",
    );
    expect(engine.getSnapshot().data.tasks).toEqual([fixtureTask]);
    expect(await engine.getDraft("connected-task")).toEqual({
      description: "Unsaved note",
    });

    engine.signOut();
    expect(engine.getSnapshot().data.tasks).toEqual([]);
    expect(await createEngine().initialize()).toBeUndefined();
    expect(stores.session.getItem("tasknotes.web.session.tab")).toBeNull();
  });

  test("opens pending local attachment bytes offline", async () => {
    const { createEngine } = setup(() =>
      Promise.reject(new Error("Unexpected server access.")),
    );
    const engine = createEngine();
    await engine.startLocal();
    await engine.enqueue(
      {
        type: "TaskAdd",
        args: { title: "Attach the note", project_id: LOCAL_INBOX_ID },
      },
      { tempId: "local-task" },
    );
    const update: QueuedCommand["command"] = {
      type: "TaskUpdate",
      args: {
        id: "local-task",
        append_comment: {
          comment: {
            id: "fixture-note",
            body: "",
            created_at: "2026-11-27T00:00:00.000Z",
            file_name: "note.txt",
          },
          attachment_base64: "SGVsbG8=",
        },
      },
    };
    await engine.enqueue(update);
    const attachment = await engine.attachment("local-task", "fixture-note");
    expect(await attachment.text()).toBe("Hello");
  });
});
