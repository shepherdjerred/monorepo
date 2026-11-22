import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import type { ConfigSource } from "@shepherdjerred/config/source.ts";
import { handle } from "./server.ts";
import {
  createStormStatsBehaviorResolver,
  loadStormStatsBootstrap,
  verifyBearerToken,
} from "./server/config.ts";
import { startStormStatsServer } from "./server/index.ts";
import { computeActivityIndex, toPacificParts } from "./server/time.ts";

describe("stateless probe handler", () => {
  test("reports health", async () => {
    const response = handle(new Request("http://localhost/healthz"));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
  });

  test("answers 404 elsewhere", () => {
    expect(handle(new Request("http://localhost/")).status).toBe(404);
  });
});

describe("bootstrap & layered feature-flag configuration", () => {
  test("validates ports, database defaults, and ingest token requirements", () => {
    const devCfg = loadStormStatsBootstrap({});
    expect(devCfg.host).toBe("0.0.0.0");
    expect(devCfg.port).toBe(7420);
    expect(devCfg.adminPort).toBeUndefined();
    expect(devCfg.ingestPort).toBeUndefined();
    expect(devCfg.databasePath).toBe(":memory:");
    expect(devCfg.featureFlagsMode).toBe("disabled");

    const prodCfg = loadStormStatsBootstrap({ ENVIRONMENT: "production" });
    expect(prodCfg.databasePath).toBe(
      "/var/lib/storm-stats/storm-stats.sqlite",
    );

    expect(() =>
      loadStormStatsBootstrap({
        PORT: "7420",
        STORM_STATS_ADMIN_PORT: "7420",
      }),
    ).toThrow(/must differ/);

    expect(() =>
      loadStormStatsBootstrap({
        STORM_STATS_INGEST_PORT: "7422",
        STORM_STATS_INGEST_TOKEN: "too-short",
      }),
    ).toThrow(/at least 24 characters/);
  });

  test("resolves flag -> env -> default with explicit false, failure fallback, and invalid rejection", async () => {
    // 1. Absence falls through to true defaults
    const defaultResolver = createStormStatsBehaviorResolver({
      env: {},
      flagsDisabled: true,
    });
    expect(await defaultResolver.get("ingestEnabled")).toEqual({
      value: true,
      source: "default",
    });
    expect(await defaultResolver.get("publicEnabled")).toEqual({
      value: true,
      source: "default",
    });

    // 2. Explicit false from flag stops waterfall even when env is "true"
    const falseFlagSource: ConfigSource = {
      name: "flag",
      get: async (names) =>
        names.key === "publicEnabled" ? { value: false } : undefined,
    };
    const flagOverrideResolver = createStormStatsBehaviorResolver({
      env: {
        STORM_STATS_PUBLIC_ENABLED: "true",
        STORM_STATS_INGEST_ENABLED: "false",
      },
      flagSource: falseFlagSource,
    });
    expect(await flagOverrideResolver.get("publicEnabled")).toEqual({
      value: false,
      source: "flag",
    });
    expect(await flagOverrideResolver.get("ingestEnabled")).toEqual({
      value: false,
      source: "env",
    });

    // 3. Failing non-fatal source logs error and falls back to env/default
    const errors: string[] = [];
    const failingFlagSource: ConfigSource = {
      name: "flag",
      get: async () => {
        throw new Error("flags unreachable");
      },
    };
    const fallbackResolver = createStormStatsBehaviorResolver({
      env: { STORM_STATS_PUBLIC_ENABLED: "0" },
      flagSource: failingFlagSource,
      onSourceError: (key, source, msg) => {
        errors.push(`${key}:${source}:${msg}`);
      },
    });
    expect(await fallbackResolver.get("publicEnabled")).toEqual({
      value: false,
      source: "env",
    });
    expect(errors).toEqual(["publicEnabled:flag:flags unreachable"]);

    // 4. Present invalid value throws
    const invalidResolver = createStormStatsBehaviorResolver({
      env: { STORM_STATS_INGEST_ENABLED: "not-a-boolean" },
      flagsDisabled: true,
    });
    await expect(invalidResolver.value("ingestEnabled")).rejects.toThrow();
  });

  test("constant-time bearer verification handles mismatched lengths safely", () => {
    const secret = "storm-stats-ingest-token-alpha-9999";
    expect(verifyBearerToken(`Bearer ${secret}`, secret)).toBe(true);
    expect(verifyBearerToken("Bearer short", secret)).toBe(false);
    expect(
      verifyBearerToken(`Bearer ${secret}-with-extra-suffix-bytes`, secret),
    ).toBe(false);
    expect(verifyBearerToken("Basic abcdef", secret)).toBe(false);
    expect(verifyBearerToken(undefined, secret)).toBe(false);
  });
});

