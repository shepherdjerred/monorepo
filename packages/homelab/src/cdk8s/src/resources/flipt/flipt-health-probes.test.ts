import { App } from "cdk8s";
import { expect, it } from "vitest";
import { z } from "zod";
import { createFliptChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/platform/flipt.ts";

const ProbeSchema = z.object({
  httpGet: z.object({ path: z.string(), port: z.number() }),
  periodSeconds: z.number(),
  failureThreshold: z.number(),
});
const ManifestSchema = z.object({ kind: z.string() }).loose();

it("reaches the loopback-only Flipt health endpoint through the Pod IP gateway", () => {
  const app = new App();
  createFliptChart(app);
  const manifests = z.array(ManifestSchema).parse(app.charts.at(0)?.toJson());
  const configMaps = manifests
    .filter(({ kind }) => kind === "ConfigMap")
    .map((manifest) =>
      z.object({ data: z.record(z.string(), z.string()) }).parse(manifest),
    );
  const config = z
    .object({ server: z.object({ host: z.string(), http_port: z.number() }) })
    .parse(
      Bun.YAML.parse(
        configMaps.find(({ data }) => data["config.yml"])?.data["config.yml"] ??
          "",
      ),
    );
  expect(config.server).toEqual({ host: "127.0.0.1", http_port: 8081 });
  const caddy = configMaps.find(({ data }) => data["Caddyfile"])?.data[
    "Caddyfile"
  ];
  expect(caddy).toContain(":8080 {");
  expect(caddy).toMatch(
    /handle \/health \{\s+reverse_proxy 127\.0\.0\.1:8081\s+\}/,
  );

  const deployment = z
    .object({
      spec: z.object({
        template: z.object({
          spec: z.object({
            containers: z.array(
              z.object({
                name: z.string(),
                startupProbe: ProbeSchema,
                livenessProbe: ProbeSchema,
                readinessProbe: ProbeSchema,
              }),
            ),
          }),
        }),
      }),
    })
    .parse(manifests.find(({ kind }) => kind === "Deployment"));
  expect(
    deployment.spec.template.spec.containers.map(({ name }) => name),
  ).toEqual(["flipt", "authenticated-gateway"]);
  for (const container of deployment.spec.template.spec.containers) {
    for (const [key, periodSeconds, failureThreshold] of [
      ["startupProbe", 5, 18],
      ["livenessProbe", 30, 3],
      ["readinessProbe", 10, 3],
    ] as const) {
      expect(container[key]).toEqual({
        httpGet: { path: "/health", port: 8080 },
        periodSeconds,
        failureThreshold,
      });
    }
  }
});
