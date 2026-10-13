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
  it("expands only the original claim while preserving its binding and template", () => {
    const app = new App();
    createPyroscopeApp(new Chart(app, "capacity"));
    const documents: unknown[] = parseAllDocuments(app.synthYaml()).map(
      (document) => document.toJS(),
    );
    const claims = documents.flatMap((document) => {
      const result = z
        .object({
          kind: z.literal("PersistentVolumeClaim"),
          metadata: z.object({
            name: z.string(),
            namespace: z.string(),
            annotations: z.record(z.string(), z.string()),
            labels: z.record(z.string(), z.string()),
          }),
          spec: z.record(z.string(), z.unknown()),
        })
        .safeParse(document);
      return result.success ? [result.data] : [];
    });
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({
      metadata: {
        name: "data-pyroscope-0",
        namespace: "pyroscope",
        annotations: { "argocd.argoproj.io/sync-options": "Prune=false" },
        labels: {
          "velero.io/backup": "disabled",
          "velero.io/exclude-from-backup": "true",
        },
      },
      spec: {
        accessModes: ["ReadWriteOnce"],
        storageClassName: "zfs-ssd",
        resources: { requests: { storage: "128Gi" } },
      },
    });
    expect(claims[0]?.spec).not.toHaveProperty("volumeName");
    expect(claims[0]?.spec).not.toHaveProperty("selector");
    const application = documents.flatMap((document) => {
      const result = z
        .object({
          kind: z.literal("Application"),
          spec: z.object({
            source: z.object({
              helm: z.object({
                valuesObject: z.object({
                  pyroscope: z.object({
                    persistence: z.object({ size: z.string() }),
                  }),
                }),
              }),
            }),
          }),
        })
        .safeParse(document);
      return result.success ? [result.data] : [];
    });
    expect(
      application[0]?.spec.source.helm.valuesObject.pyroscope.persistence.size,
    ).toBe("32Gi");
  });

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

  it("overrides the chart's debug log level", () => {
    const app = new App();
    const chart = new Chart(app, "test");
    createPyroscopeApp(chart);
    const values = parseAllDocuments(app.synthYaml())
      .map((document) =>
        z
          .object({
            kind: z.literal("Application"),
            spec: z.object({
              source: z.object({
                helm: z.object({
                  valuesObject: z.object({
                    pyroscope: z.object({
                      extraArgs: z.record(z.string(), z.string()),
                    }),
                  }),
                }),
              }),
            }),
          })
          .safeParse(document.toJS()),
      )
      .find((result) => result.success);
    expect(
      values?.data?.spec.source.helm.valuesObject.pyroscope.extraArgs,
    ).toEqual({ "log.level": "info" });
  });
});
