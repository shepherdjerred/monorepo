import { describe, expect, test } from "bun:test";
import { startAgentProviderCredentialBroker } from "./agent-provider-credential-broker.ts";

function requiredPort(port: number | undefined): number {
  if (port === undefined) throw new Error("test upstream did not bind a port");
  return port;
}

describe("agent provider credential broker", () => {
  test("injects the real credential only on the fixed Codex upstream", async () => {
    const observedAuthorization: string[] = [];
    const upstream = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        observedAuthorization.push(
          request.headers.get("authorization") ?? "missing",
        );
        return Response.json({ ok: true });
      },
    });
    const broker = startAgentProviderCredentialBroker("codex", {
      sourceEnv: { CODEX_API_KEY: "real-codex-credential" },
      upstreamBaseUrl: `http://127.0.0.1:${requiredPort(upstream.port).toString()}`,
    });

    try {
      const response = await fetch(`${broker.baseUrl}/v1/responses`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${broker.clientToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: "test" }),
      });

      expect(response.status).toBe(200);
      expect(observedAuthorization).toEqual(["Bearer real-codex-credential"]);
      expect(broker.clientToken).not.toContain("real-codex-credential");
    } finally {
      await broker.stop();
      await upstream.stop();
    }
  });

  test("rejects unauthorized and non-provider paths without reaching upstream", async () => {
    let upstreamRequests = 0;
    const upstream = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        upstreamRequests += 1;
        return Response.json({ ok: true });
      },
    });
    const broker = startAgentProviderCredentialBroker("claude", {
      sourceEnv: { CLAUDE_CODE_OAUTH_TOKEN: "real-claude-credential" },
      upstreamBaseUrl: `http://127.0.0.1:${requiredPort(upstream.port).toString()}`,
    });

    try {
      const unauthorized = await fetch(`${broker.baseUrl}/v1/messages`, {
        method: "POST",
      });
      const forbidden = await fetch(`${broker.baseUrl}/arbitrary-target`, {
        method: "POST",
        headers: { Authorization: `Bearer ${broker.clientToken}` },
      });

      expect(unauthorized.status).toBe(401);
      expect(forbidden.status).toBe(403);
      expect(upstreamRequests).toBe(0);
    } finally {
      await broker.stop();
      await upstream.stop();
    }
  });
});
