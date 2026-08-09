import { describe, expect, it } from "bun:test";
import { App, Chart } from "cdk8s";
import { parseAllDocuments } from "yaml";
import { z } from "zod";
import { createGolinkApp } from "./golink.ts";

const GolinkApplicationSchema = z.object({
  kind: z.literal("Application"),
  metadata: z.object({ name: z.literal("golink") }),
  spec: z.object({
    ignoreDifferences: z.array(
      z.object({
        group: z.literal(""),
        kind: z.literal("PersistentVolumeClaim"),
        name: z.literal("golink-pvc"),
        namespace: z.literal("golink"),
        jsonPointers: z.array(z.string()),
      }),
    ),
    syncPolicy: z.object({ syncOptions: z.array(z.string()) }),
  }),
});

describe("Golink Argo CD application", () => {
  it("preserves the Kubernetes-assigned PVC volume name", () => {
    const app = new App();
    const chart = new Chart(app, "test");
    createGolinkApp(chart);
    const manifest = parseAllDocuments(app.synthYaml())
      .map((document) => GolinkApplicationSchema.safeParse(document.toJS()))
      .find((result) => result.success);
    if (!manifest?.success) {
      throw new Error("Golink Application was not synthesized");
    }

    expect(manifest.data.spec.ignoreDifferences).toEqual([
      {
        group: "",
        kind: "PersistentVolumeClaim",
        name: "golink-pvc",
        namespace: "golink",
        jsonPointers: ["/spec/volumeName"],
      },
    ]);
    expect(manifest.data.spec.syncPolicy.syncOptions).toContain(
      "RespectIgnoreDifferences=true",
    );
  });
});
