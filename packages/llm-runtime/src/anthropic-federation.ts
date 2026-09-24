/**
 * Exchange a projected Kubernetes service-account token for a short-lived
 * Anthropic access token, and keep it fresh.
 *
 * `@ai-sdk/anthropic` accepts only a static `apiKey`/`authToken`/`headers`, so
 * a rotating credential has to arrive through its `fetch` hook. That is what
 * this module provides: a fetch wrapper that sets `Authorization: Bearer` from
 * a cached token it refreshes on a schedule.
 *
 * This deliberately does not use `@anthropic-ai/sdk`'s own federation
 * credential provider. That provider is built to drive the raw Anthropic
 * client, not the AI SDK, and bridging the two means reaching inside it to pull
 * the token out anyway. Doing the RFC 7523 exchange here costs less than the
 * dependency and, importantly, means `ANTHROPIC_API_KEY` can never shadow
 * federation the way it does in that SDK's credential precedence — nothing
 * here consults the environment.
 */
import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { RuntimeFetch } from "./types.ts";

const TOKEN_ENDPOINT = "https://api.anthropic.com/v1/oauth/token";
const JWT_BEARER_GRANT = "urn:ietf:params:oauth:grant-type:jwt-bearer";

/**
 * Refresh thresholds, modeled on botocore's two-tier schedule and matching
 * Anthropic's documented client behavior.
 *
 * Between the two, a failed exchange is survivable: the cached token is still
 * valid, so we keep serving it and try again. Past the mandatory threshold the
 * token is too close to expiry to risk, and the failure is raised.
 */
const ADVISORY_REFRESH_MS = 120_000;
const MANDATORY_REFRESH_MS = 30_000;

const TokenResponseSchema = z
  .object({
    access_token: z.string().min(1),
    expires_in: z.number().positive(),
  })
  .loose();

export type FederationConfig = {
  readonly identityTokenFile: string;
  readonly federationRuleId: string;
  readonly organizationId: string;
  readonly serviceAccountId: string;
  readonly workspaceId?: string | undefined;
};

export type FederationDeps = {
  readonly fetch: RuntimeFetch;
  /** Injectable for tests; defaults to reading the projected token file. */
  readonly readIdentityToken?: (path: string) => Promise<string>;
  readonly now?: () => number;
};

type CachedToken = { readonly value: string; readonly expiresAtMs: number };

async function defaultReadIdentityToken(path: string): Promise<string> {
  const contents = await readFile(path, "utf8");
  const token = contents.trim();
  if (token === "") {
    throw new Error(`Anthropic identity token file ${path} is empty`);
  }
  return token;
}

async function exchange(
  config: FederationConfig,
  deps: Required<Pick<FederationDeps, "fetch">> & {
    readIdentityToken: (path: string) => Promise<string>;
    now: () => number;
  },
): Promise<CachedToken> {
  // Re-read on EVERY exchange. Identity tokens carrying `jti` are single-use,
  // and the kubelet rotates the projected file well inside the minted token's
  // lifetime; reusing a cached JWT is what produces `jti_reused`.
  const assertion = await deps.readIdentityToken(config.identityTokenFile);
  const requestedAt = deps.now();
  const response = await deps.fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: JWT_BEARER_GRANT,
      assertion,
      federation_rule_id: config.federationRuleId,
      organization_id: config.organizationId,
      service_account_id: config.serviceAccountId,
      ...(config.workspaceId !== undefined && {
        workspace_id: config.workspaceId,
      }),
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Anthropic token exchange failed with ${String(response.status)}${
        detail === "" ? "" : `: ${detail.slice(0, 500)}`
      }`,
    );
  }

  const parsed = TokenResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error("Anthropic token exchange returned an unexpected body");
  }
  return {
    value: parsed.data.access_token,
    expiresAtMs: requestedAt + parsed.data.expires_in * 1000,
  };
}

/**
 * A fetch that authenticates every Anthropic call with a federated token.
 *
 * Concurrent callers share one in-flight exchange: a burst of requests at
 * refresh time must not each present the same single-use JWT.
 */
export function createFederatedAnthropicFetch(
  config: FederationConfig,
  deps: FederationDeps,
): RuntimeFetch {
  const now = deps.now ?? (() => Date.now());
  const readIdentityToken = deps.readIdentityToken ?? defaultReadIdentityToken;
  const resolved = { fetch: deps.fetch, readIdentityToken, now };

  let cached: CachedToken | undefined;
  let inFlight: Promise<CachedToken> | undefined;

  async function runExchange(): Promise<CachedToken> {
    try {
      const token = await exchange(config, resolved);
      cached = token;
      return token;
    } finally {
      inFlight = undefined;
    }
  }

  async function refresh(): Promise<CachedToken> {
    inFlight ??= runExchange();
    return inFlight;
  }

  async function currentToken(): Promise<string> {
    const token = cached;
    const remainingMs = token === undefined ? 0 : token.expiresAtMs - now();

    if (token !== undefined && remainingMs > ADVISORY_REFRESH_MS) {
      return token.value;
    }
    if (token === undefined || remainingMs <= MANDATORY_REFRESH_MS) {
      const refreshed = await refresh();
      return refreshed.value;
    }
    // Advisory window: try to refresh, but the cached token is still good for
    // roughly another 90 seconds, so a transient failure must not fail the call.
    try {
      const refreshed = await refresh();
      return refreshed.value;
    } catch {
      return token.value;
    }
  }

  return async (input, init) => {
    const token = await currentToken();
    const headers = new Headers(init?.headers);
    headers.set("authorization", `Bearer ${token}`);
    // A stale x-api-key alongside a bearer token is exactly the shadowing this
    // module exists to prevent.
    headers.delete("x-api-key");
    return deps.fetch(input, { ...init, headers });
  };
}
