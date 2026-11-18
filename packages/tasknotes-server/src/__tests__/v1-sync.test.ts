import { beforeEach, describe, expect, test } from "vitest";
import { Hono } from "hono";
import { z } from "zod";
import { InMemoryFacetStore } from "../v1/in-memory-store.ts";
import { v1Routes } from "../v1/routes.ts";

const SyncResponseSchema = z.object({
  sync_token: z.string(),
  full_sync: z.boolean(),
  temp_id_mapping: z.record(z.string(), z.string()),
  sync_status: z.record(z.string(), z.string()),
  tasks: z.array(z.record(z.string(), z.unknown())),
  projects: z.array(z.record(z.string(), z.unknown())),
  sections: z.array(z.record(z.string(), z.unknown())),
  labels: z.array(z.record(z.string(), z.unknown())),
  reminders: z.array(z.record(z.string(), z.unknown())),
  filters: z.array(z.record(z.string(), z.unknown())),
});

const TaskSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  project_id: z.string(),
  title: z.string(),
  description: z.string(),
  priority: z.string(),
  child_order: z.number(),
  completed: z.boolean(),
  is_deleted: z.boolean(),
});

const ProjectSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  name: z.string(),
  color: z.string(),
  is_favorite: z.boolean(),
  is_archived: z.boolean(),
  is_deleted: z.boolean(),
});

const USER_ID = "11111111-2222-3333-4444-555555555555";
const AUTH_HEADER = {
  "x-user-id": USER_ID,
  "content-type": "application/json",
};

describe("v1 Sync Protocol", () => {
  let store: InMemoryFacetStore;
  let app: Hono;

  beforeEach(() => {
    store = new InMemoryFacetStore();
    app = new Hono();
    app.route("/", v1Routes({ store }));
  });

  test("offline batch: resolves temp_ids across project and task creation", async () => {
    const requestBody = {
      commands: [
        {
          uuid: "cmd-p1",
          temp_id: "temp-proj-1",
          command: {
            type: "ProjectAdd",
            args: { name: "Project Alpha", color: "blue" },
          },
        },
        {
          uuid: "cmd-t1",
          temp_id: "temp-task-1",
          command: {
            type: "TaskAdd",
            args: {
              title: "Task with temp project",
              project_id: "temp-proj-1",
              priority: "P1",
            },
          },
        },
      ],
    };

    const res = await app.request("/api/v1/sync", {
      method: "POST",
      headers: AUTH_HEADER,
      body: JSON.stringify(requestBody),
    });

    expect(res.status).toBe(200);
    const body = SyncResponseSchema.parse(await res.json());

    expect(body.sync_status["cmd-p1"]).toBe("ok");
    expect(body.sync_status["cmd-t1"]).toBe("ok");

    const realProjectId = body.temp_id_mapping["temp-proj-1"];
    const realTaskId = body.temp_id_mapping["temp-task-1"];

    expect(realProjectId).toBeDefined();
    expect(realTaskId).toBeDefined();

    const createdProject = body.projects.find((p) => p["id"] === realProjectId);
    expect(createdProject).toBeDefined();
    expect(createdProject?.["name"]).toBe("Project Alpha");

    const createdTask = body.tasks.find((t) => t["id"] === realTaskId);
    expect(createdTask).toBeDefined();
    expect(createdTask?.["title"]).toBe("Task with temp project");
    expect(createdTask?.["project_id"]).toBe(realProjectId);
    expect(createdTask?.["priority"]).toBe("P1");
  });

  test("idempotency: duplicate command UUID is skipped and status ok is returned", async () => {
    const command = {
      uuid: "cmd-idemp-1",
      temp_id: "temp-task-idemp",
      command: {
        type: "TaskAdd",
        args: { title: "Idempotent Task", priority: "P2" },
      },
    };

    const res1 = await app.request("/api/v1/sync", {
      method: "POST",
      headers: AUTH_HEADER,
      body: JSON.stringify({ commands: [command] }),
    });
    expect(res1.status).toBe(200);
    const body1 = SyncResponseSchema.parse(await res1.json());
    expect(body1.sync_status["cmd-idemp-1"]).toBe("ok");
    expect(body1.tasks).toHaveLength(1);

    const res2 = await app.request("/api/v1/sync", {
      method: "POST",
      headers: AUTH_HEADER,
      body: JSON.stringify({ commands: [command] }),
    });
    expect(res2.status).toBe(200);
    const body2 = SyncResponseSchema.parse(await res2.json());
    expect(body2.sync_status["cmd-idemp-1"]).toBe("ok");

    const allTasks = await store.listTasks({
      userId: USER_ID,
      includeDeleted: true,
    });
    expect(allTasks).toHaveLength(1);
  });

  test("delta sync: only resources modified since sync_token are returned", async () => {
    const res1 = await app.request("/api/v1/sync", {
      method: "POST",
      headers: AUTH_HEADER,
      body: JSON.stringify({
        commands: [
          {
            uuid: "cmd-delta-t1",
            temp_id: "temp-delta-1",
            command: {
              type: "TaskAdd",
              args: { title: "Original Title", priority: "P3" },
            },
          },
        ],
      }),
    });
    const body1 = SyncResponseSchema.parse(await res1.json());
    const token1 = body1.sync_token;
    const taskId = body1.temp_id_mapping["temp-delta-1"];
    expect(taskId).toBeDefined();

    const resNoOp = await app.request("/api/v1/sync", {
      method: "POST",
      headers: AUTH_HEADER,
      body: JSON.stringify({ sync_token: token1, commands: [] }),
    });
    const bodyNoOp = SyncResponseSchema.parse(await resNoOp.json());
    expect(bodyNoOp.tasks).toHaveLength(0);
    expect(bodyNoOp.full_sync).toBe(false);

    const resUpdate = await app.request("/api/v1/sync", {
      method: "POST",
      headers: AUTH_HEADER,
      body: JSON.stringify({
        sync_token: token1,
        commands: [
          {
            uuid: "cmd-delta-t2",
            command: {
              type: "TaskUpdate",
              args: { id: taskId, title: "Updated Title" },
            },
          },
        ],
      }),
    });
    const bodyUpdate = SyncResponseSchema.parse(await resUpdate.json());
    expect(bodyUpdate.tasks).toHaveLength(1);
    expect(bodyUpdate.tasks[0]?.["title"]).toBe("Updated Title");
    expect(bodyUpdate.projects).toHaveLength(0);
  });

  test("soft deletion: marks is_deleted true in sync delta", async () => {
    const res1 = await app.request("/api/v1/sync", {
      method: "POST",
      headers: AUTH_HEADER,
      body: JSON.stringify({
        commands: [
          {
            uuid: "cmd-del-t1",
            temp_id: "temp-del-1",
            command: {
              type: "TaskAdd",
              args: { title: "Task to delete" },
            },
          },
        ],
      }),
    });
    const body1 = SyncResponseSchema.parse(await res1.json());
    const taskId = body1.temp_id_mapping["temp-del-1"];
    const token1 = body1.sync_token;

    const res2 = await app.request("/api/v1/sync", {
      method: "POST",
      headers: AUTH_HEADER,
      body: JSON.stringify({
        sync_token: token1,
        commands: [
          {
            uuid: "cmd-del-t2",
            command: {
              type: "TaskDelete",
              args: { id: taskId },
            },
          },
        ],
      }),
    });
    const body2 = SyncResponseSchema.parse(await res2.json());
    expect(body2.sync_status["cmd-del-t2"]).toBe("ok");
    expect(body2.tasks).toHaveLength(1);
    expect(body2.tasks[0]?.["is_deleted"]).toBe(true);

    const activeTasks = await store.listTasks({
      userId: USER_ID,
      includeDeleted: false,
    });
    expect(activeTasks).toHaveLength(0);
  });
});

