import { App, Chart } from "cdk8s";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { exportBuildkitdDashboardJson } from "@shepherdjerred/homelab/cdk8s/grafana/buildkitd-dashboard.ts";
import { NVME_STORAGE_CLASS_LZ4 } from "@shepherdjerred/homelab/cdk8s/src/misc/storage/storage-classes.ts";
import { createBuildkitdDeployment } from "./buildkitd.ts";

const ConfigMapSchema = z.object({
  kind: z.literal("ConfigMap"),
  data: z.object({ "buildkitd.toml": z.string() }),
});

const PvcSchema = z.object({
  kind: z.literal("PersistentVolumeClaim"),
  metadata: z.object({ name: z.string() }),
  spec: z.object({
    storageClassName: z.string(),
    resources: z.object({ requests: z.object({ storage: z.string() }) }),
  }),
});

describe("buildkitd cache sizing and two-tier GC policy", () => {
  it("provisions a 600Gi zfs-ssd-lz4 PVC and sweeps ephemeral inputs before base layers", () => {
    const chart = new Chart(new App(), "buildkitd", {
      namespace: "buildkitd",
      disableResourceNameHashes: true,
    });
    createBuildkitdDeployment(chart);
    const manifests = chart.toJson();

    const pvc = PvcSchema.parse(
      manifests.find((item) => item.kind === "PersistentVolumeClaim"),
    );
    expect(pvc.metadata.name).toBe("buildkitd-cache-liskov");
    expect(pvc.spec.storageClassName).toBe(NVME_STORAGE_CLASS_LZ4);
    expect(pvc.spec.resources.requests.storage).toBe("600Gi");

    const configMap = ConfigMapSchema.parse(
      manifests.find((item) => item.kind === "ConfigMap"),
    );
    const toml = configMap.data["buildkitd.toml"];

    const ephemeralRule = [
      "[[worker.oci.gcpolicy]]",
      '    keepDuration = "48h"',
      `    maxUsedSpace = ${String(96 * 1024 * 1024 * 1024)}`,
      '    filters = ["type==source.local", "type==exec.cachemount", "type==source.git.checkout"]',
    ].join("\n");
    const catchAllRule = [
      "[[worker.oci.gcpolicy]]",
      `    maxUsedSpace = ${String(480 * 1024 * 1024 * 1024)}`,
      `    minFreeSpace = ${String(120 * 1024 * 1024 * 1024)}`,
      "    keepDuration = 0",
      "    all = true",
    ].join("\n");

    expect(toml).toContain(ephemeralRule);
    expect(toml).toContain(catchAllRule);
    expect(toml.indexOf(ephemeralRule)).toBeLessThan(
      toml.indexOf(catchAllRule),
    );
  });

  it("keeps the buildkitd dashboard GC floor synced at 480Gi", () => {
    const dashboardJson = exportBuildkitdDashboardJson();
    expect(dashboardJson).toContain("vector(480 * 1024 * 1024 * 1024)");
    expect(dashboardJson).toContain("GC floor (480Gi)");
    expect(dashboardJson).not.toContain("240Gi");
  });
});
