import type { Context, Next } from "hono";
import { config } from "../config.ts";
import {
  ACTOR_METADATA_HEADER,
  API_TOKEN_PREFIX,
  type AuthPrincipal,
  DEFAULT_ADMIN_PRINCIPAL,
  extractBearerToken,
  hashApiToken,
  parseActorMetadataHeader,
  verifyBootstrapToken,
} from "../v1/auth-types.ts";
import {
  parseSuppliedRequestId,
  REQUEST_ID_HEADER,
} from "../v1/request-context.ts";
import type { FacetStore } from "../v1/types.ts";

export type AuthMiddlewareOptions = {
  store: FacetStore;
  getAuthToken?: (() => string) | undefined;
};

async function resolveBearerPrincipal(
  rawToken: string | null,
  configuredAuthToken: string,
  store: FacetStore,
): Promise<
  | { ok: true; principal: AuthPrincipal }
  | { ok: false; status: 401; error: string }
> {
  if (
    configuredAuthToken !== "" &&
    rawToken !== null &&
    verifyBootstrapToken(rawToken, configuredAuthToken)
  ) {
    return { ok: true, principal: DEFAULT_ADMIN_PRINCIPAL };
  }

  if (rawToken?.startsWith(API_TOKEN_PREFIX) === true) {
    const matched = await store.authenticateApiToken(hashApiToken(rawToken));
    if (matched === null) {
      return {
        ok: false,
        status: 401,
        error: "Invalid or revoked API token",
      };
    }
    return {
      ok: true,
      principal: {
        kind: "api_token",
        actorKind: matched.actorKind,
        actorName: matched.name,
        scopes: matched.scopes,
        tokenId: matched.id,
        tokenPrefix: matched.tokenPrefix,
        userId: matched.userId,
      },
    };
  }

  if (configuredAuthToken === "") {
    return { ok: true, principal: DEFAULT_ADMIN_PRINCIPAL };
  }

  return rawToken === null
    ? {
        ok: false,
        status: 401,
        error: "Missing Authorization header",
      }
    : { ok: false, status: 401, error: "Invalid token" };
}

export function createAuthMiddleware(options: AuthMiddlewareOptions) {
  const readAuthToken = options.getAuthToken ?? (() => config.authToken);

  return async function handleAuth(
    c: Context,
    next: Next,
  ): Promise<Response | undefined> {
    const reqIdResult = parseSuppliedRequestId(c.req.header(REQUEST_ID_HEADER));
    if (!reqIdResult.ok) {
      return c.json({ success: false, error: reqIdResult.error }, 400);
    }
    c.set("requestId", reqIdResult.requestId);
    c.header(REQUEST_ID_HEADER, reqIdResult.requestId);

    if (c.req.path === "/api/health" || c.req.path === "/metrics") {
      await next();
      return undefined;
    }

    const metaResult = parseActorMetadataHeader(
      c.req.header(ACTOR_METADATA_HEADER),
    );
    if (!metaResult.ok) {
      return c.json({ success: false, error: metaResult.error }, 400);
    }
    c.set("actorMetadata", metaResult.metadata);
    c.set("actorMetadataChecked", true);

    const rawToken = extractBearerToken(c.req.header("Authorization"));
    const resolved = await resolveBearerPrincipal(
      rawToken,
      readAuthToken(),
      options.store,
    );
    if (!resolved.ok) {
      return c.json({ success: false, error: resolved.error }, resolved.status);
    }

    c.set("principal", resolved.principal);
    await next();
    return undefined;
  };
}
