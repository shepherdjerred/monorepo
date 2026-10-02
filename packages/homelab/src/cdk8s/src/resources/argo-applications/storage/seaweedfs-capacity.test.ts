import { App, Chart } from "cdk8s";
import { parseAllDocuments } from "yaml";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { createSeaweedfsApp } from "./seaweedfs.ts";

const ResourceSchema = z.object({
  kind: z.string(),
  metadata: z.object({ name: z.string() }).loose(),
  spec: z.unknown(),
});

const ClaimMetadataSchema = z.object({
  name: z.enum(["data-filer-seaweedfs-filer-0", "data-seaweedfs-volume-0"]),
  namespace: z.literal("seaweedfs"),
  labels: z.record(z.string(), z.string()),
  annotations: z.record(z.string(), z.string()),
});

function resources() {
  const app = new App();
  createSeaweedfsApp(new Chart(app, "seaweedfs-capacity"));
  return parseAllDocuments(app.synthYaml()).map((document) =>
    ResourceSchema.parse(document.toJSON()),
  );
}

describe("SeaweedFS data-preserving capacity migration", () => {
  test("adopts only the existing filer/data claims without pruning or rebinding", () => {
    const claims = resources()
      .filter((resource) => resource.kind === "PersistentVolumeClaim")
      .map((claim) => ({
        ...claim,
        metadata: ClaimMetadataSchema.parse(claim.metadata),
      }));
    expect(claims.map((claim) => claim.metadata.name).sort()).toEqual([
      "data-filer-seaweedfs-filer-0",
      "data-seaweedfs-volume-0",
    ]);
    for (const claim of claims) {
      expect(claim.metadata.namespace).toBe("seaweedfs");
      expect(claim.metadata.annotations).toEqual({
        "argocd.argoproj.io/sync-wave": "-1",
        "argocd.argoproj.io/sync-options": "Prune=false",
      });
      expect(claim.metadata.labels).toEqual({
        "velero.io/backup": "disabled",
        "velero.io/exclude-from-backup": "true",
      });
      const spec = z
        .object({
          accessModes: z.array(z.string()),
          storageClassName: z.string(),
          resources: z.object({
            requests: z.object({ storage: z.string() }),
          }),
        })
        .parse(claim.spec);
      expect(spec.accessModes).toEqual(["ReadWriteOnce"]);
      expect(spec.storageClassName).toBe("zfs-ssd");
      expect(spec.resources.requests.storage).toBe(
        claim.metadata.name === "data-filer-seaweedfs-filer-0" ? "4Gi" : "1Ti",
      );
      expect(claim.spec).not.toHaveProperty("volumeName");
      expect(claim.spec).not.toHaveProperty("selector");
    }
    const namespace = z
      .object({
        metadata: z.object({
          annotations: z.record(z.string(), z.string()),
        }),
      })
      .parse(resources().find((resource) => resource.kind === "Namespace"));
    expect(namespace.metadata.annotations["argocd.argoproj.io/sync-wave"]).toBe(
      "-2",
    );
  });

  test("leaves immutable templates and replacement intent unchanged until expansion is verified", () => {
    const application = resources().find(
      (resource) => resource.kind === "Application",
    );
    const { valuesObject } = z
      .object({
        source: z.object({
          helm: z.object({ valuesObject: z.record(z.string(), z.unknown()) }),
        }),
      })
      .parse(application?.spec).source.helm;
    expect(valuesObject).toMatchObject({
      filer: { data: { size: "1Gi" } },
      volume: { dataDirs: [{ size: "512Gi" }], idx: { size: "50Gi" } },
      master: { data: { size: "1Gi" }, volumeSizeLimitMB: 30_000 },
    });
    expect(valuesObject["filer"]).not.toHaveProperty("annotations");
    expect(valuesObject["volume"]).not.toHaveProperty("annotations");
  });
});
