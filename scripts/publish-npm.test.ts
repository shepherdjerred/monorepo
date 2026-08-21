import { describe, expect, test } from "bun:test";

import {
  EXPIRY_WARNING_DAYS,
  expiryWarning,
  verifyTokenBypasses2fa,
  type TokenIntrospectionFetcher,
} from "./publish-npm.ts";

const now = new Date("2026-08-21T00:00:00Z");

function respondWith(body: unknown, status = 200): TokenIntrospectionFetcher {
  return async () => Response.json(body, { status });
}

function inDays(days: number): string {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

describe("expiryWarning", () => {
  test("stays quiet for a token that is not close to expiring", () => {
    expect(
      expiryWarning({ expiry: inDays(EXPIRY_WARNING_DAYS + 1) }, now),
    ).toBeNull();
  });

  test("stays quiet for a token with no expiry", () => {
    expect(expiryWarning({}, now)).toBeNull();
    expect(expiryWarning({ expiry: "" }, now)).toBeNull();
  });

  test("warns inside the window and names the rotation target", () => {
    const warning = expiryWarning({ expiry: inDays(3) }, now);
    expect(warning).toContain("expires in 3 day(s)");
    expect(warning).toContain("buildkite-ci-secrets");
  });

  // The outage this exists to prevent: an already-lapsed token 401s every
  // call, which reads as an unrelated failure unless something says so.
  test("reports a token that already lapsed", () => {
    const warning = expiryWarning({ expiry: inDays(-2) }, now);
    expect(warning).toContain("2 day(s) AGO");
  });

  test("refuses an unparsable expiry rather than ignoring it", () => {
    expect(() => expiryWarning({ expiry: "not-a-date" }, now)).toThrow(
      "unparsable expiry",
    );
  });
});

describe("verifyTokenBypasses2fa", () => {
  const token = `npm_${"x".repeat(36)}`;
  const maskedEntry = (extra: Record<string, unknown>) => ({
    token: `${token.slice(0, 8)}...${token.slice(-4)}`,
    name: "1Password",
    bypass_2fa: true,
    ...extra,
  });

  test("calls a 401 a credential rotation, not an introspection failure", async () => {
    const failure: unknown = await verifyTokenBypasses2fa(token, {
      fetcher: respondWith({}, 401),
      now,
    }).catch((error: unknown) => error);

    const message = failure instanceof Error ? failure.message : "";
    expect(message).toContain("npm rejected NPM_TOKEN (HTTP 401)");
    expect(message).toContain("expired, revoked");
    expect(message).not.toContain("introspection failed");
  });

  test("still reports other HTTP failures as introspection failures", async () => {
    const failure: unknown = await verifyTokenBypasses2fa(token, {
      fetcher: respondWith({}, 500),
      now,
    }).catch((error: unknown) => error);

    expect(failure instanceof Error ? failure.message : "").toContain(
      "npm token introspection failed (page 1)",
    );
  });

  test("rejects a token that does not bypass 2FA", async () => {
    const failure: unknown = await verifyTokenBypasses2fa(token, {
      fetcher: respondWith({
        objects: [maskedEntry({ bypass_2fa: false })],
      }),
      now,
    }).catch((error: unknown) => error);

    expect(failure instanceof Error ? failure.message : "").toContain(
      "does not bypass 2FA",
    );
  });

  test("warns through the injected warner when expiry is near", async () => {
    const warnings: string[] = [];
    await verifyTokenBypasses2fa(token, {
      fetcher: respondWith({ objects: [maskedEntry({ expiry: inDays(5) })] }),
      now,
      warn: (message) => warnings.push(message),
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("expires in 5 day(s)");
  });

  test("says nothing when a healthy token is far from expiry", async () => {
    const warnings: string[] = [];
    await verifyTokenBypasses2fa(token, {
      fetcher: respondWith({ objects: [maskedEntry({ expiry: inDays(89) })] }),
      now,
      warn: (message) => warnings.push(message),
    });

    expect(warnings).toEqual([]);
  });

  test("follows pagination to find a token on a later page", async () => {
    const pages: string[] = [];
    const fetcher: TokenIntrospectionFetcher = async (url) => {
      pages.push(url);
      return pages.length === 1
        ? Response.json({
            objects: [],
            urls: { next: "/-/npm/v1/tokens?page=2" },
          })
        : Response.json({ objects: [maskedEntry({})] });
    };

    await verifyTokenBypasses2fa(token, { fetcher, now });
    expect(pages).toHaveLength(2);
    expect(pages[1]).toBe("https://registry.npmjs.org/-/npm/v1/tokens?page=2");
  });
});
