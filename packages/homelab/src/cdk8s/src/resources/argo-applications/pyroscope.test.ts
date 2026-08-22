import { describe, expect, it } from "vitest";
import { App, Chart } from "cdk8s";
import { parseAllDocuments } from "yaml";
import { z } from "zod";
import { createPyroscopeApp } from "./pyroscope.ts";

const PyroscopeApplicationSchema = z.object({
  kind: z.literal("Application"),
  metadata: z.object({ name: z.literal("pyroscope") }),
  spec: z.object({
    ignoreDifferences: z.array(
      z.object({
        group: z.literal("apps"),
        kind: z.literal("StatefulSet"),
        name: z.literal("pyroscope"),
        namespace: z.literal("pyroscope"),
        jsonPointers: z.array(z.string()),
      }),
    ),
    syncPolicy: z.object({ syncOptions: z.array(z.string()) }),
  }),
});

describe("Pyroscope Argo CD application", () => {
  it("delegates immutable PVC templates to the admission policy", () => {
    const app = new App();
    const chart = new Chart(app, "test");
    createPyroscopeApp(chart);
    const manifest = parseAllDocuments(app.synthYaml())
      .map((document) => PyroscopeApplicationSchema.safeParse(document.toJS()))
      .find((result) => result.success);
    if (!manifest?.success) {
      throw new Error("Pyroscope Application was not synthesized");
    }

    // The whole field, never a pointer into the list: the apply-safety
    // preflight refuses indexed pointers because dropping one entry renumbers
    // its siblings. Chart 2.2.1 renders an empty `annotations: {}` inside the
    // claim template that 2.2.0 did not, which is what made every sync fail.
    expect(manifest.data.spec.ignoreDifferences).toEqual([
      {
        group: "apps",
        kind: "StatefulSet",
        name: "pyroscope",
        namespace: "pyroscope",
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
