import { Chart, Duration } from "cdk8s";
import { ConfigMap, DaemonSet, Volume, ServiceAccount, Probe } from "cdk8s-plus-31";
import versions from "../../versions.ts";

export async function createSmartctlMonitoring(chart: Chart) {
  // Create ServiceAccount for the DaemonSet
  const serviceAccount = new ServiceAccount(chart, "smartctl-service-account", {
    metadata: {
      name: "smartctl-service-account",
      namespace: "prometheus",
    },
  });

  // Load the official smartmon.sh script using Bun.file
  const scriptPath = `${import.meta.dir}/smartmon.sh`;
  const scriptContent = await Bun.file(scriptPath).text();
  const smartmonScript = new ConfigMap(chart, "smartmon-script", {
    metadata: {
      name: "smartmon-script",
      namespace: "prometheus",
    },
    data: {
      "smartmon.sh": scriptContent,
    },
  });

  // Create DaemonSet to run the script on all nodes
  const smartctlDaemonSet = new DaemonSet(chart, "smartctl-collector", {
    metadata: {
      name: "smartctl-collector",
      namespace: "prometheus",
      labels: {
        app: "smartctl-collector",
      },
      annotations: {
        "ignore-check.kube-linter.io/sensitive-host-mounts": "Required for SMART disk monitoring via /dev, /proc, /sys",
        "ignore-check.kube-linter.io/privileged-container": "Required for raw disk device access",
        "ignore-check.kube-linter.io/privilege-escalation-container": "Required when privileged is true",
        "ignore-check.kube-linter.io/run-as-non-root": "Required for disk access as root",
        "ignore-check.kube-linter.io/no-read-only-root-fs": "Required to install smartmontools at runtime",
      },
    },
    serviceAccount,
    securityContext: {
      // Allow running as root for disk access
      ensureNonRoot: false,
      fsGroup: 0,
    },
  });

  // Configure the container
  const container = smartctlDaemonSet.addContainer({
    name: "smartctl-collector",
    image: `docker.io/alpine:${versions["library/alpine"]}`,
    command: ["/bin/sh"],
    args: [
      "-c",
      `
      # Install smartmontools and bash - exit on failure to trigger pod restart
      apk add --no-cache smartmontools bash || exit 1

      # Create textfile collector directory
      mkdir -p /host/var/lib/node_exporter/textfile_collector

      # Copy script to writable location and make executable
      cp /scripts/smartmon.sh /tmp/smartmon.sh
      chmod +x /tmp/smartmon.sh

      # Run the script every 5 minutes
      while true; do
        echo "Collecting SMART metrics using official prometheus-community script..."
        /tmp/smartmon.sh > /host/var/lib/node_exporter/textfile_collector/smartmon.prom.tmp 2>/dev/null || echo "# SMART collection failed" > /host/var/lib/node_exporter/textfile_collector/smartmon.prom.tmp
        mv /host/var/lib/node_exporter/textfile_collector/smartmon.prom.tmp /host/var/lib/node_exporter/textfile_collector/smartmon.prom
        echo "SMART metrics collected at $(date)"
        sleep 300
      done
      `,
    ],
    liveness: Probe.fromCommand(
      ["sh", "-c", "! grep -q 'collection failed' /host/var/lib/node_exporter/textfile_collector/smartmon.prom"],
      {
        initialDelaySeconds: Duration.seconds(60),
        periodSeconds: Duration.seconds(300),
        failureThreshold: 3,
      },
    ),
    securityContext: {
      privileged: true, // Required to access raw disk devices
      allowPrivilegeEscalation: true, // Required when privileged is true
      ensureNonRoot: false, // Required to run as root for disk access
      readOnlyRootFilesystem: false, // Allow writing to install packages
      user: 0,
      group: 0,
    },
  });

  // Mount the script from ConfigMap
  const scriptVolume = Volume.fromConfigMap(chart, "script-volume", smartmonScript);
  smartctlDaemonSet.addVolume(scriptVolume);
  container.mount("/scripts", scriptVolume);

  // Mount host directories
  const hostDevVolume = Volume.fromHostPath(chart, "smartctl-host-dev", "smartctl-host-dev", {
    path: "/dev",
  });
  smartctlDaemonSet.addVolume(hostDevVolume);
  container.mount("/dev", hostDevVolume);

  const hostProcVolume = Volume.fromHostPath(chart, "smartctl-host-proc", "smartctl-host-proc", {
    path: "/proc",
  });
  smartctlDaemonSet.addVolume(hostProcVolume);
  container.mount("/host/proc", hostProcVolume, { readOnly: true });

  const hostSysVolume = Volume.fromHostPath(chart, "smartctl-host-sys", "smartctl-host-sys", {
    path: "/sys",
  });
  smartctlDaemonSet.addVolume(hostSysVolume);
  container.mount("/host/sys", hostSysVolume, { readOnly: true });

  // Mount the textfile collector directory
  const textfileCollectorVolume = Volume.fromHostPath(
    chart,
    "smartctl-textfile-collector",
    "smartctl-textfile-collector",
    {
      path: "/var/lib/node_exporter/textfile_collector",
    },
  );
  smartctlDaemonSet.addVolume(textfileCollectorVolume);
  container.mount("/host/var/lib/node_exporter/textfile_collector", textfileCollectorVolume);

  return { serviceAccount, smartmonScript, smartctlDaemonSet };
}
