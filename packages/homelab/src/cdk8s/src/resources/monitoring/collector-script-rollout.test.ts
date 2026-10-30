import { describe, expect, test } from "vitest";
import { App, Chart } from "cdk8s";
import { z } from "zod";
import { createNvmeMetricsMonitoring } from "./nvme-metrics.ts";
import { createR2ExporterMonitoring } from "./r2-exporter.ts";
import { createSmartctlMonitoring } from "./smartctl.ts";
import { createZfsSnapshotsMonitoring } from "./zfs-snapshots.ts";
import { createZfsZpoolMonitoring } from "./zfs-zpool.ts";

const WorkloadSchema = z.looseObject({
  kind: z.enum(["DaemonSet", "Deployment"]),
  spec: z.looseObject({
    template: z.looseObject({
      metadata: z.looseObject({
        annotations: z.record(z.string(), z.string()),
      }),
    }),
  }),
});

const collectors = [
  ["smartctl", createSmartctlMonitoring, "smartmon.sh"],
  ["nvme-metrics", createNvmeMetricsMonitoring, "scripts/nvme_metrics.py"],
  ["zfs-snapshots", createZfsSnapshotsMonitoring, "scripts/zfs_snapshots.py"],
  ["zfs-zpool", createZfsZpoolMonitoring, "scripts/zfs_zpool.sh"],
  ["r2-exporter", createR2ExporterMonitoring, "scripts/r2_exporter.py"],
] as const;

describe("script collectors", () => {
  test.each(collectors)(
    "%s replaces its pods when its script changes",
    async (_name, create, script) => {
      const chart = new Chart(new App(), "test");
      await create(chart);
      const workloads = chart
        .toJson()
        .filter(
          (manifest: { kind: string }) =>
            manifest.kind === "DaemonSet" || manifest.kind === "Deployment",
        )
        .map((manifest: unknown) => WorkloadSchema.parse(manifest));
      expect(workloads).toHaveLength(1);
      const content = await Bun.file(`${import.meta.dir}/${script}`).text();
      expect(
        workloads[0]?.spec.template.metadata.annotations["checksum/script"],
      ).toBe(new Bun.CryptoHasher("sha256").update(content).digest("hex"));
    },
  );
});
