import { Chart, Duration } from "cdk8s";
import { ConfigMap, DaemonSet, Volume, ServiceAccount, Probe } from "cdk8s-plus-31";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import versions from "../../versions.ts";

const CURRENT_FILENAME = fileURLToPath(import.meta.url);
const CURRENT_DIRNAME = dirname(CURRENT_FILENAME);

export async function createZfsSnapshotsMonitoring(chart: Chart) {
  // Load the script content from file
  const scriptPath = join(CURRENT_DIRNAME, "scripts", "zfs_snapshots.py");
  const scriptContent = await Bun.file(scriptPath).text();

  // Create ServiceAccount for the DaemonSet
  const serviceAccount = new ServiceAccount(chart, "zfs-snapshots-service-account", {
    metadata: {
      name: "zfs-snapshots-service-account",
      namespace: "prometheus",
    },
  });

  // Create ConfigMap with the zfs_snapshots.py script
  const zfsSnapshotsScript = new ConfigMap(chart, "zfs-snapshots-script", {
    metadata: {
      name: "zfs-snapshots-script",
      namespace: "prometheus",
    },
    data: {
      "zfs_snapshots.py": scriptContent,
    },
  });

  // Create DaemonSet to run the script on all nodes
  const zfsSnapshotsDaemonSet = new DaemonSet(chart, "zfs-snapshots-collector", {
    metadata: {
      name: "zfs-snapshots-collector",
      namespace: "prometheus",
      labels: {
        app: "zfs-snapshots-collector",
      },
      annotations: {
        "ignore-check.kube-linter.io/sensitive-host-mounts": "Required for ZFS monitoring via /dev, /proc, /sys",
        "ignore-check.kube-linter.io/privileged-container": "Required for ZFS device access",
        "ignore-check.kube-linter.io/privilege-escalation-container": "Required when privileged is true",
        "ignore-check.kube-linter.io/run-as-non-root": "Required for ZFS access as root",
        "ignore-check.kube-linter.io/no-read-only-root-fs": "Required to install zfs tools at runtime",
      },
    },
    serviceAccount,
    securityContext: {
      ensureNonRoot: false,
      fsGroup: 0,
    },
  });

  // Configure the container
  const container = zfsSnapshotsDaemonSet.addContainer({
    name: "zfs-snapshots-collector",
    image: `docker.io/library/python:${versions["library/python"]}`,
    command: ["/bin/sh"],
    args: [
      "-c",
      `
      # Install dependencies - exit on failure to trigger pod restart
      apk add --no-cache zfs || exit 1
      pip install prometheus_client || exit 1

      # Create textfile collector directory
      mkdir -p /host/var/lib/node_exporter/textfile_collector

      # Copy script to writable location and make executable
      cp /scripts/zfs_snapshots.py /tmp/zfs_snapshots.py
      chmod +x /tmp/zfs_snapshots.py

      # Run the script every 15 minutes (snapshot info doesn't change too frequently)
      while true; do
        echo "Collecting ZFS snapshots metrics..."
        python3 /tmp/zfs_snapshots.py > /host/var/lib/node_exporter/textfile_collector/zfs_snapshots.prom.tmp 2>/dev/null || echo "# ZFS snapshots collection failed" > /host/var/lib/node_exporter/textfile_collector/zfs_snapshots.prom.tmp
        mv /host/var/lib/node_exporter/textfile_collector/zfs_snapshots.prom.tmp /host/var/lib/node_exporter/textfile_collector/zfs_snapshots.prom
        echo "ZFS snapshots metrics collected at $(date)"
        sleep 900
      done
      `,
    ],
    liveness: Probe.fromCommand(
      ["sh", "-c", "! grep -q 'collection failed' /host/var/lib/node_exporter/textfile_collector/zfs_snapshots.prom"],
      {
        initialDelaySeconds: Duration.seconds(120),
        periodSeconds: Duration.seconds(900),
        failureThreshold: 3,
      },
    ),
    securityContext: {
      privileged: true, // Required to access ZFS
      allowPrivilegeEscalation: true,
      ensureNonRoot: false,
      readOnlyRootFilesystem: false,
      user: 0,
      group: 0,
    },
  });

  // Mount the script from ConfigMap
  const scriptVolume = Volume.fromConfigMap(chart, "zfs-snapshots-script-volume", zfsSnapshotsScript);
  zfsSnapshotsDaemonSet.addVolume(scriptVolume);
  container.mount("/scripts", scriptVolume);

  // Mount host /dev directory for ZFS device access
  const hostDevVolume = Volume.fromHostPath(chart, "zfs-snapshots-host-dev", "zfs-snapshots-host-dev", {
    path: "/dev",
  });
  zfsSnapshotsDaemonSet.addVolume(hostDevVolume);
  container.mount("/dev", hostDevVolume);

  // Mount host /proc directory for ZFS
  const hostProcVolume = Volume.fromHostPath(chart, "zfs-snapshots-host-proc", "zfs-snapshots-host-proc", {
    path: "/proc",
  });
  zfsSnapshotsDaemonSet.addVolume(hostProcVolume);
  container.mount("/host/proc", hostProcVolume, { readOnly: true });

  // Mount host /sys directory for ZFS
  const hostSysVolume = Volume.fromHostPath(chart, "zfs-snapshots-host-sys", "zfs-snapshots-host-sys", {
    path: "/sys",
  });
  zfsSnapshotsDaemonSet.addVolume(hostSysVolume);
  container.mount("/host/sys", hostSysVolume, { readOnly: true });

  // Mount the textfile collector directory
  const textfileCollectorVolume = Volume.fromHostPath(
    chart,
    "zfs-snapshots-textfile-collector",
    "zfs-snapshots-textfile-collector",
    {
      path: "/var/lib/node_exporter/textfile_collector",
    },
  );
  zfsSnapshotsDaemonSet.addVolume(textfileCollectorVolume);
  container.mount("/host/var/lib/node_exporter/textfile_collector", textfileCollectorVolume);

  return { serviceAccount, zfsSnapshotsScript, zfsSnapshotsDaemonSet };
}
