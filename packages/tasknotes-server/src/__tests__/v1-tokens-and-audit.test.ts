import type { Hono } from "hono";
import { beforeEach, describe, expect, test } from "vitest";
import { z } from "zod";
import { createFacetApp } from "../app.ts";
import { registry } from "../metrics.ts";
import { InMemoryFacetStore } from "../v1/stores/in-memory-store.ts";

const ADMIN_TOKEN = "owner-bootstrap-secret";
const OTHER_USER_ID = "22222222-2222-4222-8222-222222222222";

const ApiTokenSummarySchema = z.object({
  id: z.uuid(),
  user_id: z.string(),
  name: z.string(),
  actor_kind: z.enum(["human", "agent"]),
  token_prefix: z.string().startsWith("fct_"),
  scopes: z.array(z.enum(["read", "write"])),
  expires_at: z.string().nullable(),
  revoked_at: z.string().nullable(),
  last_used_at: z.string().nullable(),
  created_at: z.string(),
});

const CreatedTokenEnvelopeSchema = z.object({
  token: z.string().startsWith("fct_"),
  api_token: ApiTokenSummarySchema,
});

const TokenListSchema = z.object({ items: z.array(ApiTokenSummarySchema) });
const RevokeTokenEnvelopeSchema = z.object({
  api_token: ApiTokenSummarySchema,
});
const HealthEnvelopeSchema = z.object({
  success: z.literal(true),
  data: z.object({ status: z.literal("ok"), authenticated: z.boolean() }),
});
const WhoamiSchema = z.object({
  authenticated: z.literal(true),
  principal: z.object({
    kind: z.enum(["admin", "api_token"]),
    user_id: z.string(),
    actor_kind: z.enum(["human", "agent"]),
    actor_name: z.string(),
    token_id: z.string().nullable(),
    token_prefix: z.string().nullable(),
    scopes: z.array(z.enum(["read", "write"])),
  }),
});
const MutationItemSchema = z.object({
  id: z.uuid(),
  user_id: z.string(),
  sync_seq: z.string(),
  entity_type: z.enum([
    "task",
    "project",
    "section",
    "label",
    "reminder",
    "filter",
  ]),
  entity_id: z.string(),
  action: z.string(),
  source: z.enum(["sync", "rest", "mcp"]),
  command_uuid: z.string().nullable(),
  request_id: z.uuid(),
  actor_kind: z.enum(["human", "agent"]),
  actor_name: z.string(),
  token_id: z.string().nullable(),
  token_prefix: z.string().nullable(),
  actor_metadata: z.record(z.string(), z.unknown()).nullable(),
  changes: z.record(
    z.string(),
    z.object({ from: z.unknown(), to: z.unknown() }),
  ),
  before: z.record(z.string(), z.unknown()).nullable(),
  after: z.record(z.string(), z.unknown()).nullable(),
  created_at: z.string(),
});
const MutationPageSchema = z.object({
  items: z.array(MutationItemSchema),
  next_cursor: z.string().nullable(),
});
const TaskIdSchema = z.object({
  id: z.string(),
  title: z.string(),
  due_date: z.string().optional(),
  completed: z.boolean(),
});

function bearerHeaders(
  token: string,
  extra?: Record<string, string>,
): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    ...extra,
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

