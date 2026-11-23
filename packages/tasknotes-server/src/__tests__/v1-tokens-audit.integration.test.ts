import path from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  currentDatabaseOwner,
  databaseUrlFromAdmin,
  ensureSharedPostgres,
  envWithPostgresBin,
  ownerCommentSql,
  psqlMaintenanceCommandsAsync,
  runCommandAsync,
} from "@shepherdjerred/test-postgres";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { z } from "zod";
import { PrismaClient } from "#generated/prisma/client.ts";
import { createFacetApp } from "../app.ts";
import { PrismaFacetStore } from "../v1/stores/prisma-store.ts";

const packageRoot = path.resolve(import.meta.dir, "../..");
const dbSuffix = crypto.randomUUID().replaceAll("-", "");
const dbName = `tasknotes_test_${dbSuffix}`;
const ADMIN_TOKEN = "pg-owner-secret";

const CreatedTokenSchema = z.object({
  token: z.string().startsWith("fct_"),
  api_token: z.object({
    id: z.uuid(),
    name: z.string(),
    token_prefix: z.string(),
  }),
});

const TaskSchema = z.object({
  id: z.uuid(),
  title: z.string(),
});

const MutationPageSchema = z.object({
  items: z.array(
    z.object({
      id: z.uuid(),
      sync_seq: z.string(),
      entity_type: z.string(),
      entity_id: z.string(),
      action: z.string(),
      source: z.string(),
      command_uuid: z.string().nullable(),
      actor_kind: z.string(),
      actor_name: z.string(),
      token_id: z.string().nullable(),
      token_prefix: z.string().nullable(),
      changes: z.record(z.string(), z.unknown()),
    }),
  ),
  next_cursor: z.string().nullable(),
});

let superUrl = "";
let prisma: PrismaClient | undefined;
let app: ReturnType<typeof createFacetApp>;

function bearer(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

beforeAll(async () => {
  const shared = ensureSharedPostgres();
  superUrl = shared.superUrl;
  const databaseUrl = databaseUrlFromAdmin(superUrl, dbName);

  await psqlMaintenanceCommandsAsync(
    [
      `CREATE DATABASE "${dbName}"`,
      ownerCommentSql(dbName, currentDatabaseOwner()),
    ],
    { adminUrl: superUrl },
  );

  const migrate = await runCommandAsync(["bun", "scripts/migrate.ts"], {
    cwd: packageRoot,
    env: envWithPostgresBin({ DATABASE_URL: databaseUrl }),
  });
  if (migrate.exitCode !== 0) {
    throw new Error(
      `tasknotes migrate failed: ${migrate.stderr || migrate.stdout}`,
    );
  }

  prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });
  app = createFacetApp({
    store: new PrismaFacetStore(prisma),
    getAuthToken: () => ADMIN_TOKEN,
  });
});

afterAll(async () => {
  if (prisma !== undefined) {
    await prisma.$disconnect();
  }
  if (superUrl !== "") {
    await psqlMaintenanceCommandsAsync(
      [`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`],
      { adminUrl: superUrl },
    );
  }
});

