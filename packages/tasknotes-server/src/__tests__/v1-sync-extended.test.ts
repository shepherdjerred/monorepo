import { Hono } from "hono";
import { beforeEach, describe, expect, test } from "vitest";
import { z } from "zod";
import {
  tasksCreatedTotal,
  tasksDeletedTotal,
  tasksUpdatedTotal,
} from "../metrics.ts";
import { InMemoryFacetStore } from "../v1/stores/in-memory-store.ts";
import { sanitizeSavepointName } from "../v1/stores/prisma-helpers.ts";
import { v1Routes } from "../v1/routes.ts";

const TaskWireSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  project_id: z.string(),
  section_id: z.string().optional(),
  parent_id: z.string().optional(),
  title: z.string(),
  due_date: z.string().optional(),
  is_recurring: z.boolean(),
  recurrence_rule: z.string().optional(),
  label_ids: z.array(z.string()),
  completed: z.boolean(),
  is_deleted: z.boolean(),
});

const ProjectWireSchema = z.object({
  id: z.string(),
  name: z.string(),
  parent_id: z.string().optional(),
  is_inbox: z.boolean(),
  is_deleted: z.boolean(),
});

const ReminderWireSchema = z.looseObject({
  minute_offset: z.number().optional(),
  due_datetime: z.string().optional(),
  is_notified: z.boolean(),
  is_deleted: z.boolean(),
  updated_at: z.string(),
});

const FilterWireSchema = z.object({
  id: z.string(),
  name: z.string(),
  query: z.string(),
  color: z.string(),
  is_favorite: z.boolean(),
  is_deleted: z.boolean(),
});

const SyncPayloadSchema = z.object({
  sync_token: z.string(),
  full_sync: z.boolean(),
  temp_id_mapping: z.record(z.string(), z.string()),
  sync_status: z.record(z.string(), z.string()),
  tasks: z.array(TaskWireSchema),
  projects: z.array(ProjectWireSchema),
  sections: z.array(z.object({ id: z.string(), name: z.string() })),
  labels: z.array(
    z.object({ id: z.string(), name: z.string(), is_deleted: z.boolean() }),
  ),
  reminders: z.array(ReminderWireSchema),
  filters: z.array(FilterWireSchema),
});

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function headersFor(userId = USER_A): Record<string, string> {
  return {
    "x-user-id": userId,
    "content-type": "application/json",
  };
}

