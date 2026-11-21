import { describe, expect, it } from "vitest";
import { App, Chart } from "cdk8s";
import { parseAllDocuments } from "yaml";
import { z } from "zod";
import { createGolinkApp } from "./golink.ts";

const GolinkApplicationSchema = z.object({
  kind: z.literal("Application"),
  metadata: z.object({ name: z.literal("golink") }),
  spec: z.object({
    destination: z.object({ namespace: z.literal("golink") }),
    syncPolicy: z.object({ syncOptions: z.array(z.string()) }),
  }),
});

describe("Golink Argo CD application", () => {
  it("synthesizes the first-party golink Application", () => {
    const app = new App();
    const chart = new Chart(app, "test");
    createGolinkApp(chart);
    const manifest = parseAllDocuments(app.synthYaml())
      .map((document) => GolinkApplicationSchema.safeParse(document.toJS()))
      .find((result) => result.success);
    if (!manifest?.success) {
      throw new Error("Golink Application was not synthesized");
    }

    expect(manifest.data.spec.destination.namespace).toBe("golink");
    expect(manifest.data.spec.syncPolicy.syncOptions).toEqual([
      "CreateNamespace=true",
      "ApplyOutOfSyncOnly=true",
    ]);
  });
});
