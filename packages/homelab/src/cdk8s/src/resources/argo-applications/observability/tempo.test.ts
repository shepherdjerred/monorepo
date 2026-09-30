import { describe, expect, it } from "vitest";
import { App, Chart } from "cdk8s";
import { parseAllDocuments } from "yaml";
import { z } from "zod";
import { createTempoApp } from "./tempo.ts";

const TempoApplicationSchema = z.object({
  kind: z.literal("Application"),
  metadata: z.object({ name: z.literal("tempo") }),
  spec: z.object({
    ignoreDifferences: z.array(
      z.object({
        group: z.literal("apps"),
        kind: z.literal("StatefulSet"),
        name: z.literal("tempo"),
        namespace: z.literal("tempo"),
        jsonPointers: z.array(z.string()),
      }),
    ),
    syncPolicy: z.object({ syncOptions: z.array(z.string()) }),
  }),
});

describe("Tempo Argo CD application", () => {
  it("delegates immutable PVC templates to the admission policy", () => {
    const app = new App();
    const chart = new Chart(app, "test");
    createTempoApp(chart);
    const manifest = parseAllDocuments(app.synthYaml())
      .map((document) => TempoApplicationSchema.safeParse(document.toJS()))
      .find((result) => result.success);
    if (!manifest?.success) {
      throw new Error("Tempo Application was not synthesized");
    }

    expect(manifest.data.spec.ignoreDifferences).toEqual([
      {
        group: "apps",
        kind: "StatefulSet",
        name: "tempo",
        namespace: "tempo",
        jsonPointers: ["/spec/volumeClaimTemplates"],
      },
    ]);
    expect(manifest.data.spec.syncPolicy.syncOptions).toContain(
      "RespectIgnoreDifferences=true",
    );
    expect(manifest.data.spec.syncPolicy.syncOptions).toContain(
      "ServerSideApply=true",
    );
    expect(manifest.data.spec.syncPolicy.syncOptions).not.toContain(
      "Replace=true",
    );
  });
});
