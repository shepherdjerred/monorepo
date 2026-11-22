import { describe, expect, test } from "vitest";
import type { PrometheusSample } from "@shepherdjerred/ops-clients/prometheus.ts";
import {
  MAINTENANCE_QUERIES,
  mapMaintenance,
  SEAWEEDFS_BACKUP_LAG_ERROR_SECONDS,
  SEAWEEDFS_BACKUP_LAG_WARNING_SECONDS,
  type MaintenanceSamples,
} from "./maintenance.ts";

const now = new Date("2026-11-21T22:00:00.000Z");

function sample(
  value: number,
  metric: Record<string, string> = {},
): PrometheusSample {
  return { metric, value };
}

function baseSamples(
  overrides: Partial<MaintenanceSamples> = {},
): MaintenanceSamples {
  return {
    certificates: [],
    probeCertificates: [],
    filesystems: [],
    zpools: [],
    veleroBackups: [],
    cpu: [sample(0.2)],
    memory: [sample(0.4)],
    seaweedfsVolumes: [],
    seaweedfsBackupLag: [],
    ...overrides,
  };
}

describe("maintenance zpool and SeaweedFS signals", () => {
  test("groups zpools by (instance, zpool_name) so torvalds and liskov never collapse", () => {
    expect(MAINTENANCE_QUERIES.zpools).toBe(
      "max by (instance, zpool_name) (1 - zfs_zpool_free_bytes / zfs_zpool_size_bytes)",
    );

    const result = mapMaintenance(
      baseSamples({
        zpools: [
          sample(0.84, { instance: "torvalds", zpool_name: "zfspv-pool-nvme" }),
          sample(0.93, { instance: "liskov", zpool_name: "zfspv-pool-nvme" }),
        ],
      }),
      [],
      [],
      now,
    );

    const zpoolSignals = result.signals.filter((s) => s.kind === "zpool");
    expect(zpoolSignals.map((s) => [s.id, s.severity, s.attributes])).toEqual([
      [
        "maintenance:zpool:zpool torvalds:zfspv-pool-nvme",
        "warning",
        { instance: "torvalds", zpool: "zfspv-pool-nvme", usedRatio: 0.84 },
      ],
      [
        "maintenance:zpool:zpool liskov:zfspv-pool-nvme",
        "error",
        { instance: "liskov", zpool: "zfspv-pool-nvme", usedRatio: 0.93 },
      ],
    ]);
    expect(
      result.metrics.find((m) => m.id === "maintenance.disk.max_used_ratio")
        ?.value,
    ).toBe(0.93);
  });

  test("preserves legacy zpool formatting when instance label is omitted", () => {
    const result = mapMaintenance(
      baseSamples({
        zpools: [sample(0.88, { zpool_name: "tank" })],
      }),
      [],
      [],
      now,
    );

    const zpoolSignal = result.signals.find((s) => s.kind === "zpool");
    expect(zpoolSignal).toMatchObject({
      id: "maintenance:zpool:zpool tank",
      severity: "warning",
      attributes: { zpool: "tank", usedRatio: 0.88 },
    });
  });

  test("emits SeaweedFS volume slot saturation and B2 replication lag signals when unhealthy", () => {
    const healthy = mapMaintenance(
      baseSamples({
        seaweedfsVolumes: [sample(0.5)],
        seaweedfsBackupLag: [sample(120)],
      }),
      [],
      [],
      now,
    );
    expect(
      healthy.signals.filter((s) => s.id.startsWith("maintenance:seaweedfs:")),
    ).toEqual([]);

    const warning = mapMaintenance(
      baseSamples({
        seaweedfsVolumes: [sample(0.85)],
        seaweedfsBackupLag: [sample(SEAWEEDFS_BACKUP_LAG_WARNING_SECONDS + 60)],
      }),
      [],
      [],
      now,
    );
    expect(
      warning.signals
        .filter((s) => s.id.startsWith("maintenance:seaweedfs:"))
        .map((s) => [s.id, s.severity, s.service]),
    ).toEqual([
      ["maintenance:seaweedfs:volumes", "warning", "storage"],
      ["maintenance:seaweedfs:backup-lag", "warning", "storage"],
    ]);

    const critical = mapMaintenance(
      baseSamples({
        seaweedfsVolumes: [sample(0.96)],
        seaweedfsBackupLag: [sample(SEAWEEDFS_BACKUP_LAG_ERROR_SECONDS + 60)],
      }),
      [],
      [],
      now,
    );
    expect(
      critical.signals
        .filter((s) => s.id.startsWith("maintenance:seaweedfs:"))
        .map((s) => [s.id, s.severity]),
    ).toEqual([
      ["maintenance:seaweedfs:volumes", "error"],
      ["maintenance:seaweedfs:backup-lag", "error"],
    ]);
  });
});
