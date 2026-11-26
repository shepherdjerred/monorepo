import { Priority, type SyncResponse } from "@shepherdjerred/facet-protocol";
import { describe, expect, test } from "vitest";
import { task } from "./fixtures.ts";
import {
  applyLocal,
  commandFailure,
  emptyWorkspace,
  mergeSync,
  postSync,
  taskAddCommand,
  taskCompleteCommand,
  taskDeleteCommand,
  taskRescheduleCommand,
  taskUpdateCommand,
} from "./sync.ts";

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.toString() : input.url;
}

function response(overrides: Partial<SyncResponse>): SyncResponse {
  return {
    sync_token: "seq:1",
    full_sync: false,
    temp_id_mapping: {},
    sync_status: {},
    tasks: [],
    projects: [],
    sections: [],
    labels: [],
    reminders: [],
    filters: [],
    ...overrides,
  };
}

describe("sync", () => {
  test("builds task commands", () => {
    expect(
      taskAddCommand(
        { title: "Milk", project_id: "", priority: Priority.P2 },
        { uuid: "uuid-1", tempId: "temp-1" },
      ),
    ).toEqual({
      uuid: "uuid-1",
      temp_id: "temp-1",
      command: {
        type: "TaskAdd",
        args: { title: "Milk", project_id: "", priority: "P2" },
      },
    });
    expect(
      taskRescheduleCommand([{ id: "task-1", due_date: "2026-11-26" }], {
        uuid: "uuid-2",
      }).command,
    ).toEqual({
      type: "TaskReschedule",
      args: { tasks: [{ id: "task-1", due_date: "2026-11-26" }] },
    });
  });

  test("merges a tombstone into the existing snapshot", () => {
    const current = {
      ...emptyWorkspace(),
      syncToken: "seq:1",
      tasks: [
        task({ id: "keep", title: "Keep" }),
        task({ id: "gone", title: "Gone" }),
      ],
    };
    const merged = mergeSync(
      current,
      response({
        sync_token: "seq:2",
        tasks: [task({ id: "gone", title: "Gone", is_deleted: true })],
      }),
    );
    expect(merged.syncToken).toBe("seq:2");
    expect(merged.tasks.find((item) => item.id === "keep")?.title).toBe("Keep");
    expect(merged.tasks.find((item) => item.id === "gone")?.is_deleted).toBe(
      true,
    );
  });

  test("replaces the snapshot on a full sync", () => {
    const merged = mergeSync(
      {
        ...emptyWorkspace(),
        tasks: [task({ id: "old", title: "Old" })],
      },
      response({
        full_sync: true,
        tasks: [task({ id: "new", title: "New" })],
      }),
    );
    expect(merged.tasks.map((item) => item.id)).toEqual(["new"]);
  });

  test("reports the first failed command", () => {
    expect(
      commandFailure(
        response({ sync_status: { "cmd-1": "ok", "cmd-2": "error: missing" } }),
      ),
    ).toBe("error: missing");
  });

  test("applies a local add, complete, and delete", () => {
    const added = applyLocal(
      emptyWorkspace(),
      taskAddCommand(
        { title: "Milk", project_id: "inbox" },
        { uuid: "uuid-1", tempId: "temp-1" },
      ),
      "2026-11-25T00:00:00.000Z",
    );
    expect(added.tasks[0]?.id).toBe("temp-1");
    const completed = applyLocal(
      added,
      taskCompleteCommand({ id: "temp-1" }, { uuid: "uuid-2" }),
      "2026-11-25T01:00:00.000Z",
    );
    expect(completed.tasks[0]?.completed).toBe(true);
    const deleted = applyLocal(
      completed,
      taskDeleteCommand({ id: "temp-1" }, { uuid: "uuid-3" }),
      "2026-11-25T02:00:00.000Z",
    );
    expect(deleted.tasks[0]?.is_deleted).toBe(true);
  });

  test("clears a due date locally", () => {
    const updated = applyLocal(
      {
        ...emptyWorkspace(),
        tasks: [task({ id: "a", title: "A", due_date: "2026-11-25" })],
      },
      taskUpdateCommand(
        { id: "a", due_date: "", due_datetime: "", due_string: "" },
        { uuid: "uuid-1" },
      ),
      "2026-11-25T00:00:00.000Z",
    );
    expect(updated.tasks[0]?.due_date).toBeUndefined();
  });

  test("sends the bearer token only when one was entered", async () => {
    const calls: { url: string; headers: Headers }[] = [];
    const fetchImpl = (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: requestUrl(input),
        headers: new Headers(init?.headers),
      });
      return Promise.resolve(
        Response.json(response({ full_sync: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    };
    await postSync({
      endpoint: "/api/v1/sync",
      token: "",
      commands: [],
      fetchImpl,
    });
    await postSync({
      endpoint: "https://tasks.example/api/v1/sync",
      token: "fct_secret",
      syncToken: "seq:4",
      commands: [],
      fetchImpl,
    });
    expect(calls[0]?.headers.has("authorization")).toBe(false);
    expect(calls[1]?.headers.get("authorization")).toBe("Bearer fct_secret");
    expect(calls[1]?.url).toBe("https://tasks.example/api/v1/sync");
  });
});
