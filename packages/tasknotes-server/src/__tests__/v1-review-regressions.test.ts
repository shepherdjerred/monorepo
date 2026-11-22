import type { Hono } from "hono";
import { expect, test } from "vitest";
import { z } from "zod";
import { createFacetApp } from "../app.ts";
import { InMemoryFacetStore } from "../v1/stores/in-memory-store.ts";

const ADMIN_TOKEN = "fct_owner_bootstrap_secret";

const CreatedTokenSchema = z.object({
  token: z.string(),
  api_token: z.object({ id: z.string() }),
});

const TaskDocSchema = z.object({
  id: z.string(),
  title: z.string(),
  project_id: z.string(),
  section_id: z.string().optional(),
  parent_id: z.string().optional(),
  due_date: z.string().optional(),
  due_timezone: z.string().optional(),
  due_string: z.string().optional(),
  is_recurring: z.boolean(),
  recurrence_rule: z.string().optional(),
  label_ids: z.array(z.string()),
});

const ProjectDocSchema = z.object({
  id: z.string(),
  parent_id: z.string().optional(),
});

const McpSingleSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number(), z.null()]),
  result: z.record(z.string(), z.unknown()).optional(),
  error: z.object({ code: z.number(), message: z.string() }).optional(),
});

const McpBatchSchema = z.array(McpSingleSchema);

const MutationsSchema = z.object({
  items: z.array(
    z.object({
      entity_type: z.string(),
      entity_id: z.string(),
      action: z.string(),
    }),
  ),
});

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function reqStatus(
  app: Hono,
  path: string,
  init?: RequestInit,
): Promise<number> {
  const res = await app.request(path, init);
  return res.status;
}

async function reqJson<T>(
  app: Hono,
  path: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  const res = await app.request(path, init);
  const raw: unknown = await res.json();
  return schema.parse(raw);
}

async function createHarness() {
  const store = new InMemoryFacetStore();
  const app = createFacetApp({
    store,
    getAuthToken: () => ADMIN_TOKEN,
  });
  const rw = await reqJson(app, "/api/v1/tokens", CreatedTokenSchema, {
    method: "POST",
    headers: headers(ADMIN_TOKEN),
    body: JSON.stringify({ name: "RW Agent" }),
  });
  const ro = await reqJson(app, "/api/v1/tokens", CreatedTokenSchema, {
    method: "POST",
    headers: headers(ADMIN_TOKEN),
    body: JSON.stringify({ name: "RO Agent", scopes: ["read"] }),
  });
  return { store, app, rwToken: rw.token, roToken: ro.token };
}

test("accepts fct_-prefixed AUTH_TOKEN as admin on protected routes and /api/health", async () => {
  const { app, rwToken } = await createHarness();
  const healthAdmin = await reqJson(
    app,
    "/api/health",
    z.object({ data: z.object({ authenticated: z.boolean() }) }),
    { headers: headers(ADMIN_TOKEN) },
  );
  expect(healthAdmin.data.authenticated).toBe(true);

  const whoamiAdmin = await reqJson(
    app,
    "/api/v1/whoami",
    z.object({ principal: z.object({ kind: z.string() }) }),
    { headers: headers(ADMIN_TOKEN) },
  );
  expect(whoamiAdmin.principal.kind).toBe("admin");

  const whoamiAgent = await reqJson(
    app,
    "/api/v1/whoami",
    z.object({ principal: z.object({ kind: z.string() }) }),
    { headers: headers(rwToken) },
  );
  expect(whoamiAgent.principal.kind).toBe("api_token");
});

test("workspace snapshot with read-only token does not recreate soft-deleted Inbox or advance syncSeq", async () => {
  const { store, app, rwToken, roToken } = await createHarness();
  const created = await reqJson(app, "/api/v1/tasks", TaskDocSchema, {
    method: "POST",
    headers: headers(rwToken),
    body: JSON.stringify({ title: "Bootstrap Inbox" }),
  });
  expect(
    await reqStatus(app, `/api/v1/projects/${created.project_id}`, {
      method: "DELETE",
      headers: headers(rwToken),
    }),
  ).toBe(204);

  const userId = "00000000-0000-0000-0000-000000000000";
  const seqBefore = await store.getSyncSequence(userId);
  const ws = await reqJson(
    app,
    "/api/v1/workspace",
    z.object({ projects: z.array(z.unknown()) }),
    { headers: headers(roToken) },
  );
  expect(ws.projects).toHaveLength(0);
  expect(await store.getSyncSequence(userId)).toBe(seqBefore);
});