async function mintToken(app: Hono, body: Record<string, unknown>) {
  const res = await app.request("/api/v1/tokens", {
    method: "POST",
    headers: bearerHeaders(ADMIN_TOKEN),
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(201);
  return CreatedTokenEnvelopeSchema.parse(await res.json());
}

describe("API Tokens & Authorization Boundaries", () => {
  let app: Hono;

  beforeEach(() => {
    app = createFacetApp({
      store: new InMemoryFacetStore(),
      getAuthToken: () => ADMIN_TOKEN,
    });
  });

  test("token lifecycle: mint, health check, last_used_at, list without secrets, and soft-revoke", async () => {
    const unauthHealth = await reqJson(
      app,
      "/api/health",
      HealthEnvelopeSchema,
    );
    expect(unauthHealth.data.authenticated).toBe(false);

    const adminHealth = await reqJson(
      app,
      "/api/health",
      HealthEnvelopeSchema,
      { headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } },
    );
    expect(adminHealth.data.authenticated).toBe(true);

    const claude = await mintToken(app, { name: "Claude Personal" });
    expect(claude.api_token.actor_kind).toBe("agent");
    expect(claude.api_token.scopes).toEqual(["read", "write"]);
    expect(claude.api_token.last_used_at).toBeNull();
    expect(claude.token.slice(0, 12)).toBe(claude.api_token.token_prefix);

    const tokenHealth = await reqJson(
      app,
      "/api/health",
      HealthEnvelopeSchema,
      { headers: { Authorization: `Bearer ${claude.token}` } },
    );
    expect(tokenHealth.data.authenticated).toBe(true);

    const whoami = await reqJson(app, "/api/v1/whoami", WhoamiSchema, {
      headers: bearerHeaders(claude.token),
    });
    expect(whoami.principal).toMatchObject({
      kind: "api_token",
      actor_kind: "agent",
      actor_name: "Claude Personal",
      token_id: claude.api_token.id,
    });

    const listRes = await app.request("/api/v1/tokens", {
      headers: bearerHeaders(ADMIN_TOKEN),
    });
    const listRaw: unknown = await listRes.json();
    expect(JSON.stringify(listRaw)).not.toContain(claude.token);
    const listed = TokenListSchema.parse(listRaw);
    expect(listed.items[0]?.last_used_at).not.toBeNull();

    const revoked = await reqJson(
      app,
      `/api/v1/tokens/${claude.api_token.id}`,
      RevokeTokenEnvelopeSchema,
      { method: "DELETE", headers: bearerHeaders(ADMIN_TOKEN) },
    );
    expect(revoked.api_token.revoked_at).not.toBeNull();
    expect(
      await reqStatus(app, "/api/v1/tasks", {
        headers: bearerHeaders(claude.token),
      }),
    ).toBe(401);

    const activeList = await reqJson(app, "/api/v1/tokens", TokenListSchema, {
      headers: bearerHeaders(ADMIN_TOKEN),
    });
    expect(activeList.items).toHaveLength(0);

    const allList = await reqJson(
      app,
      "/api/v1/tokens?include_revoked=true",
      TokenListSchema,
      { headers: bearerHeaders(ADMIN_TOKEN) },
    );
    expect(allList.items).toHaveLength(1);
  });

  test("security boundaries: blocks LLM tokens from admin routes, mismatched user_id, expired tokens, and write routes when read-only", async () => {
    const rwAgent = await mintToken(app, { name: "Claude RW" });
    const roAgent = await mintToken(app, {
      name: "Digest Reader",
      scopes: ["read"],
    });

    for (const [method, path] of [
      ["GET", "/api/v1/tokens"],
      ["POST", "/api/v1/tokens"],
      ["DELETE", `/api/v1/tokens/${rwAgent.api_token.id}`],
      ["GET", "/api/engine-status"],
    ] as const) {
      const status = await reqStatus(app, path, {
        method,
        headers: bearerHeaders(rwAgent.token),
        ...(method === "POST"
          ? { body: JSON.stringify({ name: "Escalated" }) }
          : {}),
      });
      expect(status).toBe(403);
    }

    expect(
      await reqStatus(app, "/api/engine-status", {
        headers: bearerHeaders(ADMIN_TOKEN),
      }),
    ).toBe(200);
    expect(
      await reqStatus(app, "/api/v1/tasks", {
        headers: bearerHeaders(rwAgent.token, { "x-user-id": OTHER_USER_ID }),
      }),
    ).toBe(403);
    expect(
      await reqStatus(app, `/api/v1/tasks?userId=${OTHER_USER_ID}`, {
        headers: bearerHeaders(rwAgent.token),
      }),
    ).toBe(403);

    expect(
      await reqStatus(app, "/api/v1/tasks", {
        headers: bearerHeaders(roAgent.token),
      }),
    ).toBe(200);
    expect(
      await reqStatus(app, "/api/v1/sync", {
        method: "POST",
        headers: bearerHeaders(roAgent.token),
        body: JSON.stringify({ commands: [] }),
      }),
    ).toBe(200);
    expect(
      await reqStatus(app, "/api/v1/tasks", {
        method: "POST",
        headers: bearerHeaders(roAgent.token),
        body: JSON.stringify({ title: "Blocked write" }),
      }),
    ).toBe(403);
    expect(
      await reqStatus(app, "/api/v1/sync", {
        method: "POST",
        headers: bearerHeaders(roAgent.token),
        body: JSON.stringify({
          commands: [
            {
              uuid: "ro-cmd-1",
              command: { type: "TaskAdd", args: { title: "Blocked" } },
            },
          ],
        }),
      }),
    ).toBe(403);
    expect(
      await reqStatus(app, "/api/v1/mcp", {
        method: "POST",
        headers: bearerHeaders(roAgent.token),
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "facet_create_task",
            arguments: { title: "Blocked MCP write" },
          },
        }),
      }),
    ).toBe(403);

    expect(
      await reqStatus(app, "/api/v1/tokens", {
        method: "POST",
        headers: bearerHeaders(ADMIN_TOKEN),
        body: JSON.stringify({
          name: "Already Expired",
          expires_at: "2020-01-01T00:00:00.000Z",
        }),
      }),
    ).toBe(400);
    expect(
      await reqStatus(app, "/api/v1/tasks", {
        headers: bearerHeaders(rwAgent.token, { "x-request-id": "not-a-uuid" }),
      }),
    ).toBe(400);
    expect(
      await reqStatus(app, "/api/v1/tasks", {
        headers: bearerHeaders(rwAgent.token, {
          "x-facet-actor-metadata": "{bad json",
        }),
      }),
    ).toBe(400);
  });
});

