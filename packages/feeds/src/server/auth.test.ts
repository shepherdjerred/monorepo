import { expect, test } from "vitest";
import {
  authenticateConsole,
  authenticateMachine,
  authFromEnv,
  DEFAULT_FEEDS_PUBLIC_ORIGIN,
  parseTrustedProxyBlockList,
  type FeedsAuthConfig,
} from "./auth.ts";
import {
  classifyFeedsRoute,
  createFeedsMetrics,
  PROMETHEUS_CONTENT_TYPE,
} from "./metrics.ts";

const baseConfig: FeedsAuthConfig = {
  machineToken: "top-secret-machine-token",
  operatorLogins: ["shepherdjerred@gmail.com"],
  trustedProxyAddresses: ["10.244.0.88", "127.0.0.0/8", "fd00::1"],
  publicOrigin: DEFAULT_FEEDS_PUBLIC_ORIGIN,
};

test("authFromEnv applies defaults and rejects mutually exclusive or malformed proxy configuration", () => {
  const defaults = authFromEnv({});
  expect(defaults.machineToken).toBeUndefined();
  expect(defaults.publicOrigin).toBe("https://feeds.tailnet-1a49.ts.net");
  expect(defaults.operatorLogins).toEqual([]);
  expect(defaults.trustedProxyAddresses).toEqual([]);

  const populated = authFromEnv({
    FEEDS_MACHINE_TOKEN: "tok-123",
    FEEDS_PUBLIC_ORIGIN: "https://feeds.example.ts.net",
    FEEDS_TRUSTED_PROXIES: "127.0.0.1, 10.244.0.0/24",
    FEEDS_OPERATOR_LOGINS: "alice@example.com, bob@example.com ",
  });
  expect(populated.machineToken).toBe("tok-123");
  expect(populated.publicOrigin).toBe("https://feeds.example.ts.net");
  expect(populated.operatorLogins).toEqual([
    "alice@example.com",
    "bob@example.com",
  ]);
  expect(populated.trustedProxyAddresses).toEqual([
    "127.0.0.1",
    "10.244.0.0/24",
  ]);

  expect(() =>
    authFromEnv({
      FEEDS_TRUSTED_PROXIES: "127.0.0.1",
      FEEDS_INGRESS_IDENTITY_DIR: "/var/run/feeds-ingress",
    }),
  ).toThrow(/either FEEDS_TRUSTED_PROXIES or FEEDS_INGRESS_IDENTITY_DIR/);

  expect(() => parseTrustedProxyBlockList(["not-an-ip"])).toThrow(
    /Invalid FEEDS_TRUSTED_PROXIES entry/,
  );
  expect(() => parseTrustedProxyBlockList(["10.0.0.1/33"])).toThrow(
    /Invalid FEEDS_TRUSTED_PROXIES entry/,
  );
  expect(() => parseTrustedProxyBlockList(["fd00::1/129"])).toThrow(
    /Invalid FEEDS_TRUSTED_PROXIES entry/,
  );
  expect(() =>
    authFromEnv({
      FEEDS_PUBLIC_ORIGIN: "not-a-valid-url",
    }),
  ).toThrow(/FEEDS_PUBLIC_ORIGIN is not a URL/);
});

test("authenticateMachine strictly requires Authorization: Bearer <FEEDS_MACHINE_TOKEN>", () => {
  expect(
    authenticateMachine(
      new Request("http://feeds:7430/internal/refresh", {
        method: "POST",
        headers: { authorization: "Bearer top-secret-machine-token" },
      }),
      baseConfig,
    ),
  ).toEqual({ kind: "machine" });

  for (const headers of [
    undefined,
    { authorization: "Bearer wrong-token" },
    { authorization: "Bearer short" },
    { authorization: "Bearer " },
    { authorization: "bearer top-secret-machine-token" },
    { authorization: "Basic dGVzdDp0ZXN0" },
    { "tailscale-user-login": "shepherdjerred@gmail.com" },
  ]) {
    expect(
      authenticateMachine(
        new Request("http://feeds:7430/internal/refresh", {
          method: "POST",
          ...(headers === undefined ? {} : { headers }),
        }),
        baseConfig,
      ),
    ).toEqual({ status: 401, error: "invalid machine credential" });
  }

  expect(
    authenticateMachine(
      new Request("http://feeds:7430/internal/refresh", {
        method: "POST",
        headers: { authorization: "Bearer anything" },
      }),
      { ...baseConfig, machineToken: undefined },
    ),
  ).toEqual({ status: 401, error: "invalid machine credential" });
});