describe("Plan Activity Index & Pacific timezone math", () => {
  test("computes Plan 3-week weighted Activity Index and groups accurately", () => {
    expect(computeActivityIndex(0, 0, 0)).toEqual({
      activityIndex: 0,
      activityGroup: "inactive",
    });

    // Heavy 3-week regular player (18h/week = 64,800,000 ms each week -> 3.71)
    const regular = computeActivityIndex(64_800_000, 64_800_000, 64_800_000);
    expect(regular.activityIndex).toBeGreaterThanOrEqual(3.5);
    expect(regular.activityGroup).toBe("regular");

    // Threshold player (~2h/week = 7,200,000 ms -> 5 / (1 + pi) = 1.21 -> irregular;
    // ~4h/week = 14,400,000 ms -> 5 / (1 + pi/2) = 1.94 -> active)
    const active = computeActivityIndex(14_400_000, 14_400_000, 14_400_000);
    expect(active.activityIndex).toBeGreaterThanOrEqual(1.75);
    expect(active.activityIndex).toBeLessThan(3.5);
    expect(active.activityGroup).toBe("active");

    const irregular = computeActivityIndex(7_200_000, 0, 0);
    expect(irregular.activityIndex).toBeGreaterThanOrEqual(0.5);
    expect(irregular.activityIndex).toBeLessThan(1.75);
    expect(irregular.activityGroup).toBe("irregular");
  });

  test("buckets timestamps in America/Los_Angeles across PST/PDT", () => {
    // 2026-07-05T03:30:00Z is Saturday 2026-07-04 20:30 PDT (dayOfWeek = 5)
    const summer = toPacificParts("2026-07-05T03:30:00Z");
    expect(summer).toEqual({
      day: "2026-07-04",
      dayOfWeek: 5,
      hour: 20,
    });

    // 2026-11-23T09:15:00Z is Monday 2026-11-23 01:15 PST (dayOfWeek = 0)
    const winter = toPacificParts("2026-11-23T09:15:00Z");
    expect(winter).toEqual({
      day: "2026-11-23",
      dayOfWeek: 0,
      hour: 1,
    });
  });
});

describe("multi-port Bun.serve lifecycle & SPA serving", () => {
  test("binds public, staff admin, and ingest ports with SPA assets and strict route isolation", async () => {
    const tempClientDir = `${os.tmpdir()}/storm-stats-spa-${crypto.randomUUID()}`;
    await Bun.write(
      path.join(tempClientDir, "index.html"),
      '<!doctype html><html><body><div id="root"></div><script type="module" src="/assets/app-123.js"></script></body></html>',
    );
    await Bun.write(
      path.join(tempClientDir, "assets", "app-123.js"),
      "console.log('storm-stats');",
    );
    await Bun.write(path.join(tempClientDir, "favicon.svg"), "<svg></svg>");

    const running = await startStormStatsServer({
      port: 0,
      hostname: "127.0.0.1",
      clientRoot: tempClientDir,
      env: {
        STORM_STATS_ADMIN_PORT: "0",
        STORM_STATS_INGEST_PORT: "0",
        STORM_STATS_INGEST_TOKEN: "test-storm-stats-token-with-24-plus-chars",
        STORM_STATS_SEED_DEMO: "true",
        FEATURE_FLAGS_MODE: "disabled",
      },
    });

    try {
      expect(running.port).toBeGreaterThan(0);
      expect(running.adminPort).toBeGreaterThan(0);
      expect(running.ingestPort).toBeGreaterThan(0);

      const pubBase = `http://127.0.0.1:${String(running.port)}`;
      const staffBase = `http://127.0.0.1:${String(running.adminPort)}`;
      const ingestBase = `http://127.0.0.1:${String(running.ingestPort)}`;

      // Public SPA & assets
      const spaRes = await fetch(`${pubBase}/players/some-player`);
      expect(spaRes.status).toBe(200);
      expect(spaRes.headers.get("cache-control")).toBe("no-cache");
      expect(await spaRes.text()).toContain('<div id="root"></div>');

      const assetRes = await fetch(`${pubBase}/assets/app-123.js`);
      expect(assetRes.status).toBe(200);
      expect(assetRes.headers.get("cache-control")).toBe(
        "public, max-age=31536000, immutable",
      );

      const missingAsset = await fetch(`${pubBase}/assets/does-not-exist.js`);
      expect(missingAsset.status).toBe(404);

      const favRes = await fetch(`${pubBase}/favicon.svg`);
      expect(favRes.status).toBe(200);

      // CRITICAL SECURITY INVARIANT: /api/staff/* on public port returns 404 JSON, never HTML!
      const staffOnPublic = await fetch(`${pubBase}/api/staff/network`);
      expect(staffOnPublic.status).toBe(404);
      expect(staffOnPublic.headers.get("content-type")).toContain(
        "application/json",
      );
      expect(await staffOnPublic.json()).toEqual({ error: "Not found" });

      const ingestOnPublic = await fetch(`${pubBase}/api/v1/ingest`, {
        method: "POST",
      });
      expect(ingestOnPublic.status).toBe(404);

      // Staff listener serves staff viewer & staff endpoints + SPA
      const staffViewerRes = await fetch(`${staffBase}/api/v1/viewer`);
      const staffViewer = await staffViewerRes.json();
      expect(staffViewer.role).toBe("staff");

      const staffNet = await fetch(`${staffBase}/api/staff/network`);
      expect(staffNet.status).toBe(200);

      // Ingest listener checks auth
      const unauth = await fetch(`${ingestBase}/api/v1/ingest`, {
        method: "POST",
      });
      expect(unauth.status).toBe(401);

      // Prometheus metrics exposed
      const metricsRes = await fetch(`${pubBase}/metrics`);
      expect(metricsRes.status).toBe(200);
      const metricsBody = await metricsRes.text();
      expect(metricsBody).toContain("storm_stats_http_requests_total");
      expect(metricsBody).toContain(
        'storm_stats_players_total{service="storm-stats"} 28',
      );
    } finally {
      await running.stop(true);
    }
  });
});
