import type { PrometheusSample } from "@shepherdjerred/ops-clients/prometheus.ts";
import type {
  VeleroBackupStatus,
  VeleroScheduleStatus,
} from "@shepherdjerred/ops-clients/kubernetes.ts";
import { METRIC_IDS } from "@shepherdjerred/ops-model/metric-ids.ts";
import { OPS_POLICY } from "@shepherdjerred/ops-model/policy.ts";
import type { Severity } from "@shepherdjerred/ops-model/severity.ts";
import type { SignalInput } from "@shepherdjerred/ops-model/snapshot.ts";
import { metricsLink } from "./ops-links.ts";
import { metric, type OpsCollection } from "./ops-types.ts";
import { backupFreshnessSignals } from "./backup-freshness.ts";
import { veleroOutcomes } from "./velero-outcomes.ts";

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
    "max by (instance, zpool_name) (1 - zfs_zpool_free_bytes / zfs_zpool_size_bytes)",
  /** Seconds since the last successful Velero backup per schedule. */
  veleroBackups:
    'time() - max by (schedule) (velero_backup_last_successful_timestamp{schedule!=""})',
  cpu: '1 - avg(rate(node_cpu_seconds_total{mode="idle"}[5m]))',
  memory:
    "1 - sum(node_memory_MemAvailable_bytes) / sum(node_memory_MemTotal_bytes)",
  /** SeaweedFS volume slot saturation across volume servers. */
  seaweedfsVolumes:
    "sum(SeaweedFS_volumeServer_volumes) / sum(SeaweedFS_volumeServer_max_volumes)",
  /** Seconds SeaweedFS filer.backup lags behind the filer's metadata stream. */
  seaweedfsBackupLag:
    'clamp_min((max(SeaweedFS_filer_last_send_timestamp_of_subscribe{clientName=~"filer:.*"}) - max(SeaweedFS_filer_last_send_timestamp_of_subscribe{clientName="backup_s3"})) / 1e9, 0)',
} as const;

export type MaintenanceQuery = keyof typeof MAINTENANCE_QUERIES;
export type MaintenanceSamples = Record<
  Exclude<MaintenanceQuery, "seaweedfsVolumes" | "seaweedfsBackupLag">,
  PrometheusSample[]
> & {
  seaweedfsVolumes?: PrometheusSample[];
  seaweedfsBackupLag?: PrometheusSample[];
};

const DAY_SECONDS = 86_400;
export const SEAWEEDFS_BACKUP_LAG_WARNING_SECONDS = 3600;
export const SEAWEEDFS_BACKUP_LAG_ERROR_SECONDS = 14_400;

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

function zpoolVolume(sample: PrometheusSample) {
  const zpool = label(sample, "zpool_name");
  const instance = sample.metric["instance"];
  const hasInstance = instance !== undefined && instance !== "";
  return {
    kind: "zpool",
    name: hasInstance ? `zpool ${instance}:${zpool}` : `zpool ${zpool}`,
    attributes: hasInstance ? { instance, zpool } : { zpool },
    ratio: sample.value,
    query: hasInstance
      ? `1 - zfs_zpool_free_bytes{instance="${instance}",zpool_name="${zpool}"} / zfs_zpool_size_bytes`
      : `1 - zfs_zpool_free_bytes{zpool_name="${zpool}"} / zfs_zpool_size_bytes`,
  };
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
    ...samples.zpools.map((sample) => zpoolVolume(sample)),
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

function seaweedfsSignals(samples: MaintenanceSamples): SignalInput[] {
  const signals: SignalInput[] = [];
  const volumeRatio = scalar(samples.seaweedfsVolumes ?? []);
  if (volumeRatio !== null) {
    const severity = diskSeverity(volumeRatio);
    if (severity !== "ok") {
      signals.push({
        id: "maintenance:seaweedfs:volumes",
        source: "maintenance",
        section: "maintenance",
        service: "storage",
        kind: "seaweedfs-volumes",
        severity,
        needsMe: false,
        title: `SeaweedFS volume slots are ${String(Math.round(volumeRatio * 100))}% full`,
        attributes: { usedRatio: volumeRatio },
        links: [
          metricsLink(
            "SeaweedFS volume slots",
            MAINTENANCE_QUERIES.seaweedfsVolumes,
            "now-7d",
          ),
        ],
      });
    }
  }
  const lagSeconds = scalar(samples.seaweedfsBackupLag ?? []);
  if (
    lagSeconds !== null &&
    lagSeconds >= SEAWEEDFS_BACKUP_LAG_WARNING_SECONDS
  ) {
    const severity: Severity =
      lagSeconds >= SEAWEEDFS_BACKUP_LAG_ERROR_SECONDS ? "error" : "warning";
    signals.push({
      id: "maintenance:seaweedfs:backup-lag",
      source: "maintenance",
      section: "maintenance",
      service: "storage",
      kind: "seaweedfs-backup-lag",
      severity,
      needsMe: false,
      title: `SeaweedFS B2 replication lag is ${String(Math.round(lagSeconds / 60))}m`,
      attributes: { lagSeconds: Math.round(lagSeconds) },
      links: [
        metricsLink(
          "SeaweedFS backup lag",
          MAINTENANCE_QUERIES.seaweedfsBackupLag,
          "now-24h",
        ),
      ],
    });
  }
  return signals;
}

function scalar(samples: readonly PrometheusSample[]): number | null {
  if (samples.length > 1) {
    throw new Error(`Expected one sample, got ${String(samples.length)}`);
  }
  const value = samples[0]?.value;
  return value === undefined || !Number.isFinite(value) ? null : value;
}

export function mapMaintenance(
  samples: MaintenanceSamples,
  schedules: readonly VeleroScheduleStatus[],
  backupResources: readonly VeleroBackupStatus[],
  now: Date,
): OpsCollection {
  const certificates = certificateSignals(samples);
  const capacity = capacitySignals(samples);
  const seaweedfs = seaweedfsSignals(samples);
  const backups = backupFreshnessSignals({
    velero: samples.veleroBackups,
    schedules,
    now,
  });
  const staleBackups = backups.filter(
    (backup) => backup.severity === "warning" || backup.severity === "error",
  );
  const unknownBackups = backups.some(
    (backup) => backup.severity === "unknown",
  );
  const ratios = [...samples.filesystems, ...samples.zpools].map(
    (sample) => sample.value,
  );
  const maxDisk = ratios.length === 0 ? null : Math.max(...ratios);
  const outcomes = veleroOutcomes(backupResources, schedules);
  const unknownOutcomes = outcomes.observations.some(
    (observation) => observation.failed === undefined,
  );
  return {
    signals: [
      ...certificates,
      ...capacity,
      ...seaweedfs,
      ...backups,
      ...outcomes.signals,
    ],
    metrics: [
      metric({
        section: "maintenance",
        source: "maintenance",
        id: METRIC_IDS.backupsFailed,
        label: "Failed backup schedules",
        value:
          unknownOutcomes && outcomes.signals.length === 0
            ? null
            : outcomes.signals.length,
        unit: "count",
        severity:
          outcomes.signals.length > 0
            ? "warning"
            : unknownOutcomes
              ? "unknown"
              : "ok",
      }),
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
        value:
          unknownBackups && staleBackups.length === 0
            ? null
            : staleBackups.length,
        unit: "count",
        severity: staleBackups.some((backup) => backup.severity === "error")
          ? "error"
          : staleBackups.length > 0
            ? "warning"
            : unknownBackups
              ? "unknown"
              : "ok",
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