test("authenticateConsole enforces trusted proxy peer IP, operator login, and same-origin writes", async () => {
  // Exact IPv4, IPv4-mapped IPv6, CIDR subnet, and IPv6 peers succeed on GET without Origin.
  for (const peer of [
    "10.244.0.88",
    "::ffff:10.244.0.88",
    "127.0.0.5",
    "fd00::1",
  ]) {
    const result = await authenticateConsole(
      new Request("https://feeds.tailnet-1a49.ts.net/api/v1/summary", {
        headers: { "tailscale-user-login": "shepherdjerred@gmail.com" },
      }),
      peer,
      baseConfig,
    );
    expect(result).toEqual({
      kind: "human",
      login: "shepherdjerred@gmail.com",
    });
  }

  // Null, malformed, or untrusted peer IP is rejected with 401.
  for (const badPeer of [null, "not-an-ip", "10.244.0.99"]) {
    const result = await authenticateConsole(
      new Request("https://feeds.tailnet-1a49.ts.net/api/v1/summary", {
        headers: { "tailscale-user-login": "shepherdjerred@gmail.com" },
      }),
      badPeer,
      baseConfig,
    );
    expect(result).toEqual({
      status: 401,
      error: "authenticated private ingress required",
    });
  }

  // Missing or unauthorized Tailscale-User-Login is rejected with 403.
  for (const login of [undefined, "intruder@example.com"]) {
    const result = await authenticateConsole(
      new Request("https://feeds.tailnet-1a49.ts.net/api/v1/summary", {
        headers: login === undefined ? {} : { "tailscale-user-login": login },
      }),
      "10.244.0.88",
      baseConfig,
    );
    expect(result).toEqual({
      status: 403,
      error: "operator identity is not authorized",
    });
  }

  // Non-GET/HEAD/OPTIONS requests require exact same-origin Origin header.
  for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
    const missingOrigin = await authenticateConsole(
      new Request("https://feeds.tailnet-1a49.ts.net/api/v1/refresh", {
        method,
        headers: { "tailscale-user-login": "shepherdjerred@gmail.com" },
      }),
      "10.244.0.88",
      baseConfig,
    );
    expect(missingOrigin).toEqual({
      status: 403,
      error: "same-origin browser request required",
    });

    const crossOrigin = await authenticateConsole(
      new Request("https://feeds.tailnet-1a49.ts.net/api/v1/refresh", {
        method,
        headers: {
          "tailscale-user-login": "shepherdjerred@gmail.com",
          origin: "https://evil.example.com",
        },
      }),
      "10.244.0.88",
      baseConfig,
    );
    expect(crossOrigin).toEqual({
      status: 403,
      error: "same-origin browser request required",
    });

    const sameOrigin = await authenticateConsole(
      new Request("https://feeds.tailnet-1a49.ts.net/api/v1/refresh", {
        method,
        headers: {
          "tailscale-user-login": "shepherdjerred@gmail.com",
          origin: "https://feeds.tailnet-1a49.ts.net",
        },
      }),
      "10.244.0.88",
      baseConfig,
    );
    expect(sameOrigin).toEqual({
      kind: "human",
      login: "shepherdjerred@gmail.com",
    });
  }
});

test("createFeedsMetrics renders Prometheus gauges and bounded surface/route counters", () => {
  expect(PROMETHEUS_CONTENT_TYPE).toBe(
    "text/plain; version=0.0.4; charset=utf-8",
  );
  const metrics = createFeedsMetrics();
  metrics.recordPollRun("ok");
  metrics.recordPollRun({
    skippedByFlag: true,
    polled: 0,
    notModified: 0,
    updated: 0,
    failed: 0,
    backedOff: 0,
    newEntries: 0,
    autoReadEntries: 0,
    durationMs: 1,
  });
  metrics.recordRequest(
    "console",
    classifyFeedsRoute("console", "GET", "/api/v1/summary", true),
    200,
  );
  metrics.recordRequest(
    "reader",
    classifyFeedsRoute(
      "reader",
      "POST",
      "/api/greader.php/reader/api/0/stream/items/contents",
      false,
    ),
    200,
  );
  metrics.recordRequest(
    "console",
    classifyFeedsRoute("console", "GET", "/starred", true),
    200,
  );

  const rendered = metrics.render({
    views: { unread: 12, all: 340, starred: 5, autoRead: 29 },
    categories: [],
    stats: {
      totalFeeds: 42,
      codeFeeds: 39,
      userFeeds: 3,
      failingFeeds: 1,
      lastPolledAt: 1_795_576_000,
    },
  });

  expect(rendered).toContain('feeds_subscriptions_total{source="code"} 39');
  expect(rendered).toContain('feeds_subscriptions_total{source="user"} 3');
  expect(rendered).toContain("feeds_subscriptions_failing 1");
  expect(rendered).toContain("feeds_entries_unread 12");
  expect(rendered).toContain("feeds_entries_starred 5");
  expect(rendered).toContain("feeds_entries_auto_read 29");
  expect(rendered).toContain("feeds_last_poll_timestamp_seconds 1795576000");
  expect(rendered).toContain('feeds_poll_runs_total{outcome="ok"} 1');
  expect(rendered).toContain('feeds_poll_runs_total{outcome="skipped_flag"} 1');
  expect(rendered).toContain('feeds_poll_runs_total{outcome="failed"} 0');
  expect(rendered).toContain(
    'feeds_http_requests_total{surface="console",route="v1_summary",status="200"} 1',
  );
  expect(rendered).toContain(
    'feeds_http_requests_total{surface="reader",route="greader_stream_contents",status="200"} 1',
  );
  expect(rendered).toContain(
    'feeds_http_requests_total{surface="console",route="client",status="200"} 1',
  );
});
