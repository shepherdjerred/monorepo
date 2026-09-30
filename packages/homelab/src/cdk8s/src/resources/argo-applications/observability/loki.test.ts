import { describe, expect, it } from "vitest";
import { App, Chart } from "cdk8s";
import { parseAllDocuments } from "yaml";
import { z } from "zod";
import { createLokiApp } from "./loki.ts";

const LokiApplicationSchema = z.object({
  kind: z.literal("Application"),
  metadata: z.object({ name: z.literal("loki") }),
  spec: z.object({
    ignoreDifferences: z.array(
      z.object({
        group: z.literal("apps"),
        kind: z.literal("StatefulSet"),
        name: z.literal("loki"),
        namespace: z.literal("loki"),
        jsonPointers: z.array(z.string()),
      }),
    ),
    syncPolicy: z.object({ syncOptions: z.array(z.string()) }),
  }),
});

const LokiValuesSchema = z.object({
  kind: z.literal("Application"),
  metadata: z.object({ name: z.literal("loki") }),
  spec: z.object({
    source: z.object({
      helm: z.object({ valuesObject: z.unknown() }),
    }),
  }),
});

const LokiRetentionSchema = z.object({
  loki: z.object({
    limits_config: z.object({ retention_period: z.string() }),
    compactor: z.object({
      working_directory: z.string(),
      retention_enabled: z.literal(true),
      delete_request_store: z.string(),
    }),
  }),
});

function lokiValues(): unknown {
  const app = new App();
  const chart = new Chart(app, "test");
  createLokiApp(chart);
  const manifest = parseAllDocuments(app.synthYaml())
    .map((document) => LokiValuesSchema.safeParse(document.toJS()))
    .find((result) => result.success);
  if (!manifest?.success) {
    throw new Error("Loki Application was not synthesized");
  }
  return manifest.data.spec.source.helm.valuesObject;
}

describe("Loki Argo CD application", () => {
  it("delegates immutable PVC templates to the admission policy", () => {
    const app = new App();
    const chart = new Chart(app, "test");
    createLokiApp(chart);
    const manifest = parseAllDocuments(app.synthYaml())
      .map((document) => LokiApplicationSchema.safeParse(document.toJS()))
      .find((result) => result.success);
    if (!manifest?.success) {
      throw new Error("Loki Application was not synthesized");
    }

    expect(manifest.data.spec.ignoreDifferences).toEqual([
      {
        group: "apps",
        kind: "StatefulSet",
        name: "loki",
        namespace: "loki",
        jsonPointers: ["/spec/volumeClaimTemplates"],
      },
    ]);
    expect(manifest.data.spec.syncPolicy.syncOptions).toContain(
      "RespectIgnoreDifferences=true",
    );
    expect(manifest.data.spec.syncPolicy.syncOptions).not.toContain(
      "Replace=true",
    );
  });

  it("enables compactor retention whenever a retention period is set", () => {
    // retention_period is inert without compactor.retention_enabled: Loki
    // keeps every log forever. Couple them so the period cannot regress
    // into an unbounded-growth config again.
    const retention = LokiRetentionSchema.parse(lokiValues());
    expect(retention.loki.limits_config.retention_period).toBe("90d");
    expect(retention.loki.compactor.retention_enabled).toBe(true);
    expect(retention.loki.compactor.working_directory).toBe(
      "/var/loki/compactor",
    );
    expect(retention.loki.compactor.delete_request_store).toBe("filesystem");
  });
});
