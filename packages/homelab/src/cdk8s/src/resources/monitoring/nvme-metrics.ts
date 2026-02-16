import { Chart, Duration } from "cdk8s";
import { ConfigMap, DaemonSet, Volume, ServiceAccount, Probe } from "cdk8s-plus-31";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import versions from "../../versions.ts";

const CURRENT_FILENAME = fileURLToPath(import.meta.url);
const CURRENT_DIRNAME = dirname(CURRENT_FILENAME);

export async function createNvmeMetricsMonitoring(chart: Chart) {
  // Load the script content from file
  const scriptPath = join(CURRENT_DIRNAME, "scripts", "nvme_metrics.py");
  const scriptContent = await Bun.file(scriptPath).text();

  // Create ServiceAccount for the DaemonSet
  const serviceAccount = new ServiceAccount(chart, "nvme-metrics-service-account", {
    metadata: {
      name: "nvme-metrics-service-account",
      namespace: "prometheus",
    },
  });

  // Create ConfigMap with the nvme_metrics.py script
  const nvmeMetricsScript = new ConfigMap(chart, "nvme-metrics-script", {
    metadata: {
      name: "nvme-metrics-script",
      namespace: "prometheus",
    },
    data: {
      "nvme_metrics.py": scriptContent,
    },
  });

  // Create DaemonSet to run the script on all nodes
  const nvmeMetricsDaemonSet = new DaemonSet(chart, "nvme-metrics-collector", {
    metadata: {
      name: "nvme-metrics-collector",
      namespace: "prometheus",
      labels: {
        app: "nvme-metrics-collector",
      },
      annotations: {
        "ignore-check.kube-linter.io/sensitive-host-mounts": "Required for NVMe device monitoring via /dev",
        "ignore-check.kube-linter.io/privileged-container": "Required for NVMe device access",
        "ignore-check.kube-linter.io/privilege-escalation-container": "Required when privileged is true",
        "ignore-check.kube-linter.io/run-as-non-root": "Required for NVMe device access as root",
        "ignore-check.kube-linter.io/no-read-only-root-fs": "Required to install nvme-cli at runtime",
      },
    },
    serviceAccount,
    securityContext: {
      ensureNonRoot: false,
      fsGroup: 0,
    },
  });

  // Configure the container
  const container = nvmeMetricsDaemonSet.addContainer({
    name: "nvme-metrics-collector",
    image: `docker.io/library/python:${versions["library/python"]}`,
    command: ["/bin/sh"],
    args: [
      "-c",
      `
      # Install dependencies - exit on failure to trigger pod restart
      apk add --no-cache nvme-cli || exit 1
      pip install prometheus_client || exit 1

      # Create textfile collector directory
      mkdir -p /host/var/lib/node_exporter/textfile_collector

      # Copy script to writable location and make executable
      cp /scripts/nvme_metrics.py /tmp/nvme_metrics.py
      chmod +x /tmp/nvme_metrics.py

      # Run the script every 10 minutes (NVMe metrics don't change too frequently)
      while true; do
        echo "Collecting NVMe metrics..."
        python3 /tmp/nvme_metrics.py > /host/var/lib/node_exporter/textfile_collector/nvme_metrics.prom.tmp 2>/dev/null || echo "# NVMe metrics collection failed" > /host/var/lib/node_exporter/textfile_collector/nvme_metrics.prom.tmp
        mv /host/var/lib/node_exporter/textfile_collector/nvme_metrics.prom.tmp /host/var/lib/node_exporter/textfile_collector/nvme_metrics.prom
        echo "NVMe metrics collected at $(date)"
        sleep 600
      done
      `,
    ],
    liveness: Probe.fromCommand(
      ["sh", "-c", "! grep -q 'collection failed' /host/var/lib/node_exporter/textfile_collector/nvme_metrics.prom"],
      {
        initialDelaySeconds: Duration.seconds(120),
        periodSeconds: Duration.seconds(600),
        failureThreshold: 3,
      },
    ),
    securityContext: {
      privileged: true, // Required to access NVMe devices
      allowPrivilegeEscalation: true,
      ensureNonRoot: false,
      readOnlyRootFilesystem: false,
      user: 0,
      group: 0,
    },
  });

  // Mount the script from ConfigMap
  const scriptVolume = Volume.fromConfigMap(chart, "nvme-metrics-script-volume", nvmeMetricsScript);
  nvmeMetricsDaemonSet.addVolume(scriptVolume);
  container.mount("/scripts", scriptVolume);

  // Mount host /dev directory for NVMe device access
  const hostDevVolume = Volume.fromHostPath(chart, "nvme-host-dev", "nvme-host-dev", {
    path: "/dev",
  });
  nvmeMetricsDaemonSet.addVolume(hostDevVolume);
  container.mount("/dev", hostDevVolume);

  // Mount the textfile collector directory
  const textfileCollectorVolume = Volume.fromHostPath(
    chart,
    "nvme-metrics-textfile-collector",
    "nvme-metrics-textfile-collector",
    {
      path: "/var/lib/node_exporter/textfile_collector",
    },
  );
  nvmeMetricsDaemonSet.addVolume(textfileCollectorVolume);
  container.mount("/host/var/lib/node_exporter/textfile_collector", textfileCollectorVolume);

  return { serviceAccount, nvmeMetricsScript, nvmeMetricsDaemonSet };
}
