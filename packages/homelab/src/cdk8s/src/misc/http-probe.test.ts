import { describe, expect, test } from "bun:test";
import { App, Chart } from "cdk8s";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { createHttpProbe } from "./http-probe.ts";

const ProbeSchema = z.object({
  apiVersion: z.literal("monitoring.coreos.com/v1"),
  kind: z.literal("Probe"),
  metadata: z.object({
    name: z.string(),
    namespace: z.string(),
    labels: z.record(z.string(), z.string()),
  }),
  spec: z.object({
    jobName: z.string(),
    interval: z.string(),
    module: z.string(),
    prober: z.object({ url: z.string() }),
    targets: z.object({
      staticConfig: z.object({
        static: z.array(z.string()),
        labels: z.record(z.string(), z.string()),
      }),
    }),
  }),
});

function parseDocuments(yamlContent: string): unknown[] {
  return yamlContent
    .split(/^---$/m)
    .map((document) => document.trim())
    .filter((document) => document.length > 0)
    .map((document) => parseYaml(document));
}

function synthesizeProbe(props: Parameters<typeof createHttpProbe>[2]) {
  const app = new App();
  const chart = new Chart(app, "test", { namespace: "prometheus" });
  createHttpProbe(chart, "test-probe", props);
  return parseDocuments(app.synthYaml())
    .map((document) => ProbeSchema.safeParse(document))
    .filter((result) => result.success)
    .map((result) => result.data);
}

describe("createHttpProbe", () => {
  test("builds a Probe targeting the given URL/module with the release label required for operator discovery", () => {
    const [probe] = synthesizeProbe({
      namespace: "prometheus",
      jobName: "probe-home-scrypted-internal",
      url: "http://scrypted.home.svc.cluster.local:11080/",
      module: "http_2xx",
      labels: { service: "scrypted", namespace: "home", path: "internal" },
    });

    expect(probe?.metadata.name).toBe("probe-home-scrypted-internal");
    expect(probe?.metadata.labels).toEqual({ release: "prometheus" });
    expect(probe?.spec.jobName).toBe("probe-home-scrypted-internal");
    expect(probe?.spec.module).toBe("http_2xx");
    expect(probe?.spec.prober.url).toBe(
      "prometheus-prometheus-blackbox-exporter.prometheus:9115",
    );
    expect(probe?.spec.targets.staticConfig.static).toEqual([
      "http://scrypted.home.svc.cluster.local:11080/",
    ]);
    expect(probe?.spec.targets.staticConfig.labels).toEqual({
      service: "scrypted",
      namespace: "home",
      path: "internal",
    });
  });

  test("defaults interval to 60s when not provided", () => {
    const [probe] = synthesizeProbe({
      namespace: "prometheus",
      jobName: "probe-foo",
      url: "http://foo:80/",
      module: "http_2xx",
    });

    expect(probe?.spec.interval).toBe("60s");
  });

  test("honors an explicit interval override", () => {
    const [probe] = synthesizeProbe({
      namespace: "prometheus",
      jobName: "probe-foo",
      url: "http://foo:80/",
      module: "http_2xx",
      interval: "30s",
    });

    expect(probe?.spec.interval).toBe("30s");
  });

  test("defaults target labels to an empty object when not provided", () => {
    const [probe] = synthesizeProbe({
      namespace: "prometheus",
      jobName: "probe-foo",
      url: "http://foo:80/",
      module: "http_2xx",
    });

    expect(probe?.spec.targets.staticConfig.labels).toEqual({});
  });

  test("passes through non-HTTP modules (e.g. tcp_connect) as-is", () => {
    const [probe] = synthesizeProbe({
      namespace: "prometheus",
      jobName: "probe-temporal-temporal-server-internal",
      url: "temporal-server.temporal.svc.cluster.local:7233",
      module: "tcp_connect",
    });

    expect(probe?.spec.module).toBe("tcp_connect");
    expect(probe?.spec.targets.staticConfig.static).toEqual([
      "temporal-server.temporal.svc.cluster.local:7233",
    ]);
  });
});