async function postSync(
  app: Hono,
  body: unknown,
  userId = USER_A,
): Promise<z.infer<typeof SyncPayloadSchema>> {
  const res = await app.request("/api/v1/sync", {
    method: "POST",
    headers: headersFor(userId),
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(200);
  return SyncPayloadSchema.parse(await res.json());
}

function makeTestHarness(): { store: InMemoryFacetStore; app: Hono } {
  const store = new InMemoryFacetStore();
  const app = new Hono();
  app.route("/", v1Routes({ store }));
  return { store, app };
}

describe("v1 Sync Sequence, Inbox & Labels", () => {
  let app: Hono;

  beforeEach(() => {
    ({ app } = makeTestHarness());
  });

  test("initial empty sync {} omits commands, auto-creates Inbox, and returns seq:<N>", async () => {
    const initial = await postSync(app, {});
    expect(initial.full_sync).toBe(true);
    expect(initial.sync_token).toMatch(/^seq:[1-9]\d*$/);
    expect(initial.projects).toHaveLength(1);
    expect(initial.projects[0]?.name).toBe("Inbox");
    expect(initial.projects[0]?.is_inbox).toBe(true);

    // Immediate delta sync with returned seq:<N> yields 0 changes and does not duplicate Inbox
    const delta = await postSync(app, { sync_token: initial.sync_token });
    expect(delta.full_sync).toBe(false);
    expect(delta.sync_token).toBe(initial.sync_token);
    expect(delta.projects).toHaveLength(0);
    expect(delta.tasks).toHaveLength(0);

    // Fallback full_sync tokens: "*", "seq:0", "", and legacy ISO timestamp
    for (const fallbackToken of [
      "*",
      "seq:0",
      "",
      "2026-01-01T00:00:00.000Z",
    ]) {
      const full = await postSync(app, { sync_token: fallbackToken });
      expect(full.full_sync).toBe(true);
      expect(full.projects).toHaveLength(1);
    }
  });

  test("resolves temp_id inside label_ids in a single batch and updates task syncSeq on LabelDelete", async () => {
    const batch = await postSync(app, {
      commands: [
        {
          uuid: "cmd-lbl-1",
          temp_id: "tmp-label-urgent",
          command: {
            type: "LabelAdd",
            args: { name: "urgent", color: "red" },
          },
        },
        {
          uuid: "cmd-lbl-2",
          temp_id: "tmp-label-home",
          command: {
            type: "LabelAdd",
            args: { name: "home", color: "green" },
          },
        },
        {
          uuid: "cmd-task-lbl",
          temp_id: "tmp-task-labeled",
          command: {
            type: "TaskAdd",
            args: {
              title: "Buy milk",
              label_ids: ["tmp-label-urgent", "tmp-label-home"],
            },
          },
        },
      ],
    });

    const urgentId = batch.temp_id_mapping["tmp-label-urgent"] ?? "";
    const homeId = batch.temp_id_mapping["tmp-label-home"] ?? "";
    const taskId = batch.temp_id_mapping["tmp-task-labeled"] ?? "";
    expect(urgentId).not.toBe("");
    expect(homeId).not.toBe("");
    expect(batch.tasks[0]?.label_ids).toEqual([urgentId, homeId]);

    // Delete one label in a delta sync; both the deleted label and updated task appear in delta
    const afterDelete = await postSync(app, {
      sync_token: batch.sync_token,
      commands: [
        {
          uuid: "cmd-lbl-del",
          command: { type: "LabelDelete", args: { id: urgentId } },
        },
      ],
    });
    expect(afterDelete.full_sync).toBe(false);
    expect(afterDelete.labels).toHaveLength(1);
    expect(afterDelete.labels[0]?.is_deleted).toBe(true);
    expect(afterDelete.tasks).toHaveLength(1);
    expect(afterDelete.tasks[0]?.id).toBe(taskId);
    expect(afterDelete.tasks[0]?.label_ids).toEqual([homeId]);
  });
});

describe("v1 Reminders, Filters & Command Replay", () => {
  let store: InMemoryFacetStore;
  let app: Hono;

  beforeEach(() => {
    ({ store, app } = makeTestHarness());
  });

  test("supports ReminderAdd/Update/Delete and FilterAdd/Update/Delete via sync and REST", async () => {
    const created = await postSync(app, {
      commands: [
        {
          uuid: "c-task-r",
          temp_id: "tmp-task-r",
          command: { type: "TaskAdd", args: { title: "Flight check-in" } },
        },
        {
          uuid: "c-rem-add",
          temp_id: "tmp-rem-1",
          command: {
            type: "ReminderAdd",
            args: {
              task_id: "tmp-task-r",
              reminder_type: "absolute",
              due_datetime: "2026-12-01T09:00:00.000Z",
            },
          },
        },
        {
          uuid: "c-flt-add",
          temp_id: "tmp-flt-1",
          command: {
            type: "FilterAdd",
            args: {
              name: "High Priority",
              query: "priority:P1",
              color: "berry_red",
              is_favorite: true,
            },
          },
        },
      ],
    });

    const taskId = created.temp_id_mapping["tmp-task-r"];
    const remId = created.temp_id_mapping["tmp-rem-1"] ?? "";
    const fltId = created.temp_id_mapping["tmp-flt-1"] ?? "";
    expect(taskId).toMatch(/.+/);
    expect(remId).not.toBe("");
    expect(created.reminders).toHaveLength(1);
    expect(created.reminders[0]).toMatchObject({
      id: remId,
      task_id: taskId,
      reminder_type: "absolute",
      due_datetime: "2026-12-01T09:00:00.000Z",
      is_notified: false,
      is_deleted: false,
    });
    expect(created.reminders[0]?.updated_at).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
    );
    expect(created.filters).toHaveLength(1);
    expect(created.filters[0]?.query).toBe("priority:P1");

    // Update Reminder (clearing due_datetime with "") and Filter
    const updated = await postSync(app, {
      sync_token: created.sync_token,
      commands: [
        {
          uuid: "c-rem-upd",
          command: {
            type: "ReminderUpdate",
            args: {
              id: remId,
              reminder_type: "relative",
              minute_offset: 30,
              due_datetime: "",
              is_notified: true,
            },
          },
        },
        {
          uuid: "c-flt-upd",
          command: {
            type: "FilterUpdate",
            args: { id: fltId, name: "Critical", query: "priority:P1 & today" },
          },
        },
      ],
    });
    expect(updated.reminders[0]?.["reminder_type"]).toBe("relative");
    expect(updated.reminders[0]?.due_datetime).toBeUndefined();
    expect(updated.reminders[0]?.minute_offset).toBe(30);
    expect(updated.reminders[0]?.is_notified).toBe(true);
    expect(updated.filters[0]?.name).toBe("Critical");

    // Delete Reminder and Filter
    const deleted = await postSync(app, {
      sync_token: updated.sync_token,
      commands: [
        {
          uuid: "c-rem-del",
          command: { type: "ReminderDelete", args: { id: remId } },
        },
        {
          uuid: "c-flt-del",
          command: { type: "FilterDelete", args: { id: fltId } },
        },
      ],
    });
    expect(deleted.reminders[0]?.is_deleted).toBe(true);
    expect(deleted.filters[0]?.is_deleted).toBe(true);

    // Verify REST endpoints list active filters/labels cleanly
    const fltCreateRes = await app.request("/api/v1/filters", {
      method: "POST",
      headers: headersFor(),
      body: JSON.stringify({ name: "REST Filter", query: "overdue" }),
    });
    expect(fltCreateRes.status).toBe(200);
    const listFltRes = await app.request("/api/v1/filters", {
      headers: headersFor(),
    });
    expect(
      z.array(FilterWireSchema).parse(await listFltRes.json()),
    ).toHaveLength(1);
  });

  test("ProcessedCommand replay restores temp_id_mapping on retry without duplicating entities", async () => {
    const cmd = {
      uuid: "cmd-replay-uuid-1",
      temp_id: "tmp-replay-task",
      command: {
        type: "TaskAdd",
        args: { title: "Network retry task" },
      },
    };

    const first = await postSync(app, { commands: [cmd] });
    const realId = first.temp_id_mapping["tmp-replay-task"];
    expect(realId).toBeDefined();

    // Client lost response and retries the exact same command UUID + temp_id, plus a follow-up referencing temp_id!
    const retry = await postSync(app, {
      sync_token: first.sync_token,
      commands: [
        cmd,
        {
          uuid: "cmd-replay-followup",
          command: {
            type: "TaskUpdate",
            args: {
              id: "tmp-replay-task",
              title: "Updated via replayed temp_id",
            },
          },
        },
      ],
    });

    expect(retry.sync_status["cmd-replay-uuid-1"]).toBe("ok");
    expect(retry.sync_status["cmd-replay-followup"]).toBe("ok");
    expect(retry.temp_id_mapping["tmp-replay-task"]).toBe(realId);
    expect(retry.tasks).toHaveLength(1);
    expect(retry.tasks[0]?.id).toBe(realId);
    expect(retry.tasks[0]?.title).toBe("Updated via replayed temp_id");
    expect(await store.countActiveTasks()).toBe(1);
  });
});

async function readCounterValue(counter: {
  get: () => Promise<{ values: { value: number }[] }>;
}): Promise<number> {
  const metric = await counter.get();
  return metric.values[0]?.value ?? 0;
}

describe("v1 Field Clearing", () => {
  let app: Hono;

  beforeEach(() => {
    ({ app } = makeTestHarness());
  });

  test("clears nullable fields when empty string '' is passed on TaskUpdate and ProjectUpdate", async () => {
    const setup = await postSync(app, {
      commands: [
        {
          uuid: "clr-p1",
          temp_id: "tmp-p-parent",
          command: { type: "ProjectAdd", args: { name: "ParentProj" } },
        },
        {
          uuid: "clr-p2",
          temp_id: "tmp-p-child",
          command: {
            type: "ProjectAdd",
            args: { name: "ChildProj", parent_id: "tmp-p-parent" },
          },
        },
        {
          uuid: "clr-s1",
          temp_id: "tmp-sec-1",
          command: {
            type: "SectionAdd",
            args: { project_id: "tmp-p-child", name: "Backlog" },
          },
        },
        {
          uuid: "clr-t-parent",
          temp_id: "tmp-t-parent",
          command: {
            type: "TaskAdd",
            args: { title: "Parent Task", project_id: "tmp-p-child" },
          },
        },
        {
          uuid: "clr-t-child",
          temp_id: "tmp-t-child",
          command: {
            type: "TaskAdd",
            args: {
              title: "Child Task",
              project_id: "tmp-p-child",
              section_id: "tmp-sec-1",
              parent_id: "tmp-t-parent",
              due_date: "2026-11-25",
              recurrence_rule: "FREQ=DAILY",
            },
          },
        },
      ],
    });

    const childProjId = setup.temp_id_mapping["tmp-p-child"] ?? "";
    const childTaskId = setup.temp_id_mapping["tmp-t-child"] ?? "";
    const createdTask = setup.tasks.find((t) => t.id === childTaskId);
    expect(createdTask?.section_id).toBeDefined();
    expect(createdTask?.parent_id).toBeDefined();
    expect(createdTask?.due_date).toBe("2026-11-25");
    expect(createdTask?.is_recurring).toBe(true);
    expect(createdTask?.recurrence_rule).toBe("FREQ=DAILY");

    const cleared = await postSync(app, {
      sync_token: setup.sync_token,
      commands: [
        {
          uuid: "clr-upd-task",
          command: {
            type: "TaskUpdate",
            args: {
              id: childTaskId,
              section_id: "",
              parent_id: "",
              due_date: "",
              recurrence_rule: "",
            },
          },
        },
        {
          uuid: "clr-upd-proj",
          command: {
            type: "ProjectUpdate",
            args: { id: childProjId, parent_id: "" },
          },
        },
      ],
    });

    const updatedTask = cleared.tasks.find((t) => t.id === childTaskId);
    expect(updatedTask?.section_id).toBeUndefined();
    expect(updatedTask?.parent_id).toBeUndefined();
    expect(updatedTask?.due_date).toBeUndefined();
    expect(updatedTask?.recurrence_rule).toBeUndefined();
    expect(updatedTask?.is_recurring).toBe(false);
    expect(cleared.projects[0]?.parent_id).toBeUndefined();
  });
});

describe("v1 Savepoint Isolation, Scoping & Metrics", () => {
  let app: Hono;

  beforeEach(() => {
    ({ app } = makeTestHarness());
  });

  test("isolates invalid commands via savepoint without aborting valid commands and rejects malformed body with 400", async () => {
    const batch = await postSync(app, {
      commands: [
        {
          uuid: "iso-valid-1",
          temp_id: "tmp-iso-1",
          command: { type: "TaskAdd", args: { title: "Valid Before" } },
        },
        {
          uuid: "iso-bad-update",
          command: {
            type: "TaskUpdate",
            args: { id: "nonexistent-task-id", title: "Should Fail" },
          },
        },
        {
          uuid: "iso-bad-type",
          command: {
            type: "UnknownCommandVariant",
            args: {},
          },
        },
        {
          uuid: "iso-valid-2",
          temp_id: "tmp-iso-2",
          command: { type: "TaskAdd", args: { title: "Valid After" } },
        },
      ],
    });

    expect(batch.sync_status["iso-valid-1"]).toBe("ok");
    expect(batch.sync_status["iso-bad-update"]).toMatch(/^error:/);
    expect(batch.sync_status["iso-bad-type"]).toMatch(/^error:/);
    expect(batch.sync_status["iso-valid-2"]).toBe("ok");
    expect(batch.tasks).toHaveLength(2);

    // Malformed JSON and invalid schema return HTTP 400
    const badJsonRes = await app.request("/api/v1/sync", {
      method: "POST",
      headers: headersFor(),
      body: "{not-valid-json",
    });
    expect(badJsonRes.status).toBe(400);

    const badSchemaRes = await app.request("/api/v1/sync", {
      method: "POST",
      headers: headersFor(),
      body: JSON.stringify({ commands: "not-an-array" }),
    });
    expect(badSchemaRes.status).toBe(400);
  });

  test("scopes mutations by userId and increments Prometheus task counters", async () => {
    const beforeCreated = await readCounterValue(tasksCreatedTotal);
    const beforeUpdated = await readCounterValue(tasksUpdatedTotal);
    const beforeDeleted = await readCounterValue(tasksDeletedTotal);

    const userASync = await postSync(
      app,
      {
        commands: [
          {
            uuid: "ua-add",
            temp_id: "tmp-ua-task",
            command: { type: "TaskAdd", args: { title: "Secret A" } },
          },
        ],
      },
      USER_A,
    );
    const taskAId = userASync.temp_id_mapping["tmp-ua-task"] ?? "";

    // User B cannot update or delete User A's task
    const userBAttempt = await postSync(
      app,
      {
        commands: [
          {
            uuid: "ub-steal",
            command: {
              type: "TaskDelete",
              args: { id: taskAId },
            },
          },
        ],
      },
      USER_B,
    );
    expect(userBAttempt.sync_status["ub-steal"]).toMatch(/^error:/);

    // User A updates and deletes their task
    await postSync(
      app,
      {
        commands: [
          {
            uuid: "ua-upd",
            command: {
              type: "TaskUpdate",
              args: { id: taskAId, title: "Secret A v2" },
            },
          },
          {
            uuid: "ua-del",
            command: { type: "TaskDelete", args: { id: taskAId } },
          },
        ],
      },
      USER_A,
    );

    expect(await readCounterValue(tasksCreatedTotal)).toBe(beforeCreated + 1);
    expect(await readCounterValue(tasksUpdatedTotal)).toBe(beforeUpdated + 1);
    expect(await readCounterValue(tasksDeletedTotal)).toBe(beforeDeleted + 1);
    expect(sanitizeSavepointName("a1b2-c3d4; DROP TABLE")).toBe(
      "sp_a1b2_c3d4__DROP_TABLE",
    );
  });
});
