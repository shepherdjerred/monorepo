import { describe, expect, test } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { LeaguePuuidSchema } from "@scout-for-lol/data";
import type { FetchFunction } from "#src/league/api/client/riot-client.ts";
import {
  decryptRiotLinkFlow,
  encryptRiotLinkFlow,
  newRiotLinkFlow,
  pkceChallenge,
} from "./link-cookie.ts";
import { riotAuthorizeUrl, verifyRiotAuthorization } from "./provider.ts";

const credentials = {
  clientId: "test-client",
  clientSecret: "test-client-secret",
};
const identity = {
  puuid: LeaguePuuidSchema.parse("Q".repeat(78)),
  gameName: "Northstar",
  tagLine: "NA1",
};
const callbackUrl = "https://scout-for-lol.com/api/auth/riot/callback";

async function provider(
  options: {
    wrongNonce?: boolean;
    wrongIssuer?: boolean;
    wrongAudience?: boolean;
    expired?: boolean;
    missingExpiry?: boolean;
    mismatch?: boolean;
    tokenStatus?: number;
  } = {},
) {
  const flow = newRiotLinkFlow();
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = {
    ...(await exportJWK(publicKey)),
    kid: "test-key",
    use: "sig",
    alg: "RS256",
  };
  const signedIdentity = new SignJWT({
    nonce: options.wrongNonce ? "wrong" : flow.nonce,
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(
      options.wrongIssuer
        ? "https://untrusted.invalid"
        : "https://auth.riotgames.com",
    )
    .setAudience(
      options.wrongAudience ? "another-client" : credentials.clientId,
    )
    .setSubject("riot-user")
    .setIssuedAt();
  if (options.missingExpiry !== true)
    signedIdentity.setExpirationTime(options.expired ? "-1m" : "5m");
  const token = await signedIdentity.sign(privateKey);
  const requests: { url: string; init: RequestInit | undefined }[] = [];
  const fetchFn: FetchFunction = async (input, init) => {
    const url = input instanceof Request ? input.url : input.toString();
    requests.push({ url, init });
    if (url.endsWith("/token"))
      return Response.json(
        {
          access_token: "test-access-token",
          token_type: "Bearer",
          id_token: token,
        },
        { status: options.tokenStatus ?? 200 },
      );
    if (url.endsWith("/jwks.json")) return Response.json({ keys: [jwk] });
    if (url.endsWith("/accounts/me")) return Response.json(identity);
    if (url.includes("/accounts/by-riot-id/"))
      return Response.json({
        ...identity,
        puuid: options.mismatch ? "R".repeat(78) : identity.puuid,
      });
    throw new Error(`Unexpected provider request: ${url}`);
  };
  return {
    flow,
    fetchFn,
    requests,
    input: {
      credentials,
      callbackUrl,
      flow,
      code: "test-authorization-code",
      riotApiKey: "test-api-key",
    },
  };
}

describe("Riot Sign On proof", () => {
  test("requests fresh sign-in with code flow, minimal scope, nonce, and S256 PKCE", () => {
    const flow = newRiotLinkFlow();
    const url = new URL(riotAuthorizeUrl(credentials, callbackUrl, flow));
    expect(url.origin).toBe("https://auth.riotgames.com");
    expect(url.pathname).toBe("/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: credentials.clientId,
      redirect_uri: callbackUrl,
      scope: "openid",
      response_type: "code",
      state: flow.state,
      nonce: flow.nonce,
      code_challenge_method: "S256",
      code_challenge: pkceChallenge(flow.verifier),
      prompt: "login",
    });
    expect(url.searchParams.has("client_secret")).toBe(false);
  });

  test("verifies the signed identity and Scout project before accepting its PUUID", async () => {
    const p = await provider();
    await expect(verifyRiotAuthorization(p.input, p.fetchFn)).resolves.toEqual(
      identity,
    );
    const exchange = p.requests.find((request) =>
      request.url.endsWith("/token"),
    );
    expect(new Headers(exchange?.init?.headers).get("Authorization")).toBe(
      `Basic ${Buffer.from("test-client:test-client-secret").toString("base64")}`,
    );
    const body = exchange?.init?.body;
    if (!(body instanceof URLSearchParams))
      throw new TypeError("Expected token form");
    expect(body.toString()).toContain(`code_verifier=${p.flow.verifier}`);
    expect(
      p.requests.some((request) => request.url.endsWith("/accounts/me")),
    ).toBe(true);
  });

  test.each([
    { wrongNonce: true },
    { wrongIssuer: true },
    { wrongAudience: true },
    { expired: true },
    { missingExpiry: true },
  ])(
    "rejects an identity not bound to this provider and flow: %j",
    async (options) => {
      const p = await provider(options);
      await expect(
        verifyRiotAuthorization(p.input, p.fetchFn),
      ).rejects.toThrow();
      expect(
        p.requests.some((request) => request.url.endsWith("/accounts/me")),
      ).toBe(false);
    },
  );

  test("rejects a PUUID belonging to another API project", async () => {
    const p = await provider({ mismatch: true });
    await expect(verifyRiotAuthorization(p.input, p.fetchFn)).rejects.toThrow(
      "project-mismatch",
    );
  });

  test.each([429, 503])(
    "reports provider failure without accepting a proof: %i",
    async (tokenStatus) => {
      const p = await provider({ tokenStatus });
      await expect(verifyRiotAuthorization(p.input, p.fetchFn)).rejects.toThrow(
        "provider-unavailable",
      );
    },
  );

  test("encrypts the browser proof and rejects tampering or a different signing key", async () => {
    const flow = newRiotLinkFlow();
    const secret = "test-session-signing-key-at-least-thirty-two-characters";
    const cookie = await encryptRiotLinkFlow(flow, secret);
    expect(cookie).not.toContain(flow.verifier);
    await expect(decryptRiotLinkFlow(cookie, secret)).resolves.toEqual(flow);
    await expect(
      decryptRiotLinkFlow(`${cookie}tampered`, secret),
    ).resolves.toBeNull();
    await expect(
      decryptRiotLinkFlow(cookie, `${secret}different`),
    ).resolves.toBeNull();
  });
});
