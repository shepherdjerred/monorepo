import type { Context } from "hono";
import { z } from "zod";
import {
  ACTOR_METADATA_HEADER,
  ActorKindSchema,
  type ActorMetadata,
  ActorMetadataSchema,
  type AuthPrincipal,
  buildAuditContext,
  DEFAULT_ADMIN_PRINCIPAL,
  DEFAULT_USER_ID,
  type MutationAction,
  type MutationSource,
  parseActorMetadataHeader,
  type TokenScope,
  TokenScopeSchema,
} from "./auth-types.ts";
import type { FacetStore } from "./types.ts";

export const REQUEST_ID_HEADER = "x-request-id";

const AuthPrincipalSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("admin"),
    actorKind: z.literal("human"),
    actorName: z.string(),
    scopes: z.array(TokenScopeSchema),
    tokenId: z.null(),
    tokenPrefix: z.null(),
    userId: z.null(),
  }),
  z.object({
    kind: z.literal("api_token"),
    actorKind: ActorKindSchema,
    actorName: z.string(),
    scopes: z.array(TokenScopeSchema),
    tokenId: z.string(),
    tokenPrefix: z.string(),
    userId: z.string(),
  }),
]);

export function parseSuppliedRequestId(
  rawHeader: string | undefined,
): { ok: true; requestId: string } | { ok: false; error: string } {
  if (rawHeader === undefined || rawHeader.trim() === "") {
    return { ok: true, requestId: crypto.randomUUID() };
  }
  const parsed = z.uuid().safeParse(rawHeader.trim());
  return parsed.success
    ? { ok: true, requestId: parsed.data }
    : { ok: false, error: `${REQUEST_ID_HEADER} must be a valid UUID` };
}

export function getRequestPrincipal(c: Context): AuthPrincipal {
  const stored: unknown = c.get("principal");
  const parsed = AuthPrincipalSchema.safeParse(stored);
  return parsed.success ? parsed.data : DEFAULT_ADMIN_PRINCIPAL;
}

export function getRequestId(c: Context): string {
  const stored: unknown = c.get("requestId");
  if (typeof stored === "string" && stored !== "") {
    return stored;
  }
  const parsed = parseSuppliedRequestId(c.req.header(REQUEST_ID_HEADER));
  return parsed.ok ? parsed.requestId : crypto.randomUUID();
}

export function resolveRequestActorMetadata(
  c: Context,
):
  | { ok: true; metadata: ActorMetadata | undefined }
  | { ok: false; response: Response } {
  const checked: unknown = c.get("actorMetadataChecked");
  if (checked === true) {
    const stored: unknown = c.get("actorMetadata");
    const parsed = ActorMetadataSchema.safeParse(stored);
    return { ok: true, metadata: parsed.success ? parsed.data : undefined };
  }
  const parsed = parseActorMetadataHeader(c.req.header(ACTOR_METADATA_HEADER));
  return parsed.ok
    ? { ok: true, metadata: parsed.metadata }
    : { ok: false, response: c.json({ error: parsed.error }, 400) };
}

export function resolveRequestUserId(
  c: Context,
): { ok: true; userId: string } | { ok: false; response: Response } {
  const principal = getRequestPrincipal(c);
  const headerUser = c.req.header("x-user-id")?.trim();
  const queryUser = c.req.query("userId")?.trim();
  const explicit =
    headerUser !== undefined && headerUser !== ""
      ? headerUser
      : queryUser !== undefined && queryUser !== ""
        ? queryUser
        : undefined;

  if (principal.kind === "api_token") {
    return explicit !== undefined && explicit !== principal.userId
      ? {
          ok: false,
          response: c.json(
            { error: "API token cannot access another user workspace" },
            403,
          ),
        }
      : { ok: true, userId: principal.userId };
  }

  return { ok: true, userId: explicit ?? DEFAULT_USER_ID };
}

export function requireScope(c: Context, scope: TokenScope): Response | null {
  const principal = getRequestPrincipal(c);
  return principal.scopes.includes(scope)
    ? null
    : c.json({ error: `Insufficient token scope: requires '${scope}'` }, 403);
}

export function requireAdminPrincipal(c: Context): Response | null {
  const principal = getRequestPrincipal(c);
  return principal.kind === "admin"
    ? null
    : c.json({ error: "Admin authentication required" }, 403);
}

export function summarizePrincipal(principal: AuthPrincipal, userId: string) {
  return {
    kind: principal.kind,
    user_id: userId,
    actor_kind: principal.actorKind,
    actor_name: principal.actorName,
    token_id: principal.tokenId,
    token_prefix: principal.tokenPrefix,
    scopes: [...principal.scopes],
  };
}

export function scopedStoreForRequest(
  c: Context,
  store: FacetStore,
  options: {
    source: MutationSource;
    actorMetadata?: ActorMetadata | undefined;
    actionHint?: MutationAction | undefined;
  },
): FacetStore {
  const audit = buildAuditContext({
    principal: getRequestPrincipal(c),
    source: options.source,
    requestId: getRequestId(c),
    actorMetadata: options.actorMetadata,
    actionHint: options.actionHint,
  });
  return store.withAuditContext(audit);
}
