import { App, Chart } from "cdk8s";
import { parseAllDocuments } from "yaml";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  ALERTMANAGER_GATEWAY_CONFIG,
  createMonitoringAuthGateways,
  PROMETHEUS_GATEWAY_CONFIG,
  PROMETHEUS_HEALTH_PROBE_CONTAINER,
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
  test("renders the HTTP probe override into the loopback-only Prometheus app", async () => {
    const ApplicationSchema = z.object({
      kind: z.literal("Application"),
      metadata: z.object({ name: z.literal("prometheus") }),
      spec: z.object({
        source: z.object({
          helm: z.object({
            valuesObject: z.object({
              prometheus: z.object({
                prometheusSpec: z.object({
                  listenLocal: z.boolean(),
                  containers: z.array(z.object({ name: z.string() }).loose()),
                }),
              }),
            }),
          }),
        }),
      }),
    });
    const rendered = await Bun.file(
      new URL("../../../../dist/apps.k8s.yaml", import.meta.url),
    ).text();
    const application = parseAllDocuments(rendered)
      .map((document) => ApplicationSchema.safeParse(document.toJSON()))
      .find((result) => result.success);
    if (!application?.success)
      throw new Error("Prometheus Application missing");
    const spec =
      application.data.spec.source.helm.valuesObject.prometheus.prometheusSpec;
    expect(spec.listenLocal).toBe(true);
    expect(
      spec.containers.find((container) => container.name === "prometheus"),
    ).toEqual(PROMETHEUS_HEALTH_PROBE_CONTAINER);
  });

  test("checks the distroless backend's readiness through its gateway", () => {
    expect(PROMETHEUS_HEALTH_PROBE_CONTAINER.name).toBe("prometheus");
    const probes = PROMETHEUS_HEALTH_PROBE_CONTAINER;
    for (const probe of [
      probes.startupProbe,
      probes.readinessProbe,
      probes.livenessProbe,
    ]) {
      expect(probe.httpGet.port).toBe(9091);
      expect(probe).not.toHaveProperty("exec");
      expect(PROMETHEUS_GATEWAY_CONFIG).toContain(probe.httpGet.path);
      expect(probe.timeoutSeconds).toBe(3);
    }
    expect(probes.startupProbe.httpGet.path).toBe("/-/ready");
    expect(probes.readinessProbe.httpGet.path).toBe("/-/ready");
    expect(probes.livenessProbe.httpGet.path).toBe("/-/healthy");
    expect(probes.startupProbe.failureThreshold).toBe(60);
    expect(probes.startupProbe.periodSeconds).toBe(15);
    expect(probes.readinessProbe.failureThreshold).toBe(3);
    expect(probes.readinessProbe.periodSeconds).toBe(5);
    expect(probes.livenessProbe.failureThreshold).toBe(6);
    expect(probes.livenessProbe.periodSeconds).toBe(5);
  });

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
