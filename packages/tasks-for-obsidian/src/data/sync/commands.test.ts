import { describe, expect, test } from "bun:test";

import {
  ApiError,
  ConnectionError,
  NetworkError,
  NotFoundError,
  ValidationError,
} from "../../domain/errors";
import { taskId, type Task, type TaskId } from "../../domain/types";
import {
  type Command,
  type CreateCommand,
  applyCommand,
  classify,
  commandTarget,
  isTempId,
  makeCommandIdFactory,
  makeTempId,
  materializeCreate,
  remapTaskId,
} from "./commands";

function makeTask(overrides: Partial<Task> = {}): Task {
  const base: Task = {
    id: taskId("TaskNotes/a.md"),
    path: "TaskNotes/a.md",
    title: "A",
    status: "open",
    priority: "normal",
    contexts: [],
    projects: [],
    tags: [],
    completeInstances: [],
    skippedInstances: [],
    timeEntries: [],
    blockedBy: [],
    reminders: [],
    archived: false,
    totalTrackedTime: 0,
    isBlocked: false,
    isBlocking: false,
    extraFields: {},
  };
  return { ...base, ...overrides };
}

function createCmd(over: Partial<CreateCommand> = {}): CreateCommand {
  return {
    id: "c1",
    createdAt: 1_750_000_000_000,
    type: "create",
    tempId: taskId("tmp-1"),
    payload: { title: "New task" },
    ...over,
  };
}

describe("id helpers", () => {
  test("temp ids are detectable", () => {
    expect(isTempId(makeTempId(() => 1))).toBe(true);
    expect(isTempId(taskId("TaskNotes/real.md"))).toBe(false);
  });

  test("command ids are unique across the same clock tick", () => {
    const next = makeCommandIdFactory(() => 42);
    const ids = new Set([next(), next(), next(), next()]);
    expect(ids.size).toBe(4);
    for (const id of ids) expect(id.startsWith("42-")).toBe(true);
  });
});

describe("applyCommand — create materializes (not a no-op)", () => {
  test("create adds the optimistic task under its temp id", () => {
    const result = applyCommand(createCmd(), new Map());
    const task = result.get(taskId("tmp-1"));
    expect(task).toBeDefined();
    expect(task?.title).toBe("New task");
    expect(task?.id).toBe(taskId("tmp-1"));
  });

  test("materializeCreate maps request fields incl. branded arrays", () => {
    const t = materializeCreate(
      createCmd({
        payload: {
          title: "T",
          priority: "high",
          due: "2026-07-10",
          contexts: ["home"],
          projects: ["Proj"],
          tags: ["x"],
        },
      }),
    );
    expect(t.priority).toBe("high");
    expect(t.due).toBe("2026-07-10");
    expect(t.contexts.map(String)).toEqual(["home"]);
    expect(t.projects.map(String)).toEqual(["Proj"]);
    expect(t.tags.map(String)).toEqual(["x"]);
  });
});

describe("applyCommand — idempotent absolute-state semantics", () => {
  const id = taskId("TaskNotes/a.md");

  test("set_status sets absolutely and is idempotent", () => {
    const tasks = new Map<TaskId, Task>([[id, makeTask({ status: "open" })]]);
    const cmd: Command = {
      id: "1",
      createdAt: 0,
      type: "set_status",
      taskId: id,
      status: "done",
    };
    const once = applyCommand(cmd, tasks);
    const twice = applyCommand(cmd, once);
    expect(once.get(id)?.status).toBe("done");
    expect(twice.get(id)?.status).toBe("done");
  });

  test("set_instance_complete unions/removes a date, idempotently", () => {
    const tasks = new Map<TaskId, Task>([
      [id, makeTask({ recurrence: "FREQ=DAILY" })],
    ]);
    const complete: Command = {
      id: "1",
      createdAt: 0,
      type: "set_instance_complete",
      taskId: id,
      date: "2026-07-03",
      completed: true,
    };
    const a = applyCommand(complete, tasks);
    const b = applyCommand(complete, a); // replay — must not double-add
    expect(a.get(id)?.completeInstances).toEqual(["2026-07-03"]);
    expect(b.get(id)?.completeInstances).toEqual(["2026-07-03"]);

    const uncomplete: Command = { ...complete, completed: false };
    const c = applyCommand(uncomplete, b);
    const d = applyCommand(uncomplete, c);
    expect(c.get(id)?.completeInstances).toEqual([]);
    expect(d.get(id)?.completeInstances).toEqual([]);
  });

  test("update merges only defined fields; missing target is a no-op", () => {
    const tasks = new Map<TaskId, Task>([
      [id, makeTask({ title: "Old", priority: "normal" })],
    ]);
    const cmd: Command = {
      id: "1",
      createdAt: 0,
      type: "update",
      taskId: id,
      payload: { title: "New" },
    };
    const r = applyCommand(cmd, tasks);
    expect(r.get(id)?.title).toBe("New");
    expect(r.get(id)?.priority).toBe("normal");

    const missing = applyCommand({ ...cmd, taskId: taskId("nope") }, tasks);
    expect(missing.size).toBe(1);
  });

  test("delete removes and is a no-op when absent", () => {
    const tasks = new Map<TaskId, Task>([[id, makeTask()]]);
    const cmd: Command = { id: "1", createdAt: 0, type: "delete", taskId: id };
    expect(applyCommand(cmd, tasks).has(id)).toBe(false);
    expect(applyCommand(cmd, new Map()).size).toBe(0);
  });

  test("rebasing the full pending list is order-preserving and pure", () => {
    const base = new Map<TaskId, Task>([[id, makeTask({ status: "open" })]]);
    const pending: Command[] = [
      createCmd(),
      { id: "2", createdAt: 0, type: "set_status", taskId: id, status: "done" },
      {
        id: "3",
        createdAt: 0,
        type: "update",
        taskId: taskId("tmp-1"),
        payload: { priority: "high" },
      },
    ];
    const view = pending.reduce(
      (acc, c) => applyCommand(c, acc),
      new Map(base),
    );
    expect(view.get(id)?.status).toBe("done");
    expect(view.get(taskId("tmp-1"))?.priority).toBe("high");
    // base is untouched
    expect(base.get(id)?.status).toBe("open");
    expect(base.has(taskId("tmp-1"))).toBe(false);
  });
});

