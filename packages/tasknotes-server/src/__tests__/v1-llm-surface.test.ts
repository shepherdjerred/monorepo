import type { Hono } from "hono";
import { beforeEach, describe, expect, test } from "vitest";
import { z } from "zod";
import { createFacetApp } from "../app.ts";
import { InMemoryFacetStore } from "../v1/stores/in-memory-store.ts";

const ADMIN_TOKEN = "owner-secret";

const CreatedTokenSchema = z.object({
  token: z.string(),
  api_token: z.object({ id: z.string() }),
});
const IdObjectSchema = z.object({ id: z.string() });
const TaskItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  project_id: z.string(),
  section_id: z.string().optional(),
  parent_id: z.string().optional(),
  priority: z.string(),
  due_date: z.string().optional(),
  completed: z.boolean(),
  is_deleted: z.boolean(),
  comments: z.array(z.object({ id: z.string(), body: z.string() })).optional(),
});
const TaskArraySchema = z.array(TaskItemSchema);
const WorkspaceSnapshotSchema = z.object({
  server_time: z.string(),
  today: z.string(),
  timezone: z.string(),
  principal: z.object({
    kind: z.literal("api_token"),
    actor_name: z.string(),
  }),
  task_counts: z.object({
    open: z.number(),
    completed: z.number(),
    overdue: z.number(),
    due_today: z.number(),
  }),
  projects: z.array(z.object({ id: z.string(), name: z.string() })),
  sections: z.array(z.object({ id: z.string(), name: z.string() })),
  labels: z.array(z.object({ id: z.string(), name: z.string() })),
  filters: z.array(z.object({ id: z.string(), name: z.string() })),
});
const OpenApiSchema = z.object({
  openapi: z.literal("3.1.0"),
  paths: z.record(z.string(), z.unknown()),
});
const McpRpcResponseSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number(), z.null()]),
  result: z.record(z.string(), z.unknown()).optional(),
  error: z.object({ code: z.number(), message: z.string() }).optional(),
});

