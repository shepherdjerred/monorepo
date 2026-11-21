import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createInMemoryManualLinkRepository } from "#infrastructure/db.ts";
import { extractTailscaleHostsFromK8sResources } from "#infrastructure/k8s-discovery.ts";
import { createGolinkMetrics } from "#infrastructure/telemetry.ts";
import {
  LinkItemSchema,
  LinksDirectoryResponseSchema,
} from "#shared/contract.ts";
import { createGolinkApp } from "./app.ts";

const TAILNET = "tailnet-1a49.ts.net";

function createTestHarness(options?: {
  readonly dynamicAliasesEnabled?: boolean;
  readonly writesEnabled?: boolean;
  readonly healthy?: boolean;
  readonly clientRoot?: string;
}) {
  let healthy = options?.healthy ?? true;
  const repo = createInMemoryManualLinkRepository({
    initial: [
      {
        short: "ha",
        targetUrl: "https://homeassistant.tailnet-1a49.ts.net/lovelace",
        createdBy: "seed",
      },
    ],
    healthy: () => healthy,
  });
  const metrics = createGolinkMetrics();
  const app = createGolinkApp({
    repo,
    getIngressHosts: () => [`grafana.${TAILNET}`, `temporal-ui.${TAILNET}`],
    platformSites: [
      {
        short: "wiki",
        targetUrl: "https://wiki.sjer.red/",
        detail: "Static site (wiki.sjer.red)",
      },
      {
        short: "grafana",
        targetUrl: "https://grafana.sjer.red/",
        detail: "Public service (prometheus/grafana)",
      },
    ],
    tailnetDomain: TAILNET,
    dynamicAliasesEnabled: () =>
      Promise.resolve(options?.dynamicAliasesEnabled ?? true),
    writesEnabled: () => Promise.resolve(options?.writesEnabled ?? true),
    metrics,
    ...(options?.clientRoot === undefined
      ? {}
      : { clientRoot: options.clientRoot }),
  });

  return {
    app,
    repo,
    setHealthy: (next: boolean) => {
      healthy = next;
    },
  };
}