describe("remapTaskId / commandTarget", () => {
  const from = taskId("tmp-1");
  const to = taskId("TaskNotes/real.md");

  test("remaps create tempId and dependent taskIds", () => {
    expect(commandTarget(createCmd())).toBe(from);
    const create = remapTaskId(createCmd(), from, to);
    expect(commandTarget(create)).toBe(to);

    const update: Command = {
      id: "2",
      createdAt: 0,
      type: "update",
      taskId: from,
      payload: { title: "x" },
    };
    const remapped = remapTaskId(update, from, to);
    expect(commandTarget(remapped)).toBe(to);
  });

  test("leaves unrelated ids alone", () => {
    const other = taskId("TaskNotes/other.md");
    const cmd: Command = {
      id: "1",
      createdAt: 0,
      type: "delete",
      taskId: other,
    };
    expect(commandTarget(remapTaskId(cmd, from, to))).toBe(other);
  });
});

describe("classify", () => {
  test("maps errors to retry classes", () => {
    expect(classify(new ConnectionError())).toBe("transient");
    expect(classify(new NetworkError("x"))).toBe("transient");
    expect(classify(new NotFoundError("Task", "id"))).toBe("not_found");
    expect(classify(new ValidationError("bad"))).toBe("permanent");
    expect(classify(new ApiError("server", 500))).toBe("transient");
    expect(classify(new ApiError("rate", 429))).toBe("transient");
    expect(classify(new ApiError("nope", 404))).toBe("not_found");
    expect(classify(new ApiError("unauth", 401))).toBe("auth");
    expect(classify(new ApiError("forbidden", 403))).toBe("auth");
    expect(classify(new ApiError("bad request", 400))).toBe("permanent");
    expect(classify(new ApiError("unprocessable", 422))).toBe("permanent");
  });
});

describe("applyCommand — null clears the optimistic field", () => {
  test("clearing due removes the key instead of assigning null", () => {
    const id = taskId("TaskNotes/Tasks/a.md");
    const tasks = new Map<TaskId, Task>([
      [id, makeTask({ due: "2026-07-28", scheduled: "2026-07-25" })],
    ]);
    const cmd: Command = {
      id: "m1",
      createdAt: 0,
      type: "update",
      taskId: id,
      payload: { due: null },
    };
    const result = applyCommand(cmd, tasks).get(id);
    expect(result).toBeDefined();
    expect(result?.due).toBeUndefined();
    expect(Object.keys(result ?? {})).not.toContain("due");
    expect(result?.scheduled).toBe("2026-07-25");
  });

  test("clearing and setting in one payload both apply", () => {
    const id = taskId("TaskNotes/Tasks/b.md");
    const tasks = new Map<TaskId, Task>([
      [id, makeTask({ due: "2026-07-28" })],
    ]);
    const cmd: Command = {
      id: "m2",
      createdAt: 0,
      type: "update",
      taskId: id,
      payload: { due: null, scheduled: "2026-08-01" },
    };
    const result = applyCommand(cmd, tasks).get(id);
    expect(result?.due).toBeUndefined();
    expect(result?.scheduled).toBe("2026-08-01");
  });
});