test("preserves explicit nulls in MCP updates and supports MCP JSON-RPC batches", async () => {
  const { app, rwToken } = await createHarness();

  const batchPayload = await reqJson(app, "/api/v1/mcp", McpBatchSchema, {
    method: "POST",
    headers: headers(rwToken),
    body: JSON.stringify([
      { jsonrpc: "2.0", id: 1, method: "ping" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      { jsonrpc: "2.0", method: "notifications/initialized" },
    ]),
  });
  expect(batchPayload.map((item) => item.id)).toEqual([1, 2]);

  expect(
    await reqStatus(app, "/api/v1/mcp", {
      method: "POST",
      headers: headers(rwToken),
      body: JSON.stringify([
        { jsonrpc: "2.0", method: "notifications/initialized" },
      ]),
    }),
  ).toBe(202);
  expect(
    await reqStatus(app, "/api/v1/mcp", {
      method: "POST",
      headers: headers(rwToken),
      body: JSON.stringify([]),
    }),
  ).toBe(400);

  const parentProj = await reqJson(app, "/api/v1/projects", ProjectDocSchema, {
    method: "POST",
    headers: headers(rwToken),
    body: JSON.stringify({ name: "Parent" }),
  });
  const childProj = await reqJson(app, "/api/v1/projects", ProjectDocSchema, {
    method: "POST",
    headers: headers(rwToken),
    body: JSON.stringify({ name: "Child", parent_id: parentProj.id }),
  });
  const sec = await reqJson(
    app,
    "/api/v1/sections",
    z.object({ id: z.string() }),
    {
      method: "POST",
      headers: headers(rwToken),
      body: JSON.stringify({ project_id: parentProj.id, name: "Sec" }),
    },
  );
  const rootTask = await reqJson(app, "/api/v1/tasks", TaskDocSchema, {
    method: "POST",
    headers: headers(rwToken),
    body: JSON.stringify({ title: "Root", project_id: parentProj.id }),
  });
  const task = await reqJson(app, "/api/v1/tasks", TaskDocSchema, {
    method: "POST",
    headers: headers(rwToken),
    body: JSON.stringify({
      title: "Recurring Subtask",
      project_id: parentProj.id,
      section_id: sec.id,
      parent_id: rootTask.id,
      due_date: "2026-12-01",
      due_timezone: "America/New_York",
      due_string: "every monday",
      recurrence_rule: "FREQ=WEEKLY",
    }),
  });

  const updateRpc = await reqJson(app, "/api/v1/mcp", McpSingleSchema, {
    method: "POST",
    headers: headers(rwToken),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "clear-nulls",
      method: "tools/call",
      params: {
        name: "facet_update_task",
        arguments: {
          id: task.id,
          recurrence_rule: null,
          section_id: null,
          parent_id: null,
          due_timezone: null,
          due_string: null,
        },
      },
    }),
  });
  const clearedTask = TaskDocSchema.parse(
    updateRpc.result?.["structuredContent"],
  );
  expect(clearedTask.is_recurring).toBe(false);
  expect(clearedTask.recurrence_rule).toBeUndefined();
  expect(clearedTask.section_id).toBeUndefined();
  expect(clearedTask.parent_id).toBeUndefined();
  expect(clearedTask.due_timezone).toBeUndefined();
  expect(clearedTask.due_string).toBeUndefined();

  const clearProjParentRpc = await reqJson(
    app,
    "/api/v1/mcp",
    McpSingleSchema,
    {
      method: "POST",
      headers: headers(rwToken),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "clear-proj-parent",
        method: "tools/call",
        params: {
          name: "facet_manage_organization",
          arguments: {
            entity_type: "project",
            operation: "update",
            id: childProj.id,
            data: { parent_id: null },
          },
        },
      }),
    },
  );
  const clearedProj = ProjectDocSchema.parse(
    clearProjParentRpc.result?.["structuredContent"],
  );
  expect(clearedProj.parent_id).toBeUndefined();
});

