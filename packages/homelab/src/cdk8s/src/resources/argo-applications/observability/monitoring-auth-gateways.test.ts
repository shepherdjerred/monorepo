import { App, Chart } from "cdk8s";
import { parseAllDocuments } from "yaml";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  ALERTMANAGER_GATEWAY_CONFIG,
  createMonitoringAuthGateways,
  PROMETHEUS_GATEWAY_CONFIG,
} from "./monitoring-auth-gateways.ts";

const ResourceSchema = z
  .object({
    kind: z.string(),
    metadata: z.object({ name: z.string() }).loose(),
  })
  .loose();

function resources() {
  const app = new App();
  createMonitoringAuthGateways(
    new Chart(app, "monitoring-auth-gateways", {
      namespace: "prometheus",
      disableResourceNameHashes: true,
    }),
  );
  return parseAllDocuments(app.synthYaml()).map((document) =>
    ResourceSchema.parse(document.toJSON()),
  );
}

describe("monitoring mutation authentication", () => {
  test("uses Kubernetes-valid named ports in both operator sidecars", () => {
    const gateways = createMonitoringAuthGateways(
      new Chart(new App(), "monitoring-gateway-port-contract", {
        namespace: "prometheus",
        disableResourceNameHashes: true,
      }),
    );

    for (const container of [
      gateways.prometheusContainer,
      gateways.alertmanagerContainer,
    ]) {
      for (const port of container.ports) {
        expect(port.name.length).toBeLessThanOrEqual(15);
        expect(port.name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
        expect(port.name).toMatch(/[a-z]/);
      }
    }
  });

  test("sources gateway credentials from the dedicated 1Password item", () => {
    const item = resources().find(
      (resource) => resource.kind === "OnePasswordItem",
    );
    expect(item?.metadata.name).toBe("prometheus-monitoring-api-auth");
    expect(JSON.stringify(item?.["spec"])).toContain(
      "gnx5xq5rrsdlncvajjc4i577gm",
    );
  });

  test("requires a bearer token for Prometheus writes", () => {
    expect(PROMETHEUS_GATEWAY_CONFIG).toContain(
      'header Authorization "Bearer {$PROMETHEUS_WRITE_TOKEN}"',
    );
    expect(PROMETHEUS_GATEWAY_CONFIG).toContain(
      "@writePath path /api/v1/write /api/v1/otlp/*",
    );
    expect(PROMETHEUS_GATEWAY_CONFIG).toContain(
      'respond @writePath "authentication required" 401',
    );
  });

  test("keeps Grafana's Prometheus capability probes readable", () => {
    expect(PROMETHEUS_GATEWAY_CONFIG).toContain("/api/v1/query_exemplars");
    expect(PROMETHEUS_GATEWAY_CONFIG).toContain("/api/v1/status/buildinfo");
  });

  test("protects both Alertmanager silence mutation routes", () => {
    for (const route of ["/api/v2/silences", "/api/v2/silence/*"]) {
      expect(ALERTMANAGER_GATEWAY_CONFIG).toContain(route);
    }
    expect(ALERTMANAGER_GATEWAY_CONFIG).toContain("method POST DELETE");
    expect(ALERTMANAGER_GATEWAY_CONFIG).toContain(
      'header Authorization "Bearer {$ALERTMANAGER_TOKEN}"',
    );
    expect(ALERTMANAGER_GATEWAY_CONFIG).toContain(
      "operator {$ALERTMANAGER_BASIC_HASH}",
    );
  });
});
