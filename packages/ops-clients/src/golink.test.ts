import { describe, expect, test } from "vitest";
import { GolinkClient } from "@shepherdjerred/ops-clients/golink.ts";
import { sequence } from "@shepherdjerred/ops-clients/test-support/fake-fetch.ts";

describe("GolinkClient", () => {
  test("reads /api/links and normalizes slug, tier, clicks, and shadows", async () => {
    const { fetch, requests } = sequence({
      viewer: { login: null, displayName: null },
      dynamicAliasesEnabled: true,
      writesEnabled: true,
      shortcuts: [],
      links: [
        {
          short: "grafana",
          targetUrl: "https://grafana.sjer.red/d/main",
          kind: "manual",
          clicks: 42,
          lastClickedAt: "2026-09-24T10:00:00Z",
          updatedAt: "2026-09-20T00:00:00Z",
          shadows: {
            kind: "ingress",
            targetUrl: "https://grafana.tailnet-1a49.ts.net/",
            detail: "Tailscale cluster ingress",
          },
        },
        {
          short: "argocd",
          targetUrl: "https://argocd.tailnet-1a49.ts.net/",
          kind: "ingress",
          detail: "Tailscale cluster ingress",
        },
      ],
    });

    const client = new GolinkClient({
      baseUrl: "http://golink.golink.svc.cluster.local:8080",
      headers: { "x-viewer": "hub" },
      fetch,
    });

    const links = await client.listLinks();
    expect(requests[0]?.url).toBe(
      "http://golink.golink.svc.cluster.local:8080/api/links",
    );
    expect(requests[0]?.headers.get("x-viewer")).toBe("hub");
    expect(links).toEqual([
      {
        slug: "grafana",
        targetUrl: "https://grafana.sjer.red/d/main",
        tier: "manual",
        clicks: 42,
        lastClickedAt: "2026-09-24T10:00:00Z",
        updatedAt: "2026-09-20T00:00:00Z",
        shadows: {
          tier: "ingress",
          targetUrl: "https://grafana.tailnet-1a49.ts.net/",
          detail: "Tailscale cluster ingress",
        },
      },
      {
        slug: "argocd",
        targetUrl: "https://argocd.tailnet-1a49.ts.net/",
        tier: "ingress",
        clicks: 0,
        detail: "Tailscale cluster ingress",
        shadows: undefined,
      },
    ]);
  });
});
