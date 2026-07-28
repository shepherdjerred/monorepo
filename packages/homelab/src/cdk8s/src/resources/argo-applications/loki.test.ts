import { describe, expect, it } from "bun:test";
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
});