describe("createGolinkApp HTTP routes", () => {
  it("serves /healthz and /readyz reflecting database readiness", async () => {
    const { app, setHealthy } = createTestHarness();

    const health = await app.request("http://go.local/healthz");
    expect(health.status).toBe(200);
    expect(await health.text()).toBe("ok");

    const readyOk = await app.request("http://go.local/readyz");
    expect(readyOk.status).toBe(200);
    expect(await readyOk.text()).toBe("ready");

    setHealthy(false);
    const readyDown = await app.request("http://go.local/readyz");
    expect(readyDown.status).toBe(503);
    expect(await readyDown.text()).toBe("not ready");
  });

  it("returns directory catalog and viewer identity from Tailscale headers", async () => {
    const { app } = createTestHarness();

    const response = await app.request("http://go.local/api/links", {
      headers: {
        "Tailscale-User-Login": "jerred@sjer.red",
        "Tailscale-User-Name": "Jerred Shepherd",
      },
    });
    expect(response.status).toBe(200);
    const body = LinksDirectoryResponseSchema.parse(await response.json());

    expect(body.viewer).toEqual({
      login: "jerred@sjer.red",
      displayName: "Jerred Shepherd",
    });
    expect(body.dynamicAliasesEnabled).toBe(true);
    expect(body.writesEnabled).toBe(true);
    expect(body.shortcuts.length).toBeGreaterThan(0);

    const shorts = new Map(body.links.map((item) => [item.short, item]));
    expect(shorts.get("ha")?.kind).toBe("manual");
    expect(shorts.get("grafana")?.kind).toBe("ingress");
    expect(shorts.get("grafana")?.targetUrl).toBe(
      "https://grafana.tailnet-1a49.ts.net/",
    );
    expect(shorts.get("temporal")?.kind).toBe("alias");
    expect(shorts.get("wiki")?.kind).toBe("site");
  });

  it("validates, upserts, exports, and deletes manual links while enforcing writesEnabled", async () => {
    const readOnly = createTestHarness({ writesEnabled: false });
    const forbiddenCreate = await readOnly.app.request(
      "http://go.local/api/links",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          short: "docs",
          targetUrl: "https://wiki.sjer.red/",
        }),
      },
    );
    expect(forbiddenCreate.status).toBe(403);

    const forbiddenDelete = await readOnly.app.request(
      "http://go.local/api/links/ha",
      { method: "DELETE" },
    );
    expect(forbiddenDelete.status).toBe(403);

    const { app } = createTestHarness({ writesEnabled: true });

    const invalidScheme = await app.request("http://go.local/api/links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        short: "bad",
        targetUrl: "javascript:alert(1)",
      }),
    });
    expect(invalidScheme.status).toBe(400);

    const reservedSlug = await app.request("http://go.local/api/links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        short: "metrics",
        targetUrl: "https://example.com/",
      }),
    });
    expect(reservedSlug.status).toBe(400);

    const createShadowing = await app.request("http://go.local/api/links", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Tailscale-User-Login": "jerred@sjer.red",
      },
      body: JSON.stringify({
        short: "Grafana",
        targetUrl: "https://grafana.tailnet-1a49.ts.net/d/homelab",
      }),
    });
    expect(createShadowing.status).toBe(200);
    const createdItem = LinkItemSchema.parse(await createShadowing.json());
    expect(createdItem.short).toBe("grafana");
    expect(createdItem.createdBy).toBe("jerred@sjer.red");
    expect(createdItem.shadows?.kind).toBe("ingress");

    const exported = await app.request("http://go.local/.export");
    expect(exported.status).toBe(200);
    const exportedBody = await exported.text();
    const exportLines = exportedBody
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(exportLines).toHaveLength(2);
    expect(exportLines[0]).toMatchObject({
      Short: "grafana",
      Long: "https://grafana.tailnet-1a49.ts.net/d/homelab",
      Owner: "jerred@sjer.red",
    });

    const deleted = await app.request("http://go.local/api/links/grafana", {
      method: "DELETE",
    });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ deleted: true });
  });

  it("redirects matched slugs with 302 + Cache-Control: no-store, tracks manual clicks, and exposes Prometheus metrics", async () => {
    const { app, repo } = createTestHarness();

    const manualRedirect = await app.request(
      "http://go.local/ha/overview?room=office",
    );
    expect(manualRedirect.status).toBe(302);
    expect(manualRedirect.headers.get("Location")).toBe(
      "https://homeassistant.tailnet-1a49.ts.net/lovelace/overview?room=office",
    );
    expect(manualRedirect.headers.get("Cache-Control")).toBe("no-store");

    await Bun.sleep(10);
    const updatedHa = await repo.findByShort("ha");
    expect(updatedHa?.clicks).toBe(1);
    expect(updatedHa?.lastClickedAt).not.toBeNull();

    const shortcutRedirect = await app.request("http://go.local/pr/4782");
    expect(shortcutRedirect.status).toBe(302);
    expect(shortcutRedirect.headers.get("Location")).toBe(
      "https://github.com/shepherdjerred/monorepo/pull/4782",
    );

    const metricsRes = await app.request("http://go.local/metrics");
    expect(metricsRes.status).toBe(200);
    const metricsText = await metricsRes.text();
    expect(metricsText).toContain(
      'golink_redirects_total{kind="manual",service="golink"} 1',
    );
    expect(metricsText).toContain(
      'golink_redirects_total{kind="shortcut",service="golink"} 1',
    );
    expect(metricsText).toContain("golink_links_configured");
  });

  it("serves SPA index.html with 404 for browser misses and JSON 404 for API/CLI misses", async () => {
    const clientRoot = path.join(
      tmpdir(),
      `golink-client-test-${crypto.randomUUID()}`,
    );
    await Bun.write(
      path.join(clientRoot, "index.html"),
      '<!doctype html><html><body><div id="root"></div><script type="module" src="/assets/app-123.js"></script></body></html>',
      { createPath: true },
    );
    await Bun.write(
      path.join(clientRoot, "assets/app-123.js"),
      "console.warn('bundle');",
      { createPath: true },
    );

    const { app } = createTestHarness({ clientRoot });

    const rootPage = await app.request("http://go.local/");
    expect(rootPage.status).toBe(200);
    expect(await rootPage.text()).toContain('<div id="root"></div>');

    const asset = await app.request("http://go.local/assets/app-123.js");
    expect(asset.status).toBe(200);
    expect(asset.headers.get("Cache-Control")).toContain("immutable");

    const browserMiss = await app.request("http://go.local/new-slug", {
      headers: { Accept: "text/html,application/xhtml+xml" },
    });
    expect(browserMiss.status).toBe(404);
    expect(await browserMiss.text()).toContain('<div id="root"></div>');

    const jsonMiss = await app.request("http://go.local/new-slug", {
      headers: { Accept: "application/json" },
    });
    expect(jsonMiss.status).toBe(404);
    expect(await jsonMiss.json()).toEqual({
      error: "Link not found",
      short: "new-slug",
    });
  });
});

describe("extractTailscaleHostsFromK8sResources", () => {
  it("extracts Tailscale Ingress and LoadBalancer Service hostnames", () => {
    const ingresses = {
      items: [
        {
          spec: { ingressClassName: "tailscale" },
          status: {
            loadBalancer: {
              ingress: [{ hostname: "grafana.tailnet-1a49.ts.net" }],
            },
          },
        },
        {
          spec: {
            ingressClassName: "tailscale",
            tls: [{ hosts: ["argocd.tailnet-1a49.ts.net"] }],
          },
        },
        {
          spec: { ingressClassName: "cloudflare" },
          status: {
            loadBalancer: {
              ingress: [{ hostname: "ignored.sjer.red" }],
            },
          },
        },
      ],
    };

    const services = {
      items: [
        {
          metadata: {
            annotations: { "tailscale.com/hostname": "woodpecker-grpc" },
          },
          spec: { loadBalancerClass: "tailscale" },
        },
        {
          spec: { loadBalancerClass: "other" },
          status: {
            loadBalancer: { ingress: [{ hostname: "ignored-lb" }] },
          },
        },
      ],
    };

    expect(extractTailscaleHostsFromK8sResources(ingresses, services)).toEqual([
      "argocd.tailnet-1a49.ts.net",
      "grafana.tailnet-1a49.ts.net",
      "woodpecker-grpc",
    ]);
  });
});
