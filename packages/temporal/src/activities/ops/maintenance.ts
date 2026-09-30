import type { PrometheusSample } from "@shepherdjerred/ops-clients/prometheus.ts";
import { METRIC_IDS } from "@shepherdjerred/ops-model/metric-ids.ts";
import { OPS_POLICY } from "@shepherdjerred/ops-model/policy.ts";
import type { Severity } from "@shepherdjerred/ops-model/severity.ts";
import type { SignalInput } from "@shepherdjerred/ops-model/snapshot.ts";
import { metricsLink } from "./ops-links.ts";
import { metric, type OpsCollection } from "./ops-types.ts";

const EXCLUDED_FS = 'fstype!~"tmpfs|fuse.lxcfs|squashfs|overlay"';

/** Every query the maintenance source runs, keyed by what it answers. */
export const MAINTENANCE_QUERIES = {
  /** Seconds until each cert-manager Certificate expires. */
  certificates:
    "min by (namespace, name) (certmanager_certificate_expiration_timestamp_seconds) - time()",
  /** Seconds until the TLS certificate each blackbox probe saw expires. */
  probeCertificates:
    "min by (instance) (probe_ssl_earliest_cert_expiry) - time()",
  filesystems: `max by (instance, mountpoint) (1 - node_filesystem_avail_bytes{${EXCLUDED_FS}} / node_filesystem_size_bytes{${EXCLUDED_FS}})`,
  zpools:
    "max by (zpool_name) (1 - zfs_zpool_free_bytes / zfs_zpool_size_bytes)",
  /** Seconds since the last successful SeaweedFS backup per cadence. */
  seaweedfsBackups:
    "time() - max by (cadence) (seaweedfs_backup_last_success_timestamp_seconds)",
  /** Seconds since the last successful Velero backup per schedule. */
  veleroBackups:
    'time() - max by (schedule) (velero_backup_last_successful_timestamp{schedule!=""})',
  cpu: '1 - avg(rate(node_cpu_seconds_total{mode="idle"}[5m]))',
  memory:
    "1 - sum(node_memory_MemAvailable_bytes) / sum(node_memory_MemTotal_bytes)",
} as const;

export type MaintenanceQuery = keyof typeof MAINTENANCE_QUERIES;
export type MaintenanceSamples = Record<MaintenanceQuery, PrometheusSample[]>;

const DAY_SECONDS = 86_400;

export function certificateSeverity(secondsLeft: number): Severity {
  const days = secondsLeft / DAY_SECONDS;
  if (days < OPS_POLICY.certificateExpiryWarningDays / 2) {
    return "error";
  }
  return days < OPS_POLICY.certificateExpiryWarningDays ? "warning" : "ok";
}

export function diskSeverity(ratio: number): Severity {
  if (ratio >= OPS_POLICY.diskErrorRatio) {
    return "error";
  }
  return ratio >= OPS_POLICY.diskWarningRatio ? "warning" : "ok";
}

function label(sample: PrometheusSample, name: string): string {
  const value = sample.metric[name];
  if (value === undefined || value === "") {
    throw new Error(`Maintenance sample is missing its ${name} label`);
  }
  return value;
}

function certificateSignals(samples: MaintenanceSamples): SignalInput[] {
  const certificates = [
    ...samples.certificates.map((sample) => ({
      id: `${label(sample, "namespace")}/${label(sample, "name")}`,
      secondsLeft: sample.value,
      query: `certmanager_certificate_expiration_timestamp_seconds{namespace="${label(sample, "namespace")}",name="${label(sample, "name")}"}`,
    })),
    ...samples.probeCertificates.map((sample) => ({
      id: label(sample, "instance"),
      secondsLeft: sample.value,
      query: `probe_ssl_earliest_cert_expiry{instance="${label(sample, "instance")}"}`,
    })),
  ];
  return certificates.flatMap((certificate) => {
    const severity = certificateSeverity(certificate.secondsLeft);
    if (severity === "ok") {
      return [];
    }
    const days = Math.floor(certificate.secondsLeft / DAY_SECONDS);
    return [
      {
        id: `maintenance:certificate:${certificate.id}`,
        source: "maintenance",
        section: "maintenance",
        kind: "certificate",
        severity,
        needsMe: false,
        title:
          days < 0
            ? `Certificate ${certificate.id} has expired`
            : `Certificate ${certificate.id} expires in ${String(days)}d`,
        attributes: { daysLeft: days },
        links: [metricsLink("Certificate expiry", certificate.query, "now-7d")],
      } satisfies SignalInput,
    ];
  });
}

