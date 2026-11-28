import { afterEach, describe, expect, test } from "vitest";
import { z } from "zod";
import {
  PollRunSummarySchema,
  SummaryResponseSchema,
} from "./shared/contract.ts";
import { startServer, type FeedsServer } from "./server.ts";
import { createCatalogTestRepository } from "./server/test-catalog-repository.ts";
import type { FeedsRepository } from "./server/types.ts";

const SubscriptionsBodySchema = z.object({
  subscriptions: z.array(z.object({ id: z.string() })),
});

const activeServers: FeedsServer[] = [];

/** The code catalog in memory; PostgreSQL behaviour is covered by the store contract. */
function memoryStore(): FeedsRepository {
  return createCatalogTestRepository();
}

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
    store: memoryStore(),
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

function baseConsoleEnv(
  overrides: Record<string, string | undefined>,
): NodeJS.ProcessEnv {
  return {
    FEEDS_PUBLIC_ORIGIN: "https://feeds.tailnet-1a49.ts.net",
    FEEDS_TRUSTED_PROXIES: "127.0.0.1",
    FEEDS_OPERATOR_LOGINS: "shepherdjerred@gmail.com",
    FEEDS_MACHINE_TOKEN: "machine-secret-token",
    ...overrides,
  };
}

async function bootFlaggedConsoleServer(
  overrides: Record<string, string | undefined>,
): Promise<{ server: FeedsServer; getFetchCalls: () => number }> {
  let fetchCalls = 0;
  const server = await startServer(0, "127.0.0.1", {
    env: baseConsoleEnv(overrides),
    store: memoryStore(),
    fetchFeed: (url) => {
      fetchCalls += 1;
      return Promise.resolve({
        status: 304,
        finalUrl: url,
        headers: new Headers(),
        body: "",
      });
    },
  });
  activeServers.push(server);
  return { server, getFetchCalls: () => fetchCalls };
}

async function postInternalRefresh(port: number): Promise<Response> {
  return fetch(`http://127.0.0.1:${String(port)}/internal/refresh`, {
    method: "POST",
    headers: { authorization: "Bearer machine-secret-token" },
  });
}

describe("feeds storage", () => {
  test("refuses to start without DATABASE_URL", async () => {
    await expect(
      startServer(0, "127.0.0.1", {
        env: baseConsoleEnv({ FEATURE_FLAGS_MODE: "disabled" }),
      }),
    ).rejects.toThrow("DATABASE_URL is required");
  });
});

describe("feeds-refresh-enabled feature-flag evaluation", () => {
  test("skips polling when feeds-refresh-enabled resolves to explicit false", async () => {
    const { server, getFetchCalls } = await bootFlaggedConsoleServer({
      FEATURE_FLAGS_MODE: "static",
      FEATURE_FLAGS_STATIC_OVERRIDES: JSON.stringify({
        "feeds-refresh-enabled": false,
      }),
    });

    const res = await postInternalRefresh(server.port);
    expect(res.status).toBe(200);
    const summary = PollRunSummarySchema.parse(await res.json());
    expect(summary.skippedByFlag).toBe(true);
    expect(getFetchCalls()).toBe(0);
  });

  test("polls all catalog feeds when feeds-refresh-enabled resolves to true", async () => {
    const { server, getFetchCalls } = await bootFlaggedConsoleServer({
      FEATURE_FLAGS_MODE: "static",
      FEATURE_FLAGS_STATIC_OVERRIDES: JSON.stringify({
        "feeds-refresh-enabled": true,
      }),
    });

    const res = await postInternalRefresh(server.port);
    expect(res.status).toBe(200);
    const summary = PollRunSummarySchema.parse(await res.json());
    expect(summary.skippedByFlag).toBe(false);
    expect(summary.notModified).toBe(65);
    expect(getFetchCalls()).toBe(65);
  });

  test("falls back to default true when the flags service is unreachable", async () => {
    const { server, getFetchCalls } = await bootFlaggedConsoleServer({
      FEATURE_FLAGS_MODE: "flags",
      FLAGS_URL: "http://127.0.0.1:1",
      FLAGS_DEPLOYMENT: "feeds/prod",
    });

    const res = await postInternalRefresh(server.port);
    expect(res.status).toBe(200);
    const summary = PollRunSummarySchema.parse(await res.json());
    expect(summary.skippedByFlag).toBe(false);
    expect(getFetchCalls()).toBe(65);
  });

  test("fails loudly when feeds-refresh-enabled is absent from static inventory or overrides are invalid", async () => {
    await expect(
      startServer(0, "127.0.0.1", {
        env: baseConsoleEnv({
          FEATURE_FLAGS_MODE: "static",
          FEATURE_FLAGS_STATIC_OVERRIDES: JSON.stringify({
            "feeds-refresh-enabled": { nested: true },
          }),
        }),
        store: memoryStore(),
      }),
    ).rejects.toThrow();

    const { server } = await bootFlaggedConsoleServer({
      FEATURE_FLAGS_MODE: "static",
      FEATURE_FLAGS_STATIC_OVERRIDES: "{}",
    });

    const res = await postInternalRefresh(server.port);
    expect(res.status).toBe(500);
  });
});
