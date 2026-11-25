import { afterEach, describe, expect, test } from "vitest";
import { z } from "zod";
import {
  PollRunSummarySchema,
  SummaryResponseSchema,
} from "./shared/contract.ts";
import { startServer, type FeedsServer } from "./server.ts";

const SubscriptionsBodySchema = z.object({
  subscriptions: z.array(z.object({ id: z.string() })),
});

const activeServers: FeedsServer[] = [];

afterEach(async () => {
  while (activeServers.length > 0) {
    const server = activeServers.pop();
    if (server !== undefined) {
      await server.stop(true);
    }
  }
});

async function bootDualListenerServer(): Promise<FeedsServer> {
  const server = await startServer(0, "127.0.0.1", {
    env: {
      FEEDS_READER_PORT: "0",
      FEEDS_DATABASE_PATH: ":memory:",
      FEEDS_PUBLIC_ORIGIN: "https://feeds.tailnet-1a49.ts.net",
      FEEDS_TRUSTED_PROXIES: "127.0.0.1",
      FEEDS_OPERATOR_LOGINS: "shepherdjerred@gmail.com",
      FEEDS_MACHINE_TOKEN: "machine-secret-token",
      FEEDS_READER_USER: "sjerred",
      FEEDS_READER_PASSWORD: "reader-secret-password",
      FEEDS_WRITE_TOKEN_SECRET: "write-token-secret",
      FEATURE_FLAGS_MODE: "disabled",
    },
    shouldRefresh: async () => false,
  });
  activeServers.push(server);
  return server;
}

describe("feeds dual-listener isolation and end-to-end HTTP surfaces", () => {
  test("isolates public reader port from console UI, metrics, v1 API, and internal refresh", async () => {
    const server = await bootDualListenerServer();
    expect(server.readerPort).toBeDefined();
    const readerOrigin = `http://127.0.0.1:${String(server.readerPort)}`;
    const consoleOrigin = `http://127.0.0.1:${String(server.port)}`;

    // Reader port serves /healthz and /api/greader.php/* only
    const readerHealth = await fetch(`${readerOrigin}/healthz`);
    expect(readerHealth.status).toBe(200);
    expect(await readerHealth.text()).toBe("ok");

    for (const forbiddenPath of [
      "/",
      "/metrics",
      "/api/v1/summary",
      "/api/v1/entries",
      "/api/v1/feeds",
    ]) {
      const res = await fetch(`${readerOrigin}${forbiddenPath}`, {
        headers: {
          "tailscale-user-login": "shepherdjerred@gmail.com",
          authorization: "Bearer machine-secret-token",
        },
      });
      expect(res.status, forbiddenPath).toBe(404);
    }

    const readerInternalRefresh = await fetch(
      `${readerOrigin}/internal/refresh`,
      {
        method: "POST",
        headers: { authorization: "Bearer machine-secret-token" },
      },
    );
    expect(readerInternalRefresh.status).toBe(404);

    // Reader port authenticates NetNewsWire ClientLogin and lists seeded 65 feeds
    const loginRes = await fetch(
      `${readerOrigin}/api/greader.php/accounts/ClientLogin`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "Email=sjerred&Passwd=reader-secret-password",
      },
    );
    expect(loginRes.status).toBe(200);
    const loginBody = await loginRes.text();
    const authToken = loginBody
      .split("\n")
      .find((line) => line.startsWith("Auth="))
      ?.slice(5);
    expect(authToken).toMatch(/^[0-9a-f]{64}$/u);

    const subsRes = await fetch(
      `${readerOrigin}/api/greader.php/reader/api/0/subscription/list?output=json`,
      {
        headers: { authorization: `GoogleLogin auth=${String(authToken)}` },
      },
    );
    expect(subsRes.status).toBe(200);
    const subsJson = SubscriptionsBodySchema.parse(await subsRes.json());
    expect(subsJson.subscriptions).toHaveLength(65);

    // Console port enforces Tailscale operator login and CSRF Origin on /api/v1/*
    const unauthSummary = await fetch(`${consoleOrigin}/api/v1/summary`);
    expect(unauthSummary.status).toBe(403);

    const summaryRes = await fetch(`${consoleOrigin}/api/v1/summary`, {
      headers: { "tailscale-user-login": "shepherdjerred@gmail.com" },
    });
    expect(summaryRes.status).toBe(200);
    const summary = SummaryResponseSchema.parse(await summaryRes.json());
    expect(summary.stats.codeFeeds).toBe(65);
    expect(summary.stats.userFeeds).toBe(0);

    // Cross-origin POST is rejected even with valid Tailscale login
    const badOriginPost = await fetch(`${consoleOrigin}/api/v1/refresh`, {
      method: "POST",
      headers: {
        "tailscale-user-login": "shepherdjerred@gmail.com",
        origin: "https://evil.example.com",
      },
    });
    expect(badOriginPost.status).toBe(403);

    // Machine Bearer token triggers /internal/refresh on console port
    const badMachine = await fetch(`${consoleOrigin}/internal/refresh`, {
      method: "POST",
      headers: { authorization: "Bearer wrong-token" },
    });
    expect(badMachine.status).toBe(401);

    const okMachine = await fetch(`${consoleOrigin}/internal/refresh`, {
      method: "POST",
      headers: { authorization: "Bearer machine-secret-token" },
    });
    expect(okMachine.status).toBe(200);
    const pollSummary = PollRunSummarySchema.parse(await okMachine.json());
    expect(pollSummary.skippedByFlag).toBe(true);

    // Metrics endpoint renders request and subscription counters across both surfaces
    const metricsRes = await fetch(`${consoleOrigin}/metrics`);
    expect(metricsRes.status).toBe(200);
    const metricsText = await metricsRes.text();
    expect(metricsText).toContain(
      'feeds_subscriptions_total{source="code"} 65',
    );
    expect(metricsText).toContain(
      'surface="reader",route="greader_login",status="200"',
    );
    expect(metricsText).toContain(
      'surface="console",route="internal_refresh",status="200"',
    );
  });
});
