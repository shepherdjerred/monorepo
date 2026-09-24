import { describe, expect, test } from "vitest";
import { z } from "zod";
import { createFederatedAnthropicFetch } from "#src/anthropic-federation.ts";

type Exchange = { assertion: string; body: Record<string, unknown> };

/** Request URL without stringifying a Request/URL object by coercion. */
function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

/** JSON request body, or a thrown error when the harness sent something else. */
function jsonBody(init: Parameters<typeof fetch>[1]): unknown {
  if (typeof init?.body !== "string") {
    throw new TypeError("expected a JSON request body");
  }
  return JSON.parse(init.body);
}

function harness(options?: { expiresIn?: number }) {
  const exchanges: Exchange[] = [];
  const apiCalls: Headers[] = [];
  let clock = 0;
  let tokenSerial = 0;
  let jwtSerial = 0;
  let failNextExchange = false;

  const fetcher = async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): Promise<Response> => {
    const url = requestUrl(input);
    if (url.endsWith("/v1/oauth/token")) {
      if (failNextExchange) {
        failNextExchange = false;
        return new Response("upstream sad", { status: 503 });
      }
      const body = z
        .object({ assertion: z.string() })
        .loose()
        .parse(jsonBody(init));
      exchanges.push({ assertion: body.assertion, body });
      tokenSerial += 1;
      return Response.json({
        access_token: `sk-ant-oat-${String(tokenSerial)}`,
        expires_in: options?.expiresIn ?? 1200,
        token_type: "Bearer",
      });
    }
    apiCalls.push(new Headers(init?.headers));
    return Response.json({ ok: true });
  };

  const federated = createFederatedAnthropicFetch(
    {
      identityTokenFile: "/var/run/secrets/anthropic.com/token",
      federationRuleId: "fdrl_test",
      organizationId: "00000000-0000-0000-0000-000000000000",
      serviceAccountId: "svac_test",
      workspaceId: "wrkspc_test",
    },
    {
      fetch: fetcher,
      now: () => clock,
      // The kubelet rewrites the projected file, so each read is a fresh JWT.
      readIdentityToken: () => {
        jwtSerial += 1;
        return Promise.resolve(`jwt-${String(jwtSerial)}`);
      },
    },
  );

  return {
    federated,
    exchanges,
    apiCalls,
    advance: (ms: number) => {
      clock += ms;
    },
    failNextExchange: () => {
      failNextExchange = true;
    },
  };
}

describe("Anthropic workload identity federation", () => {
  test("exchanges the projected token and bears the result", async () => {
    const h = harness();
    await h.federated("https://api.anthropic.com/v1/messages", {
      method: "POST",
    });

    expect(h.exchanges).toHaveLength(1);
    expect(h.exchanges[0]?.body).toMatchObject({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      federation_rule_id: "fdrl_test",
      service_account_id: "svac_test",
      workspace_id: "wrkspc_test",
    });
    expect(h.apiCalls[0]?.get("authorization")).toBe("Bearer sk-ant-oat-1");
  });

  test("strips any x-api-key so a static key cannot shadow federation", async () => {
    const h = harness();
    await h.federated("https://api.anthropic.com/v1/messages", {
      headers: { "x-api-key": "sk-ant-leftover" },
    });
    expect(h.apiCalls[0]?.get("x-api-key")).toBeNull();
    expect(h.apiCalls[0]?.get("authorization")).toBe("Bearer sk-ant-oat-1");
  });

  test("reuses a live token and never replays a spent JWT", async () => {
    const h = harness();
    await h.federated("https://api.anthropic.com/v1/messages");
    await h.federated("https://api.anthropic.com/v1/messages");
    expect(h.exchanges).toHaveLength(1);

    // Past the advisory threshold (expiry - 120s) it re-exchanges, and must
    // present a token it has not used before or Anthropic rejects it as
    // jti_reused.
    h.advance(1_100_000);
    await h.federated("https://api.anthropic.com/v1/messages");
    expect(h.exchanges).toHaveLength(2);
    expect(h.exchanges[1]?.assertion).not.toBe(h.exchanges[0]?.assertion);
  });

  test("a failed advisory refresh keeps serving the still-valid token", async () => {
    const h = harness();
    await h.federated("https://api.anthropic.com/v1/messages");
    h.advance(1_100_000);
    h.failNextExchange();

    await h.federated("https://api.anthropic.com/v1/messages");
    // The cached token had ~100s left, which is more than enough to finish the
    // call; a transient token-endpoint blip must not fail user traffic.
    expect(h.apiCalls[1]?.get("authorization")).toBe("Bearer sk-ant-oat-1");
  });

  test("a failed mandatory refresh fails the call instead of sending a stale token", async () => {
    const h = harness();
    await h.federated("https://api.anthropic.com/v1/messages");
    h.advance(1_190_000);
    h.failNextExchange();

    await expect(
      h.federated("https://api.anthropic.com/v1/messages"),
    ).rejects.toThrow("503");
  });

  test("concurrent callers share one exchange", async () => {
    const h = harness();
    await Promise.all([
      h.federated("https://api.anthropic.com/v1/messages"),
      h.federated("https://api.anthropic.com/v1/messages"),
      h.federated("https://api.anthropic.com/v1/messages"),
    ]);
    // Three simultaneous exchanges would present three JWTs and burn two of
    // them for nothing.
    expect(h.exchanges).toHaveLength(1);
  });
});