describe("Transactional Multi-LLM Mutation Audit Ledger", () => {
  let app: Hono;

  beforeEach(() => {
    app = createFacetApp({
      store: new InMemoryFacetStore(),
      getAuthToken: () => ADMIN_TOKEN,
    });
  });

  test("records REST, Sync, and MCP mutations with diffs, savepoint rollback, idempotency, and cursor pagination", async () => {
    const claude = await mintToken(app, { name: "Claude Assistant" });
    const chatgpt = await mintToken(app, { name: "ChatGPT Planner" });

    expect(
      await reqStatus(app, "/api/v1/sync", {
        method: "POST",
        headers: bearerHeaders(ADMIN_TOKEN),
        body: JSON.stringify({}),
      }),
    ).toBe(200);
    const initialAudit = await reqJson(
      app,
      "/api/v1/mutations",
      MutationPageSchema,
      { headers: bearerHeaders(ADMIN_TOKEN) },
    );
    expect(initialAudit.items).toHaveLength(0);

    const ownerReqId = "11111111-1111-4111-8111-111111111111";
    const createRes = await app.request("/api/v1/tasks", {
      method: "POST",
      headers: bearerHeaders(ADMIN_TOKEN, { "x-request-id": ownerReqId }),
      body: JSON.stringify({
        title: "Review weekly budget",
        priority: "P2",
        due_date: "2026-11-22",
        recurrence_rule: "FREQ=WEEKLY",
      }),
    });
    expect(createRes.headers.get("x-request-id")).toBe(ownerReqId);
    const budgetTask = TaskIdSchema.parse(await createRes.json());

    expect(
      await reqStatus(app, `/api/v1/tasks/${budgetTask.id}`, {
        method: "PATCH",
        headers: bearerHeaders(claude.token, {
          "x-facet-actor-metadata": JSON.stringify({
            model: "claude-opus-4-6",
            harness: "claude-desktop",
          }),
        }),
        body: JSON.stringify({
          title: "Review and reconcile weekly budget",
          priority: "P1",
        }),
      }),
    ).toBe(200);

    expect(
      await reqStatus(app, "/api/v1/mcp", {
        method: "POST",
        headers: bearerHeaders(chatgpt.token),
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "mcp-1",
          method: "tools/call",
          params: {
            name: "facet_complete_task",
            arguments: { id: budgetTask.id },
          },
        }),
      }),
    ).toBe(200);

    const goodCmd = {
      uuid: "cmd-claude-good",
      temp_id: "tmp-claude-task",
      command: {
        type: "TaskAdd",
        args: { title: "Buy winter coat", priority: "P3" },
      },
    };
    const badCmd = {
      uuid: "cmd-claude-bad",
      command: { type: "TaskDelete", args: { id: "non-existent-task-id" } },
    };
    expect(
      await reqStatus(app, "/api/v1/sync", {
        method: "POST",
        headers: bearerHeaders(claude.token),
        body: JSON.stringify({ commands: [goodCmd, badCmd] }),
      }),
    ).toBe(200);
    expect(
      await reqStatus(app, "/api/v1/sync", {
        method: "POST",
        headers: bearerHeaders(claude.token),
        body: JSON.stringify({ commands: [goodCmd] }),
      }),
    ).toBe(200);

    await reqStatus(app, `/api/v1/tokens/${chatgpt.api_token.id}`, {
      method: "DELETE",
      headers: bearerHeaders(ADMIN_TOKEN),
    });

    const taskAudit = await reqJson(
      app,
      `/api/v1/tasks/${budgetTask.id}/mutations`,
      MutationPageSchema,
      { headers: bearerHeaders(ADMIN_TOKEN) },
    );
    expect(
      taskAudit.items.map((i) => [i.actor_name, i.action, i.source]),
    ).toEqual([
      ["ChatGPT Planner", "complete", "mcp"],
      ["Claude Assistant", "update", "rest"],
      ["Owner", "create", "rest"],
    ]);
    expect(taskAudit.items[1]?.changes["priority"]).toEqual({
      from: "P2",
      to: "P1",
    });
    expect(taskAudit.items[1]?.actor_metadata).toMatchObject({
      model: "claude-opus-4-6",
      harness: "claude-desktop",
    });
    expect(taskAudit.items[0]?.changes["due_date"]).toEqual({
      from: "2026-11-22",
      to: "2026-11-29",
    });

    const agentOnly = await reqJson(
      app,
      "/api/v1/mutations?actor_kind=agent",
      MutationPageSchema,
      { headers: bearerHeaders(ADMIN_TOKEN) },
    );
    expect(agentOnly.items).toHaveLength(3);

    const claudeOnly = await reqJson(
      app,
      `/api/v1/mutations?token_id=${claude.api_token.id}`,
      MutationPageSchema,
      { headers: bearerHeaders(ADMIN_TOKEN) },
    );
    expect(claudeOnly.items).toHaveLength(2);
    expect(claudeOnly.items[0]?.command_uuid).toBe("cmd-claude-good");

    const page1 = await reqJson(
      app,
      "/api/v1/mutations?limit=2",
      MutationPageSchema,
      { headers: bearerHeaders(ADMIN_TOKEN) },
    );
    expect(page1.items).toHaveLength(2);
    expect(page1.next_cursor).not.toBeNull();

    const page2 = await reqJson(
      app,
      `/api/v1/mutations?limit=2&cursor=${String(page1.next_cursor)}`,
      MutationPageSchema,
      { headers: bearerHeaders(ADMIN_TOKEN) },
    );
    expect(page2.items).toHaveLength(2);
    expect(page2.next_cursor).toBeNull();

    expect(await registry.metrics()).toContain("tasknotes_mutations_total");
  });
});
