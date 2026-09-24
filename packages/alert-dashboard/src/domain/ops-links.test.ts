import {
  SERVICE_CATALOG,
  ServiceIndex,
} from "@shepherdjerred/ops-model/catalog.ts";
import { describe, expect, it } from "vitest";

import {
  serviceLinks,
  serviceLogQuery,
  serviceTraceQuery,
} from "#domain/ops-links";

const services = new ServiceIndex(SERVICE_CATALOG);
const uids = { prometheus: "prometheus", loki: "loki", tempo: "tempo" };

describe("service drill-down links", () => {
  it("selects logs across every namespace the service owns", () => {
    const scout = services.requireById("scout-for-lol");
    expect(serviceLogQuery(scout)).toBe('{namespace=~"scout-beta|scout-prod"}');
    expect(serviceTraceQuery(scout)).toBe(
      '{ resource.service.name =~ "scout-for-lol|scout-beta|scout-prod" }',
    );
  });

  it("builds Grafana Explore, dashboard, and Argo CD links on public hosts", () => {
    const links = serviceLinks(services.requireById("scout-for-lol"), uids);
    expect(links.map((link) => link.kind)).toEqual([
      "logs",
      "traces",
      "metrics",
      "grafana",
      "argocd",
      "argocd",
    ]);
    const logs = new URL(links[0]?.url ?? "");
    expect(logs.origin).toBe("https://grafana.tailnet-1a49.ts.net");
    expect(logs.pathname).toBe("/explore");
    expect(logs.searchParams.get("panes")).toContain(
      String.raw`{namespace=~\"scout-beta|scout-prod\"}`,
    );
    expect(links[3]?.url).toBe(
      "https://grafana.tailnet-1a49.ts.net/d/scout-for-lol-durable",
    );
    expect(links[4]?.url).toBe(
      "https://argocd.tailnet-1a49.ts.net/applications/argocd/scout-beta",
    );
  });
});