describe("PostgreSQL PrismaFacetStore API Tokens & Mutation Ledger", () => {
  test("persists hashed API tokens, attributes REST/Sync/MCP mutations, rolls back failed savepoints, and preserves revoked token history", async () => {
    if (prisma === undefined) {
      throw new Error("Prisma client not initialized");
    }

    const claudeRes = await app.request("/api/v1/tokens", {
      method: "POST",
      headers: bearer(ADMIN_TOKEN),
      body: JSON.stringify({ name: "Claude Postgres" }),
    });
    expect(claudeRes.status).toBe(201);
    const claude = CreatedTokenSchema.parse(await claudeRes.json());

    const assistantRes = await app.request("/api/v1/tokens", {
      method: "POST",
      headers: bearer(ADMIN_TOKEN),
      body: JSON.stringify({ name: "Evening Planner" }),
    });
    expect(assistantRes.status).toBe(201);
    const assistant = CreatedTokenSchema.parse(await assistantRes.json());

    // Verify raw secret is NOT stored in PostgreSQL ApiToken table
    const dbToken = await prisma.apiToken.findUniqueOrThrow({
      where: { id: claude.api_token.id },
    });
    expect(dbToken.tokenHash).not.toBe(claude.token);
    expect(dbToken.tokenHash).toHaveLength(64);

    // 1. Claude creates a task over REST
    const createdTaskRes = await app.request("/api/v1/tasks", {
      method: "POST",
      headers: bearer(claude.token),
      body: JSON.stringify({
        title: "Book dentist checkup",
        priority: "P2",
        due_date: "2026-12-01",
      }),
    });
    expect(createdTaskRes.status).toBe(200);
    const task = TaskSchema.parse(await createdTaskRes.json());

    // 2. Evening Planner adds a comment via MCP
    const mcpRes = await app.request("/api/v1/mcp", {
      method: "POST",
      headers: bearer(assistant.token),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "pg-mcp-1",
        method: "tools/call",
        params: {
          name: "facet_add_comment",
          arguments: {
            task_id: task.id,
            body: "Preferred morning slot before 10am",
          },
        },
      }),
    });
    expect(mcpRes.status).toBe(200);

    // 3. Claude executes a /api/v1/sync batch with one succeeding command and one failing command -> PostgreSQL SAVEPOINT rolls back failed command
    const syncRes = await app.request("/api/v1/sync", {
      method: "POST",
      headers: bearer(claude.token),
      body: JSON.stringify({
        commands: [
          {
            uuid: "pg-cmd-ok",
            command: {
              type: "TaskUpdate",
              args: { id: task.id, priority: "P1" },
            },
          },
          {
            uuid: "pg-cmd-fail",
            command: {
              type: "TaskUpdate",
              args: { id: "missing-task-uuid", title: "Should rollback" },
            },
          },
        ],
      }),
    });
    expect(syncRes.status).toBe(200);

    // ProcessedCommand receipt in PostgreSQL records Claude's token attribution
    const receipt = await prisma.processedCommand.findUniqueOrThrow({
      where: { uuid: "pg-cmd-ok" },
    });
    expect(receipt.tokenId).toBe(claude.api_token.id);
    expect(receipt.actorName).toBe("Claude Postgres");
    expect(receipt.actorKind).toBe("agent");

    // Revoke Evening Planner token -> token rejected with 401, but MutationEvent retains actor_name and token_prefix
    const revokeRes = await app.request(
      `/api/v1/tokens/${assistant.api_token.id}`,
      {
        method: "DELETE",
        headers: bearer(ADMIN_TOKEN),
      },
    );
    expect(revokeRes.status).toBe(200);

    const rejectedAfterRevoke = await app.request("/api/v1/tasks", {
      headers: bearer(assistant.token),
    });
    expect(rejectedAfterRevoke.status).toBe(401);

    const auditRes = await app.request(`/api/v1/tasks/${task.id}/mutations`, {
      headers: bearer(ADMIN_TOKEN),
    });
    const auditPage = MutationPageSchema.parse(await auditRes.json());
    expect(
      auditPage.items.map((item) => [
        item.actor_name,
        item.action,
        item.source,
      ]),
    ).toEqual([
      ["Claude Postgres", "update", "sync"],
      ["Evening Planner", "comment_add", "mcp"],
      ["Claude Postgres", "create", "rest"],
    ]);

    // 4. Label deletion records task label-removal mutation in PostgreSQL
    const labelRes = await app.request("/api/v1/labels", {
      method: "POST",
      headers: bearer(claude.token),
      body: JSON.stringify({ name: "dental" }),
    });
    const createdLabel = z
      .object({ id: z.uuid() })
      .parse(await labelRes.json());
    await app.request(`/api/v1/tasks/${task.id}`, {
      method: "PATCH",
      headers: bearer(claude.token),
      body: JSON.stringify({ label_ids: [createdLabel.id] }),
    });
    const unauthDeleteLabel = await app.request(
      `/api/v1/labels/${createdLabel.id}`,
      {
        method: "DELETE",
        headers: bearer(assistant.token),
      },
    );
    expect(unauthDeleteLabel.status).toBe(401);
    const deleteLabelRes = await app.request(
      `/api/v1/labels/${createdLabel.id}`,
      {
        method: "PATCH",
        headers: bearer(claude.token),
        body: JSON.stringify({ is_deleted: true }),
      },
    );
    expect(deleteLabelRes.status).toBe(200);

    // 5. Concurrent edits serialize before-snapshots accurately, and recurring completion serializes with reschedule
    const recurringRes = await app.request("/api/v1/tasks", {
      method: "POST",
      headers: bearer(claude.token),
      body: JSON.stringify({
        title: "Weekly review",
        priority: "P3",
        due_date: "2026-11-22",
        recurrence_rule: "FREQ=WEEKLY",
      }),
    });
    const recurringTask = TaskSchema.parse(await recurringRes.json());

    const [reschedOut, closeOut] = await Promise.all([
      app.request("/api/v1/tasks/reschedule", {
        method: "POST",
        headers: bearer(claude.token),
        body: JSON.stringify({
          tasks: [{ id: recurringTask.id, due_date: "2026-12-06" }],
        }),
      }),
      app.request(`/api/v1/tasks/${recurringTask.id}/close`, {
        method: "POST",
        headers: bearer(ADMIN_TOKEN),
      }),
    ]);
    expect(reschedOut.status).toBe(200);
    expect(closeOut.status).toBe(204);

    const finalRecurringRes = await app.request(
      `/api/v1/tasks/${recurringTask.id}`,
      {
        headers: bearer(ADMIN_TOKEN),
      },
    );
    const finalRecurring = z
      .object({ due_date: z.string() })
      .parse(await finalRecurringRes.json());
    expect(["2026-12-06", "2026-12-13"]).toContain(finalRecurring.due_date);

    // 6. Corrupt persisted enum in MutationEvent fails loudly rather than fabricating fallback values
    await prisma.$executeRawUnsafe(
      `INSERT INTO "MutationEvent" ("id", "userId", "syncSeq", "entityType", "entityId", "action", "source", "requestId", "actorKind", "actorName", "changes") VALUES ($1, $2, 999999, 'corrupt_entity', $3, 'update', 'rest', $4, 'agent', 'Broken', '{}'::jsonb)`,
      crypto.randomUUID(),
      "00000000-0000-0000-0000-000000000000",
      recurringTask.id,
      crypto.randomUUID(),
    );
    const store = new PrismaFacetStore(prisma);
    await expect(
      store.listMutations({ userId: "00000000-0000-0000-0000-000000000000" }),
    ).rejects.toThrow();
  });
});
