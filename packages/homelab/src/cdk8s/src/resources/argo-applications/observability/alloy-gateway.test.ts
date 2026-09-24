import { describe, expect, it } from "vitest";
import { App, Chart } from "cdk8s";
import { parseAllDocuments } from "yaml";
import { z } from "zod";
import {
  ALLOY_GATEWAY_CONFIG,
  createAlloyGatewayApp,
  TAILNET_METRIC_NAME_PATTERN,
} from "./alloy-gateway.ts";

const PortSchema = z.looseObject({ name: z.string(), port: z.number() });

const ApplicationSchema = z.object({
  kind: z.literal("Application"),
  metadata: z.object({ name: z.literal("alloy-gateway") }),
  spec: z.object({
    source: z.object({
      helm: z.object({
        valuesObject: z.object({
          alloy: z.object({ extraPorts: z.array(PortSchema) }),
        }),
      }),
    }),
  }),
});

const IngressSchema = z.object({
  kind: z.literal("Ingress"),
  metadata: z.object({ namespace: z.string() }),
  spec: z.object({
    ingressClassName: z.literal("tailscale"),
    defaultBackend: z.object({
      service: z.object({
        name: z.string(),
        port: z.object({ number: z.number() }),
      }),
    }),
    tls: z.array(z.object({ hosts: z.array(z.string()) })),
  }),
});

function synth(): unknown[] {
  const app = new App();
  const chart = new Chart(app, "test");
  createAlloyGatewayApp(chart);
  return parseAllDocuments(app.synthYaml()).map(
    (document) => document.toJS() as unknown,
  );
}

function block(name: string): string {
  const start = ALLOY_GATEWAY_CONFIG.indexOf(name);
  if (start === -1) {
    throw new Error(`River config has no ${name}`);
  }
  const end = ALLOY_GATEWAY_CONFIG.indexOf("\n}\n", start);
  return ALLOY_GATEWAY_CONFIG.slice(start, end);
}

describe("Alloy gateway tailnet metrics receiver", () => {
  it("routes the metrics-only receiver through the allowlist into Prometheus", () => {
    const receiver = block('otelcol.receiver.otlp "tailnet_metrics"');
    expect(receiver).toContain('endpoint = "0.0.0.0:4319"');
    expect(receiver).toContain(
      "metrics = [otelcol.processor.filter.tailnet_metrics.input]",
    );
    expect(receiver).not.toMatch(/traces|logs/);

    const filter = block('otelcol.processor.filter "tailnet_metrics"');
    expect(TAILNET_METRIC_NAME_PATTERN).toBe("^(ai_usage_|ai_subscription_)");
    expect(filter).toContain(
      String.raw`"not IsMatch(name, \"^(ai_usage_|ai_subscription_)\")"`,
    );
    expect(filter).toContain(
      "metrics = [otelcol.processor.batch.tailnet_metrics.input]",
    );

    const exporter = block('otelcol.exporter.prometheus "tailnet"');
    expect(exporter).toMatch(/add_metric_suffixes\s+= false/);
    expect(exporter).toMatch(/include_target_info\s+= false/);
    expect(exporter).toContain("prometheus.remote_write.cluster.receiver");

    expect(block('prometheus.remote_write "cluster"')).toContain(
      'url = "http://prometheus-operated.prometheus:9090/api/v1/write"',
    );
  });

  it("keeps the trace receiver on 4318 and never feeds it metrics", () => {
    const gateway = block('otelcol.receiver.otlp "gateway"');
    expect(gateway).toContain('endpoint = "0.0.0.0:4318"');
    expect(gateway).not.toContain("metrics =");
  });

  it("publishes only 4319 on the tailnet, as otlp-metrics", () => {
    const documents = synth();
    const ingresses = documents
      .map((document) => IngressSchema.safeParse(document))
      .flatMap((result) => (result.success ? [result.data] : []));
    expect(ingresses).toHaveLength(1);
    const [ingress] = ingresses;
    expect(ingress?.metadata.namespace).toBe("alloy-gateway");
    expect(ingress?.spec.defaultBackend.service).toEqual({
      name: "alloy-gateway",
      port: { number: 4319 },
    });
    expect(ingress?.spec.tls).toEqual([{ hosts: ["otlp-metrics"] }]);

    const application = documents
      .map((document) => ApplicationSchema.safeParse(document))
      .find((result) => result.success);
    if (!application?.success) {
      throw new Error("alloy-gateway Application was not synthesized");
    }
    expect(
      application.data.spec.source.helm.valuesObject.alloy.extraPorts,
    ).toEqual([
      { name: "otlp-http", port: 4318, targetPort: 4318, protocol: "TCP" },
      { name: "otlp-metrics", port: 4319, targetPort: 4319, protocol: "TCP" },
    ]);
  });
});

describe("Alloy gateway Phoenix branches", () => {
  const PROJECTS = [
    "scout-beta",
    "scout-prod",
    "birmel",
    "temporal",
    "discord-plays",
    "misc",
  ];

  it("routes each allowlisted project to Phoenix by header", () => {
    for (const project of PROJECTS) {
      expect(ALLOY_GATEWAY_CONFIG).toContain(
        `"x-project-name" = "${project}",`,
      );
    }
    const exporters = ALLOY_GATEWAY_CONFIG.match(
      /otelcol\.exporter\.otlphttp "px_\w+"/g,
    );
    expect(exporters).toHaveLength(PROJECTS.length);
    expect(ALLOY_GATEWAY_CONFIG).toContain(
      'endpoint = "http://phoenix.phoenix.svc.cluster.local:6006"',
    );
    expect(ALLOY_GATEWAY_CONFIG).toContain('sys.env("PHOENIX_API_KEY")');
  });

  it("keeps protobuf encoding and never names a removed consumer", () => {
    // Phoenix's OTLP route rejects JSON bodies; otlphttp defaults to proto.
    expect(ALLOY_GATEWAY_CONFIG).not.toMatch(/encoding\s*=\s*"json"/);
    expect(ALLOY_GATEWAY_CONFIG.toLowerCase()).not.toContain("braintrust");
    expect(ALLOY_GATEWAY_CONFIG).not.toContain("x-bt-parent");
  });

  it("sends every span to Tempo and has no catch-all Phoenix branch", () => {
    expect(ALLOY_GATEWAY_CONFIG).toContain(
      'endpoint = "http://tempo.tempo.svc.cluster.local:4318"',
    );
    const filters = ALLOY_GATEWAY_CONFIG.match(
      /otelcol\.processor\.filter "px_\w+" \{[\s\S]*?span = \[([\s\S]*?)\]/g,
    );
    expect(filters).toHaveLength(PROJECTS.length);
    for (const filter of filters ?? []) {
      expect(filter).toMatch(/span = \[\s*"/);
    }
  });
});
