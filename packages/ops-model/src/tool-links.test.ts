import { describe, expect, it } from "vitest";
import {
  APP_HOSTS,
  TOOL_HOSTS,
  argocdApplicationLink,
  chartmuseumChartLink,
  githubCommitLink,
  grafanaPyroscopeExploreUrl,
  temporalWorkflowLink,
  woodpeckerPipelineLink,
  woodpeckerStepLink,
} from "./tool-links.ts";
import {
  LINK_KINDS,
  LinkSchema,
  METRIC_UNITS,
  MetricSchema,
} from "./snapshot.ts";

describe("tool links", () => {
  it("lists every host as an https origin a path can be appended to", () => {
    for (const host of [
      ...Object.values(TOOL_HOSTS),
      ...Object.values(APP_HOSTS),
    ]) {
      expect(new URL(host).protocol).toBe("https:");
      expect(host.endsWith("/")).toBe(false);
    }
  });

  it("builds Woodpecker pipeline and step URLs", () => {
    expect(woodpeckerPipelineLink(4210).url).toBe(
      "https://woodpecker.sjer.red/repos/1/pipeline/4210",
    );
    expect(woodpeckerStepLink(4210, { pid: 7, name: "verify" }).url).toBe(
      "https://woodpecker.sjer.red/repos/1/pipeline/4210/7",
    );
  });

  it("encodes workflow identities that contain slashes", () => {
    expect(temporalWorkflowLink("delivery/abc").url).toBe(
      "https://temporal-ui.tailnet-1a49.ts.net/namespaces/prod/workflows/delivery%2Fabc",
    );
  });

  it("produces schema-valid links", () => {
    for (const link of [
      githubCommitLink("a".repeat(40)),
      argocdApplicationLink("scout-prod"),
      chartmuseumChartLink("arcade", "1.0.0+abc"),
    ])
      expect(LinkSchema.parse(link)).toEqual(link);
  });

  it("builds Grafana Pyroscope Explore URLs scoped to namespace", () => {
    const exploreHref = grafanaPyroscopeExploreUrl({
      grafanaUrl: TOOL_HOSTS.grafana,
      namespace: "scout-prod",
      service: "scout-for-lol",
    });
    const parsed = new URL(exploreHref);
    expect(parsed.origin).toBe("https://grafana.tailnet-1a49.ts.net");
    expect(parsed.pathname).toBe("/explore");
    expect(parsed.searchParams.get("schemaVersion")).toBe("1");
    expect(parsed.searchParams.get("orgId")).toBe("1");
    const panes = parsed.searchParams.get("panes") ?? "";
    expect(panes).toContain('"uid":"pyroscope"');
    expect(panes).toContain('"type":"grafana-pyroscope-datasource"');
    expect(panes).toContain(String.raw`{namespace=\"scout-prod\"}`);
    expect(
      LinkSchema.parse({
        kind: "profiles",
        label: "Profiles",
        url: exploreHref,
      }).kind,
    ).toBe("profiles");
  });

  it("supports expanded link kinds and metric units", () => {
    for (const kind of [
      "profiles",
      "cloudflare",
      "tailscale",
      "flipt",
      "golink",
    ] as const) {
      expect(LINK_KINDS).toContain(kind);
    }
    for (const unit of ["bytes", "bps", "ms", "celsius"] as const) {
      expect(METRIC_UNITS).toContain(unit);
      expect(
        MetricSchema.parse({
          id: `test.${unit}`,
          label: unit,
          value: 42,
          unit,
          severity: "ok",
          source: "kubernetes",
        }).unit,
      ).toBe(unit);
    }
  });
});