function capacitySignals(samples: MaintenanceSamples): SignalInput[] {
  const volumes = [
    ...samples.filesystems.map((sample) => ({
      kind: "filesystem",
      name: `${label(sample, "instance")}:${label(sample, "mountpoint")}`,
      attributes: {
        instance: label(sample, "instance"),
        mountpoint: label(sample, "mountpoint"),
      },
      ratio: sample.value,
      query: `1 - node_filesystem_avail_bytes{instance="${label(sample, "instance")}",mountpoint="${label(sample, "mountpoint")}"} / node_filesystem_size_bytes`,
    })),
    ...samples.zpools.map((sample) => ({
      kind: "zpool",
      name: `zpool ${label(sample, "zpool_name")}`,
      attributes: { zpool: label(sample, "zpool_name") },
      ratio: sample.value,
      query: `1 - zfs_zpool_free_bytes{zpool_name="${label(sample, "zpool_name")}"} / zfs_zpool_size_bytes`,
    })),
  ];
  return volumes.flatMap((volume) => {
    const severity = diskSeverity(volume.ratio);
    return severity === "ok"
      ? []
      : [
          {
            id: `maintenance:${volume.kind}:${volume.name}`,
            source: "maintenance",
            section: "maintenance",
            kind: volume.kind,
            severity,
            needsMe: false,
            title: `${volume.name} is ${String(Math.round(volume.ratio * 100))}% full`,
            attributes: { ...volume.attributes, usedRatio: volume.ratio },
            links: [metricsLink("Usage", volume.query, "now-7d")],
          } satisfies SignalInput,
        ];
  });
}

function backupSignals(samples: MaintenanceSamples): SignalInput[] {
  const backups = [
    ...samples.seaweedfsBackups.map((sample) => ({
      name: `SeaweedFS ${label(sample, "cadence")}`,
      ageSeconds: sample.value,
      query: "seaweedfs_backup_last_success_timestamp_seconds",
    })),
    ...samples.veleroBackups.map((sample) => ({
      name: `Velero ${label(sample, "schedule")}`,
      ageSeconds: sample.value,
      query: 'velero_backup_last_successful_timestamp{schedule!=""}',
    })),
  ];
  return backups
    .filter((backup) => backup.ageSeconds / 3600 > OPS_POLICY.backupMaxAgeHours)
    .map((backup) => ({
      id: `maintenance:backup:${backup.name}`,
      source: "maintenance",
      section: "maintenance",
      kind: "backup",
      severity: "warning",
      needsMe: false,
      title: `${backup.name} backup is ${String(Math.round(backup.ageSeconds / 3600))}h old`,
      attributes: { ageHours: Math.round(backup.ageSeconds / 3600) },
      links: [metricsLink("Backup freshness", backup.query, "now-7d")],
    }));
}

function scalar(samples: readonly PrometheusSample[]): number | null {
  if (samples.length > 1) {
    throw new Error(`Expected one sample, got ${String(samples.length)}`);
  }
  const value = samples[0]?.value;
  return value === undefined || !Number.isFinite(value) ? null : value;
}

export function mapMaintenance(samples: MaintenanceSamples): OpsCollection {
  const certificates = certificateSignals(samples);
  const capacity = capacitySignals(samples);
  const backups = backupSignals(samples);
  const ratios = [...samples.filesystems, ...samples.zpools].map(
    (sample) => sample.value,
  );
  const maxDisk = ratios.length === 0 ? null : Math.max(...ratios);
  return {
    signals: [...certificates, ...capacity, ...backups],
    metrics: [
      metric({
        section: "maintenance",
        source: "maintenance",
        id: METRIC_IDS.diskMaxUsedRatio,
        label: "Fullest disk",
        value: maxDisk,
        unit: "ratio",
        severity: maxDisk === null ? "ok" : diskSeverity(maxDisk),
      }),
      metric({
        section: "maintenance",
        source: "maintenance",
        id: METRIC_IDS.certificatesExpiringSoon,
        label: "Certificates expiring",
        value: certificates.length,
        unit: "count",
      }),
      metric({
        section: "maintenance",
        source: "maintenance",
        id: METRIC_IDS.backupsStale,
        label: "Stale backups",
        value: backups.length,
        unit: "count",
        severity: backups.length > 0 ? "warning" : "ok",
      }),
      metric({
        section: "platform",
        source: "maintenance",
        id: METRIC_IDS.cpuUsedRatio,
        label: "CPU used",
        value: scalar(samples.cpu),
        unit: "ratio",
      }),
      metric({
        section: "platform",
        source: "maintenance",
        id: METRIC_IDS.memoryUsedRatio,
        label: "Memory used",
        value: scalar(samples.memory),
        unit: "ratio",
      }),
    ],
    changes: [],
  };
}
