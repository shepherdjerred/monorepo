import { createRemoteJWKSet, customFetch, jwtVerify } from "jose";
import { z } from "zod";
import { LeaguePuuidSchema } from "@scout-for-lol/data";
import type { FetchFunction } from "#src/league/api/client/riot-client.ts";
import { pkceChallenge, type RiotLinkFlow } from "./link-cookie.ts";

const ISSUER = "https://auth.riotgames.com";
const ACCOUNT_API =
  "https://americas.api.riotgames.com/riot/account/v1/accounts";
const TokenSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().refine((value) => value.toLowerCase() === "bearer"),
  id_token: z.string().min(1),
});
const IdentitySchema = z.object({
  puuid: LeaguePuuidSchema,
  gameName: z.string().min(1),
  tagLine: z.string().min(1),
});
export type RiotIdentity = z.infer<typeof IdentitySchema>;
export type RiotRsoCredentials = { clientId: string; clientSecret: string };

export class RiotSignOnError extends Error {
  constructor(
    public readonly reason:
      "provider-unavailable" | "invalid-proof" | "project-mismatch",
  ) {
    super(`Riot account linking failed: ${reason}`);
    this.name = "RiotSignOnError";
  }
}

export function riotAuthorizeUrl(
  credentials: RiotRsoCredentials,
  callbackUrl: string,
  flow: RiotLinkFlow,
): string {
  const url = new URL(`${ISSUER}/authorize`);
  url.search = new URLSearchParams({
    client_id: credentials.clientId,
    redirect_uri: callbackUrl,
    response_type: "code",
    scope: "openid",
    state: flow.state,
    nonce: flow.nonce,
    code_challenge: pkceChallenge(flow.verifier),
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return url.toString();
}

export async function verifyRiotAuthorization(
  input: {
    credentials: RiotRsoCredentials;
    callbackUrl: string;
    flow: RiotLinkFlow;
    code: string;
    riotApiKey: string;
  },
  fetchFn: FetchFunction = fetch,
): Promise<RiotIdentity> {
  const response = await fetchFn(`${ISSUER}/token`, {
    method: "POST",
    signal: AbortSignal.timeout(10_000),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${encodeURIComponent(input.credentials.clientId)}:${encodeURIComponent(input.credentials.clientSecret)}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.callbackUrl,
      code_verifier: input.flow.verifier,
    }),
  });
  if (!response.ok)
    throw new RiotSignOnError(
      response.status >= 500 || response.status === 429
        ? "provider-unavailable"
        : "invalid-proof",
    );
  const tokens = TokenSchema.parse(await response.json());
  const jwks = createRemoteJWKSet(new URL(`${ISSUER}/jwks.json`), {
    [customFetch]: fetchFn,
  });
  const { payload } = await jwtVerify(tokens.id_token, jwks, {
    issuer: ISSUER,
    audience: input.credentials.clientId,
    algorithms: ["RS256"],
    requiredClaims: ["exp", "iat", "sub", "nonce"],
    maxTokenAge: "5m",
  });
  if (
    payload["nonce"] !== input.flow.nonce ||
    (payload["azp"] !== undefined &&
      payload["azp"] !== input.credentials.clientId) ||
    (Array.isArray(payload.aud) &&
      payload.aud.length > 1 &&
      payload["azp"] !== input.credentials.clientId)
  )
    throw new RiotSignOnError("invalid-proof");
  const accountResponse = await fetchFn(`${ACCOUNT_API}/me`, {
    signal: AbortSignal.timeout(10_000),
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!accountResponse.ok) throw new RiotSignOnError("provider-unavailable");
  const identity = IdentitySchema.parse(await accountResponse.json());
  // PUUIDs are project-scoped: never attach an RSO identity that Scout's API key cannot identify.
  const canonicalResponse = await fetchFn(
    `${ACCOUNT_API}/by-riot-id/${encodeURIComponent(identity.gameName)}/${encodeURIComponent(identity.tagLine)}`,
    {
      signal: AbortSignal.timeout(10_000),
      headers: { "X-Riot-Token": input.riotApiKey },
    },
  );
  if (!canonicalResponse.ok) throw new RiotSignOnError("provider-unavailable");
  const canonical = IdentitySchema.parse(await canonicalResponse.json());
  if (canonical.puuid !== identity.puuid)
    throw new RiotSignOnError("project-mismatch");
  return identity;
}
