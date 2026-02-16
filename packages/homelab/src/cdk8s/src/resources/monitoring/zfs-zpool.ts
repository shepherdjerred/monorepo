import { Chart, Duration } from "cdk8s";
import { ConfigMap, DaemonSet, Volume, ServiceAccount, Probe } from "cdk8s-plus-31";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import versions from "../../versions.ts";

const CURRENT_FILENAME = fileURLToPath(import.meta.url);
const CURRENT_DIRNAME = dirname(CURRENT_FILENAME);

export async function createZfsZpoolMonitoring(chart: Chart) {
  // Load the script content from file
  const scriptPath = join(CURRENT_DIRNAME, "scripts", "zfs_zpool.sh");
  const scriptContent = await Bun.file(scriptPath).text();

  // Create ServiceAccount for the DaemonSet
  const serviceAccount = new ServiceAccount(chart, "zfs-zpool-service-account", {
    metadata: {
      name: "zfs-zpool-service-account",
      namespace: "prometheus",
    },
  });

  // Create ConfigMap with the zfs_zpool.sh script
  const zfsZpoolScript = new ConfigMap(chart, "zfs-zpool-script", {
    metadata: {
      name: "zfs-zpool-script",
      namespace: "prometheus",
    },
    data: {
      "zfs_zpool.sh": scriptContent,
    },
  });

  // Create DaemonSet to run the script on all nodes
  const zfsZpoolDaemonSet = new DaemonSet(chart, "zfs-zpool-collector", {
    metadata: {
      name: "zfs-zpool-collector",
      namespace: "prometheus",
      labels: {
        app: "zfs-zpool-collector",
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
  const container = zfsZpoolDaemonSet.addContainer({
    name: "zfs-zpool-collector",
    image: `docker.io/alpine:${versions["library/alpine"]}`,
    command: ["/bin/sh"],
    args: [
      "-c",
      `
      # Install dependencies - exit on failure to trigger pod restart
      apk add --no-cache zfs bash || exit 1

      # Create textfile collector directory
      mkdir -p /host/var/lib/node_exporter/textfile_collector

      # Copy script to writable location and make executable
      cp /scripts/zfs_zpool.sh /tmp/zfs_zpool.sh
      chmod +x /tmp/zfs_zpool.sh

      # Run the script every 10 minutes (zpool info changes moderately frequently)
      while true; do
        echo "Collecting ZFS zpool metrics..."
        /tmp/zfs_zpool.sh > /host/var/lib/node_exporter/textfile_collector/zfs_zpool.prom.tmp 2>/dev/null || echo "# ZFS zpool collection failed" > /host/var/lib/node_exporter/textfile_collector/zfs_zpool.prom.tmp
        mv /host/var/lib/node_exporter/textfile_collector/zfs_zpool.prom.tmp /host/var/lib/node_exporter/textfile_collector/zfs_zpool.prom
        echo "ZFS zpool metrics collected at $(date)"
        sleep 600
      done
      `,
    ],
    liveness: Probe.fromCommand(
      ["sh", "-c", "! grep -q 'collection failed' /host/var/lib/node_exporter/textfile_collector/zfs_zpool.prom"],
      {
        initialDelaySeconds: Duration.seconds(120),
        periodSeconds: Duration.seconds(600),
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
  const scriptVolume = Volume.fromConfigMap(chart, "zfs-zpool-script-volume", zfsZpoolScript);
  zfsZpoolDaemonSet.addVolume(scriptVolume);
  container.mount("/scripts", scriptVolume);

  // Mount host /dev directory for ZFS device access
  const hostDevVolume = Volume.fromHostPath(chart, "zfs-zpool-host-dev", "zfs-zpool-host-dev", {
    path: "/dev",
  });
  zfsZpoolDaemonSet.addVolume(hostDevVolume);
  container.mount("/dev", hostDevVolume);

  // Mount host /proc directory for ZFS
  const hostProcVolume = Volume.fromHostPath(chart, "zfs-zpool-host-proc", "zfs-zpool-host-proc", {
    path: "/proc",
  });
  zfsZpoolDaemonSet.addVolume(hostProcVolume);
  container.mount("/host/proc", hostProcVolume, { readOnly: true });

  // Mount host /sys directory for ZFS
  const hostSysVolume = Volume.fromHostPath(chart, "zfs-zpool-host-sys", "zfs-zpool-host-sys", {
    path: "/sys",
  });
  zfsZpoolDaemonSet.addVolume(hostSysVolume);
  container.mount("/host/sys", hostSysVolume, { readOnly: true });

  // Mount the textfile collector directory
  const textfileCollectorVolume = Volume.fromHostPath(
    chart,
    "zfs-zpool-textfile-collector",
    "zfs-zpool-textfile-collector",
    {
      path: "/var/lib/node_exporter/textfile_collector",
    },
  );
  zfsZpoolDaemonSet.addVolume(textfileCollectorVolume);
  container.mount("/host/var/lib/node_exporter/textfile_collector", textfileCollectorVolume);

  return { serviceAccount, zfsZpoolScript, zfsZpoolDaemonSet };
}