function authHeaders(token: string): Record<string, string> {
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

async function setupHarness(): Promise<{ app: Hono; llmToken: string }> {
  const app = createFacetApp({
    store: new InMemoryFacetStore(),
    getAuthToken: () => ADMIN_TOKEN,
  });
  const minted = await reqJson(app, "/api/v1/tokens", CreatedTokenSchema, {
    method: "POST",
    headers: authHeaders(ADMIN_TOKEN),
    body: JSON.stringify({ name: "Life Assistant" }),
  });
  return { app, llmToken: minted.token };
}

describe("LLM REST Surface, Rich Filtering & OpenAPI 3.1", () => {
  let app: Hono;
  let llmToken: string;

  beforeEach(async () => {
    ({ app, llmToken } = await setupHarness());
  });

  test("serves OpenAPI 3.1, workspace snapshot, sections, comments, filters, and safe batch/restore operations", async () => {
    const openApi = await reqJson(app, "/api/v1/openapi.json", OpenApiSchema, {
      headers: authHeaders(llmToken),
    });
    expect(openApi.paths["/api/v1/workspace"]).toBeDefined();
    expect(openApi.paths["/api/v1/mcp"]).toBeDefined();

    const proj = await reqJson(app, "/api/v1/projects", IdObjectSchema, {
      method: "POST",
      headers: authHeaders(llmToken),
      body: JSON.stringify({ name: "Home", color: "green" }),
    });
    const section = await reqJson(app, "/api/v1/sections", IdObjectSchema, {
      method: "POST",
      headers: authHeaders(llmToken),
      body: JSON.stringify({ project_id: proj.id, name: "Kitchen" }),
    });
    expect(
      await reqStatus(app, `/api/v1/sections/${section.id}`, {
        headers: authHeaders(llmToken),
      }),
    ).toBe(200);

    const label = await reqJson(app, "/api/v1/labels", IdObjectSchema, {
      method: "POST",
      headers: authHeaders(llmToken),
      body: JSON.stringify({ name: "errands", color: "orange" }),
    });
    await reqStatus(app, "/api/v1/filters", {
      method: "POST",
      headers: authHeaders(llmToken),
      body: JSON.stringify({ name: "Urgent Errands", query: "@errands & p1" }),
    });

    expect(
      await reqStatus(app, "/api/v1/tasks", {
        method: "POST",
        headers: authHeaders(llmToken),
        body: JSON.stringify({ title: "Bad", priority: "URGENT" }),
      }),
    ).toBe(400);
    expect(
      await reqStatus(app, "/api/v1/tasks", {
        method: "POST",
        headers: authHeaders(llmToken),
        body: JSON.stringify({
          title: "Bad Rule",
          recurrence_rule: "every tuesday",
        }),
      }),
    ).toBe(400);

    const overdueTask = await reqJson(app, "/api/v1/tasks", TaskItemSchema, {
      method: "POST",
      headers: authHeaders(llmToken),
      body: JSON.stringify({
        title: "Replace water filter",
        project_id: proj.id,
        section_id: section.id,
        priority: "P1",
        due_date: "2020-01-10",
        label_ids: [label.id],
      }),
    });
    const unsectionedTask = await reqJson(
      app,
      "/api/v1/tasks",
      TaskItemSchema,
      {
        method: "POST",
        headers: authHeaders(llmToken),
        body: JSON.stringify({
          title: "Paint hallway",
          project_id: proj.id,
          priority: "P3",
          due_date: "2099-05-01",
        }),
      },
    );

    const createdComment = await reqJson(
      app,
      `/api/v1/tasks/${overdueTask.id}/comments`,
      IdObjectSchema,
      {
        method: "POST",
        headers: authHeaders(llmToken),
        body: JSON.stringify({ body: "Model number MWF-42 under sink" }),
      },
    );

    const searchByComment = await reqJson(
      app,
      "/api/v1/tasks?q=mwf-42",
      TaskArraySchema,
      { headers: authHeaders(llmToken) },
    );
    expect(searchByComment.map((t) => t.id)).toEqual([overdueTask.id]);

    const overdueList = await reqJson(
      app,
      "/api/v1/tasks?overdue=true&tz=America/Los_Angeles",
      TaskArraySchema,
      { headers: authHeaders(llmToken) },
    );
    expect(overdueList.map((t) => t.id)).toEqual([overdueTask.id]);

    const unsectionedList = await reqJson(
      app,
      `/api/v1/tasks?project_id=${proj.id}&section_id=none`,
      TaskArraySchema,
      { headers: authHeaders(llmToken) },
    );
    expect(unsectionedList.map((t) => t.id)).toEqual([unsectionedTask.id]);

    const ws = await reqJson(
      app,
      "/api/v1/workspace?tz=America/Los_Angeles",
      WorkspaceSnapshotSchema,
      { headers: authHeaders(llmToken) },
    );
    expect(ws.principal.actor_name).toBe("Life Assistant");
    expect(ws.task_counts).toMatchObject({ open: 2, completed: 0, overdue: 1 });

    expect(
      await reqStatus(app, "/api/v1/tasks/move", {
        method: "POST",
        headers: authHeaders(llmToken),
        body: JSON.stringify({
          tasks: [
            {
              id: unsectionedTask.id,
              project_id: proj.id,
              section_id: section.id,
              parent_id: overdueTask.id,
              child_order: 2,
            },
          ],
        }),
      }),
    ).toBe(200);

    expect(
      await reqStatus(app, "/api/v1/tasks/reschedule", {
        method: "POST",
        headers: authHeaders(llmToken),
        body: JSON.stringify({
          tasks: [{ id: overdueTask.id, due_date: "2099-06-15" }],
        }),
      }),
    ).toBe(200);

    expect(
      await reqStatus(
        app,
        `/api/v1/tasks/${overdueTask.id}/comments/${createdComment.id}`,
        { method: "DELETE", headers: authHeaders(llmToken) },
      ),
    ).toBe(204);

    expect(
      await reqStatus(app, `/api/v1/tasks/${unsectionedTask.id}`, {
        method: "DELETE",
        headers: authHeaders(llmToken),
      }),
    ).toBe(204);
    expect(
      await reqStatus(app, `/api/v1/tasks/${unsectionedTask.id}`, {
        headers: authHeaders(llmToken),
      }),
    ).toBe(404);

    const restored = await reqJson(
      app,
      `/api/v1/tasks/${unsectionedTask.id}/restore`,
      TaskItemSchema,
      { method: "POST", headers: authHeaders(llmToken) },
    );
    expect(restored.is_deleted).toBe(false);
  });
});

describe("Stateless Streamable HTTP MCP (/api/v1/mcp)", () => {
  let app: Hono;
  let llmToken: string;

  beforeEach(async () => {
    ({ app, llmToken } = await setupHarness());
  });

  test("handles initialize, notifications, tools/list, tools/call, and domain errors", async () => {
    const getMcp = await app.request("/api/v1/mcp", {
      headers: authHeaders(llmToken),
    });
    expect(getMcp.status).toBe(405);
    expect(getMcp.headers.get("allow")).toBe("POST");

    const initRpc = await reqJson(app, "/api/v1/mcp", McpRpcResponseSchema, {
      method: "POST",
      headers: authHeaders(llmToken),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-03-26" },
      }),
    });
    expect(initRpc.result?.["protocolVersion"]).toBe("2025-03-26");

    expect(
      await reqStatus(app, "/api/v1/mcp", {
        method: "POST",
        headers: authHeaders(llmToken),
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/initialized",
        }),
      }),
    ).toBe(202);

    const listRpc = await reqJson(app, "/api/v1/mcp", McpRpcResponseSchema, {
      method: "POST",
      headers: authHeaders(llmToken),
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    });
    const tools = z
      .array(z.object({ name: z.string() }))
      .parse(listRpc.result?.["tools"]);
    expect(tools.some((t) => t.name === "facet_get_workspace")).toBe(true);
    expect(tools.some((t) => t.name === "facet_create_task")).toBe(true);

    const createProjRpc = await reqJson(
      app,
      "/api/v1/mcp",
      McpRpcResponseSchema,
      {
        method: "POST",
        headers: authHeaders(llmToken),
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: {
            name: "facet_manage_organization",
            arguments: {
              entity_type: "project",
              operation: "create",
              data: { name: "Fitness", color: "blue" },
            },
          },
        }),
      },
    );
    const fitnessProj = IdObjectSchema.parse(
      createProjRpc.result?.["structuredContent"],
    );

    const createTaskRpc = await reqJson(
      app,
      "/api/v1/mcp",
      McpRpcResponseSchema,
      {
        method: "POST",
        headers: authHeaders(llmToken),
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: {
            name: "facet_create_task",
            arguments: {
              title: "Morning 5k run",
              project_id: fitnessProj.id,
              priority: "P2",
            },
          },
        }),
      },
    );
    const runTask = IdObjectSchema.parse(
      createTaskRpc.result?.["structuredContent"],
    );

    const addCommentRpc = await reqJson(
      app,
      "/api/v1/mcp",
      McpRpcResponseSchema,
      {
        method: "POST",
        headers: authHeaders(llmToken),
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 5,
          method: "tools/call",
          params: {
            name: "facet_add_comment",
            arguments: { task_id: runTask.id, body: "Target pace 5:00/km" },
          },
        }),
      },
    );
    expect(addCommentRpc.result?.["isError"]).toBe(false);

    const missingTaskRpc = await reqJson(
      app,
      "/api/v1/mcp",
      McpRpcResponseSchema,
      {
        method: "POST",
        headers: authHeaders(llmToken),
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 6,
          method: "tools/call",
          params: { name: "facet_get_task", arguments: { id: "missing-id" } },
        }),
      },
    );
    expect(missingTaskRpc.result?.["isError"]).toBe(true);

    const auditRpc = await reqJson(app, "/api/v1/mcp", McpRpcResponseSchema, {
      method: "POST",
      headers: authHeaders(llmToken),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: { name: "facet_list_mutations", arguments: { source: "mcp" } },
      }),
    });
    const structuredAudit = z
      .object({ items: z.array(z.object({ action: z.string() })) })
      .parse(auditRpc.result?.["structuredContent"]);
    expect(structuredAudit.items.map((i) => i.action)).toEqual([
      "comment_add",
      "create",
      "create",
    ]);
  });
});
