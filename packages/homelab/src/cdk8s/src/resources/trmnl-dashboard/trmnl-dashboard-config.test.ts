import { describe, expect, it } from "vitest";
import { App } from "cdk8s";
import { setupCharts } from "@shepherdjerred/homelab/cdk8s/src/setup-charts.ts";
import { createTrmnlDashboardChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/trmnl-dashboard.ts";

async function synthesizeApp(): Promise<string> {
  const app = new App({ outdir: ".test-synth" });
  await setupCharts(app);
  return app.synthYaml();
}

describe("trmnl-dashboard configuration", () => {
  it("renders the homelab screen from the ops dashboard service", () => {
    const app = new App({ outdir: ".test-synth-trmnl-dashboard" });
    createTrmnlDashboardChart(app);
    const yaml = app.synthYaml();

    expect(yaml).toContain("name: OPS_DASHBOARD_URL");
    expect(yaml).toContain(
      "value: http://alert-dashboard-alert-dashboard-service.alert-dashboard:7341",
    );
    expect(yaml).not.toContain("name: BUGSINK_TOKEN");
    expect(yaml).not.toContain("name: trmnl-dashboard-reader");
  });

  it("runs as the namespace default account so the retired one can be pruned", () => {
    const app = new App({ outdir: ".test-synth-trmnl-dashboard-sa" });
    createTrmnlDashboardChart(app);
    const yaml = app.synthYaml();

    // Leaving the field unset lets the API server's deprecated
    // `serviceAccount` mirror restore the retired trmnl-dashboard account.
    expect(yaml).toContain("serviceAccountName: default");
    expect(yaml).not.toContain("kind: ServiceAccount");
  });

  it("allows Bugsink internal service hostnames", async () => {
    const yaml = await synthesizeApp();

    expect(yaml).toContain("bugsink-bugsink-service.bugsink");
    expect(yaml).toContain("bugsink-bugsink-service.bugsink.svc.cluster.local");
  });

  it("exposes pet metrics only through the Prometheus-selected service", async () => {
    const yaml = await synthesizeApp();

    expect(yaml).toContain("kind: ServiceMonitor");
    expect(yaml).toContain("name: trmnl-dashboard-service-monitor");
    expect(yaml).toContain("path: /metrics");
    expect(yaml).toContain("kubernetes.io/metadata.name: prometheus");
  });
});