test("rolls back failing REST and MCP batches, enforces section-to-project consistency, audits label deletion task updates, and exposes OpenAPI schemas", async () => {
  const { app, rwToken } = await createHarness();
  const projA = await reqJson(app, "/api/v1/projects", ProjectDocSchema, {
    method: "POST",
    headers: headers(rwToken),
    body: JSON.stringify({ name: "Proj A" }),
  });
  const projB = await reqJson(app, "/api/v1/projects", ProjectDocSchema, {
    method: "POST",
    headers: headers(rwToken),
    body: JSON.stringify({ name: "Proj B" }),
  });
  const secA = await reqJson(
    app,
    "/api/v1/sections",
    z.object({ id: z.string() }),
    {
      method: "POST",
      headers: headers(rwToken),
      body: JSON.stringify({ project_id: projA.id, name: "Sec A" }),
    },
  );
  const label = await reqJson(
    app,
    "/api/v1/labels",
    z.object({ id: z.string() }),
    {
      method: "POST",
      headers: headers(rwToken),
      body: JSON.stringify({ name: "temp-tag" }),
    },
  );

  expect(
    await reqStatus(app, "/api/v1/tasks", {
      method: "POST",
      headers: headers(rwToken),
      body: JSON.stringify({
        title: "Cross-project create",
        project_id: projB.id,
        section_id: secA.id,
      }),
    }),
  ).toBe(400);

  const task1 = await reqJson(app, "/api/v1/tasks", TaskDocSchema, {
    method: "POST",
    headers: headers(rwToken),
    body: JSON.stringify({
      title: "Task 1",
      project_id: projA.id,
      section_id: secA.id,
      due_date: "2026-11-25",
      label_ids: [label.id],
    }),
  });

  expect(
    await reqStatus(app, `/api/v1/tasks/${task1.id}`, {
      method: "PATCH",
      headers: headers(rwToken),
      body: JSON.stringify({ project_id: projB.id }),
    }),
  ).toBe(400);

  const auditBeforeBatch = await reqJson(
    app,
    "/api/v1/mutations",
    MutationsSchema,
    { headers: headers(rwToken) },
  );

  expect(
    await reqStatus(app, "/api/v1/tasks/reschedule", {
      method: "POST",
      headers: headers(rwToken),
      body: JSON.stringify({
        tasks: [
          { id: task1.id, due_date: "2027-01-01" },
          { id: "missing-task", due_date: "2027-01-02" },
        ],
      }),
    }),
  ).toBe(404);

  const failedMcpReschedule = await reqJson(
    app,
    "/api/v1/mcp",
    McpSingleSchema,
    {
      method: "POST",
      headers: headers(rwToken),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "bad-batch",
        method: "tools/call",
        params: {
          name: "facet_reschedule_tasks",
          arguments: {
            tasks: [
              { id: task1.id, due_date: "2027-02-01" },
              { id: "missing-task", due_date: "2027-02-02" },
            ],
          },
        },
      }),
    },
  );
  expect(failedMcpReschedule.result?.["isError"]).toBe(true);

  const afterFailedBatches = await reqJson(
    app,
    `/api/v1/tasks/${task1.id}`,
    TaskDocSchema,
    { headers: headers(rwToken) },
  );
  expect(afterFailedBatches.due_date).toBe("2026-11-25");

  const auditAfterFailedBatches = await reqJson(
    app,
    "/api/v1/mutations",
    MutationsSchema,
    { headers: headers(rwToken) },
  );
  expect(auditAfterFailedBatches.items).toHaveLength(
    auditBeforeBatch.items.length,
  );

  expect(
    await reqStatus(app, `/api/v1/labels/${label.id}`, {
      method: "DELETE",
      headers: headers(rwToken),
    }),
  ).toBe(204);

  const taskHistory = await reqJson(
    app,
    `/api/v1/tasks/${task1.id}/mutations`,
    MutationsSchema,
    { headers: headers(rwToken) },
  );
  expect(taskHistory.items.map((i) => i.action)).toEqual(["update", "create"]);

  const openApiRaw = await reqJson(
    app,
    "/api/v1/openapi.json",
    z.object({
      paths: z.record(z.string(), z.record(z.string(), z.unknown())),
    }),
    { headers: headers(rwToken) },
  );
  expect(openApiRaw.paths["/api/v1/tasks"]?.["post"]).toHaveProperty(
    "requestBody",
  );
  expect(openApiRaw.paths["/api/v1/tasks/reschedule"]?.["post"]).toHaveProperty(
    "requestBody",
  );
  expect(openApiRaw.paths["/api/v1/tasks/{id}"]?.["parameters"]).toBeDefined();
  expect(openApiRaw.paths["/api/v1/projects/{id}"]).toBeDefined();
  expect(openApiRaw.paths["/api/v1/tasks/{id}/mutations"]).toBeDefined();
});