describe("v1 CRUD Endpoints", () => {
  let store: InMemoryFacetStore;
  let app: Hono;

  beforeEach(() => {
    store = new InMemoryFacetStore();
    app = new Hono();
    app.route("/", v1Routes({ store }));
  });

  test("CRUD endpoints for tasks and projects", async () => {
    const projRes = await app.request("/api/v1/projects", {
      method: "POST",
      headers: AUTH_HEADER,
      body: JSON.stringify({ name: "Work", color: "red" }),
    });
    expect(projRes.status).toBe(200);
    const project = ProjectSchema.parse(await projRes.json());
    expect(project.name).toBe("Work");

    const taskRes = await app.request("/api/v1/tasks", {
      method: "POST",
      headers: AUTH_HEADER,
      body: JSON.stringify({
        title: "Finish report",
        project_id: project.id,
        priority: "P1",
      }),
    });
    expect(taskRes.status).toBe(200);
    const task = TaskSchema.parse(await taskRes.json());
    expect(task.title).toBe("Finish report");
    expect(task.completed).toBe(false);

    const closeRes = await app.request(`/api/v1/tasks/${task.id}/close`, {
      method: "POST",
      headers: AUTH_HEADER,
    });
    expect(closeRes.status).toBe(204);

    const checkClosed = await app.request(`/api/v1/tasks/${task.id}`, {
      method: "GET",
      headers: AUTH_HEADER,
    });
    const closedTask = TaskSchema.parse(await checkClosed.json());
    expect(closedTask.completed).toBe(true);

    const reopenRes = await app.request(`/api/v1/tasks/${task.id}/reopen`, {
      method: "POST",
      headers: AUTH_HEADER,
    });
    expect(reopenRes.status).toBe(204);

    const checkReopened = await app.request(`/api/v1/tasks/${task.id}`, {
      method: "GET",
      headers: AUTH_HEADER,
    });
    const reopenedTask = TaskSchema.parse(await checkReopened.json());
    expect(reopenedTask.completed).toBe(false);

    const delTaskRes = await app.request(`/api/v1/tasks/${task.id}`, {
      method: "DELETE",
      headers: AUTH_HEADER,
    });
    expect(delTaskRes.status).toBe(204);

    const listRes = await app.request("/api/v1/tasks", {
      method: "GET",
      headers: AUTH_HEADER,
    });
    expect(listRes.status).toBe(200);
    const tasksList = z.array(TaskSchema).parse(await listRes.json());
    expect(tasksList).toHaveLength(0);

    const delProjRes = await app.request(`/api/v1/projects/${project.id}`, {
      method: "DELETE",
      headers: AUTH_HEADER,
    });
    expect(delProjRes.status).toBe(204);
  });
});
