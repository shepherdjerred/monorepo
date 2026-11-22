import type { Context, Hono } from "hono";
import { z } from "zod";
import {
  ActorKindSchema,
  generateApiToken,
  MutationActionSchema,
  MutationEntityTypeSchema,
  MutationSourceSchema,
  TokenScopeSchema,
} from "./auth-types.ts";
import {
  getRequestPrincipal,
  requireAdminPrincipal,
  requireScope,
  resolveRequestUserId,
  summarizePrincipal,
} from "./request-context.ts";
import type { FacetStore } from "./types.ts";

export const CreateApiTokenBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  actor_kind: ActorKindSchema.default("agent"),
  scopes: z
    .array(TokenScopeSchema)
    .min(1)
    .default(["read", "write"])
    .transform((items) => [...new Set(items)]),
  expires_at: z.iso.datetime().nullable().optional(),
});

const ListMutationsQuerySchema = z.object({
  token_id: z.string().min(1).optional(),
  actor_kind: ActorKindSchema.optional(),
  actor_name: z.string().min(1).optional(),
  entity_type: MutationEntityTypeSchema.optional(),
  entity_id: z.string().min(1).optional(),
  action: MutationActionSchema.optional(),
  source: MutationSourceSchema.optional(),
  since: z.iso.datetime().optional(),
  since_seq: z.string().regex(/^\d+$/).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().min(1).optional(),
});

async function parseJsonBody<T>(
  c: Context,
  schema: z.ZodType<T>,
): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return { ok: false, response: c.json({ error: "Invalid JSON body" }, 400) };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      response: c.json(
        { error: "Invalid request body", details: parsed.error.issues },
        400,
      ),
    };
  }
  return { ok: true, data: parsed.data };
}

function queryParametersRecord(c: Context): Record<string, string> {
  const out: Record<string, string> = {};
  const raw = c.req.query();
  for (const [key, value] of Object.entries(raw)) {
    if (value !== "") {
      out[key] = value;
    }
  }
  return out;
}

export function mountTokenAndAuditRoutes(app: Hono, store: FacetStore): void {
  app.get("/api/v1/whoami", (c) => {
    const scopeDenied = requireScope(c, "read");
    if (scopeDenied !== null) {
      return scopeDenied;
    }
    const resolvedUser = resolveRequestUserId(c);
    if (!resolvedUser.ok) {
      return resolvedUser.response;
    }
    return c.json({
      authenticated: true,
      principal: summarizePrincipal(
        getRequestPrincipal(c),
        resolvedUser.userId,
      ),
    });
  });

  app.post("/api/v1/tokens", async (c) => {
    const adminDenied = requireAdminPrincipal(c);
    if (adminDenied !== null) {
      return adminDenied;
    }
    const resolvedUser = resolveRequestUserId(c);
    if (!resolvedUser.ok) {
      return resolvedUser.response;
    }
    const body = await parseJsonBody(c, CreateApiTokenBodySchema);
    if (!body.ok) {
      return body.response;
    }
    const now = store.getNow();
    const expiresAt =
      body.data.expires_at === undefined || body.data.expires_at === null
        ? null
        : new Date(body.data.expires_at);
    if (expiresAt !== null && expiresAt.getTime() <= now.getTime()) {
      return c.json({ error: "expires_at must be in the future" }, 400);
    }

    await store.getOrCreateUser(resolvedUser.userId);
    const generated = generateApiToken();
    const created = await store.createApiToken({
      userId: resolvedUser.userId,
      name: body.data.name,
      actorKind: body.data.actor_kind,
      tokenPrefix: generated.tokenPrefix,
      tokenHash: generated.tokenHash,
      scopes: body.data.scopes,
      expiresAt,
    });

    return c.json(
      {
        token: generated.rawToken,
        api_token: created,
      },
      201,
    );
  });

  app.get("/api/v1/tokens", async (c) => {
    const adminDenied = requireAdminPrincipal(c);
    if (adminDenied !== null) {
      return adminDenied;
    }
    const resolvedUser = resolveRequestUserId(c);
    if (!resolvedUser.ok) {
      return resolvedUser.response;
    }
    const includeRevoked = c.req.query("include_revoked") === "true";
    const items = await store.listApiTokens(resolvedUser.userId, {
      includeRevoked,
    });
    return c.json({ items });
  });

  app.delete("/api/v1/tokens/:id", async (c) => {
    const adminDenied = requireAdminPrincipal(c);
    if (adminDenied !== null) {
      return adminDenied;
    }
    const resolvedUser = resolveRequestUserId(c);
    if (!resolvedUser.ok) {
      return resolvedUser.response;
    }
    const id = c.req.param("id");
    if (id === "") {
      return c.json({ error: "API token not found" }, 404);
    }
    const revoked = await store.revokeApiToken(id, resolvedUser.userId);
    return revoked === null
      ? c.json({ error: "API token not found" }, 404)
      : c.json({ api_token: revoked });
  });

  app.get("/api/v1/mutations", async (c) => {
    const scopeDenied = requireScope(c, "read");
    if (scopeDenied !== null) {
      return scopeDenied;
    }
    const resolvedUser = resolveRequestUserId(c);
    if (!resolvedUser.ok) {
      return resolvedUser.response;
    }
    const parsedQuery = ListMutationsQuerySchema.safeParse(
      queryParametersRecord(c),
    );
    if (!parsedQuery.success) {
      return c.json(
        {
          error: "Invalid query parameters",
          details: parsedQuery.error.issues,
        },
        400,
      );
    }
    const q = parsedQuery.data;
    const page = await store.listMutations({
      userId: resolvedUser.userId,
      tokenId: q.token_id,
      actorKind: q.actor_kind,
      actorName: q.actor_name,
      entityType: q.entity_type,
      entityId: q.entity_id,
      action: q.action,
      source: q.source,
      since: q.since === undefined ? undefined : new Date(q.since),
      sinceSeq: q.since_seq === undefined ? undefined : BigInt(q.since_seq),
      limit: q.limit,
      cursor: q.cursor,
    });
    return c.json(page);
  });

  app.get("/api/v1/tasks/:id/mutations", async (c) => {
    const scopeDenied = requireScope(c, "read");
    if (scopeDenied !== null) {
      return scopeDenied;
    }
    const resolvedUser = resolveRequestUserId(c);
    if (!resolvedUser.ok) {
      return resolvedUser.response;
    }
    const taskId = c.req.param("id");
    if (taskId === "") {
      return c.json({ error: "Task not found" }, 404);
    }
    const parsedQuery = ListMutationsQuerySchema.safeParse(
      queryParametersRecord(c),
    );
    if (!parsedQuery.success) {
      return c.json(
        {
          error: "Invalid query parameters",
          details: parsedQuery.error.issues,
        },
        400,
      );
    }
    const q = parsedQuery.data;
    const page = await store.listMutations({
      userId: resolvedUser.userId,
      tokenId: q.token_id,
      actorKind: q.actor_kind,
      actorName: q.actor_name,
      entityType: "task",
      entityId: taskId,
      action: q.action,
      source: q.source,
      since: q.since === undefined ? undefined : new Date(q.since),
      sinceSeq: q.since_seq === undefined ? undefined : BigInt(q.since_seq),
      limit: q.limit,
      cursor: q.cursor,
    });
    return c.json(page);
  });
}
