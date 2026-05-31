import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { createIngress } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";
import { NVME_STORAGE_CLASS } from "@shepherdjerred/homelab/cdk8s/src/misc/storage-classes.ts";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import {
  createGrafanaValues,
  type PrometheusValuesWithBlackbox,
} from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/grafana-values.ts";
import { createPrometheusMonitoring } from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/monitoring/prometheus.ts";
import { createSmartctlMonitoring } from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/smartctl.ts";
import { createNvmeMetricsMonitoring } from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/nvme-metrics.ts";
import { createZfsSnapshotsMonitoring } from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/zfs-snapshots.ts";
import { createZfsZpoolMonitoring } from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/zfs-zpool.ts";
import { createR2ExporterMonitoring } from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/r2-exporter.ts";
import { createKubernetesEventExporter } from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/kubernetes-event-exporter.ts";
import { escapeHelmGoTemplate } from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/monitoring/rules/shared.ts";
import { BLACKBOX_MODULES } from "@shepherdjerred/homelab/cdk8s/src/misc/blackbox-modules.ts";

export async function createPrometheusApp(chart: Chart) {
  createIngress(chart, "alertmanager-ingress", {
    namespace: "prometheus",
    service: "prometheus-kube-prometheus-alertmanager",
    port: 9093,
    hosts: ["alertmanager"],
  });

  createIngress(chart, "prometheus-ingress", {
    namespace: "prometheus",
    service: "prometheus-kube-prometheus-prometheus",
    port: 9090,
    hosts: ["prometheus"],
  });

  createIngress(chart, "grafana-ingress", {
    namespace: "prometheus",
    service: "prometheus-grafana",
    port: 80,
    hosts: ["grafana"],
  });

  const alertmanagerSecrets = new OnePasswordItem(
    chart,
    "alertmanager-secrets-onepassword",
    {
      spec: {
        itemPath:
          "vaults/v64ocnykdqju4ui6j6pua56xw4/items/cki3qk5okk5b7xn3jmlpg74yka",
      },
      metadata: {
        name: "alertmanager-secrets",
        namespace: "prometheus",
      },
    },
  );

  const prometheusSecrets = new OnePasswordItem(
    chart,
    "grafana-secret-onepassword",
    {
      spec: {
        itemPath: vaultItemPath("42fn7x3zaemfenz35en27thw5u"),
      },
      metadata: {
        name: "prometheus-secrets",
        namespace: "prometheus",
      },
    },
  );

  createPrometheusMonitoring(chart);
  await createSmartctlMonitoring(chart);
  await createNvmeMetricsMonitoring(chart);
  await createZfsSnapshotsMonitoring(chart);
  await createZfsZpoolMonitoring(chart);
  await createR2ExporterMonitoring(chart);
  createKubernetesEventExporter(chart);

  // Note: Some configurations bypass type checking due to incomplete generated types
  const prometheusValues: PrometheusValuesWithBlackbox = {
    // Enable blackbox-exporter for HTTP probing of static sites
    "prometheus-blackbox-exporter": {
      enabled: true,
      config: {
        modules: BLACKBOX_MODULES,
      },
    },
    // Tune default alert rules that are too sensitive for homelab
    customRules: {
      // CPUThrottlingHigh default is 25% for 15m - too sensitive for homelab workloads
      // Many containers have low CPU limits and throttle briefly under load
      CPUThrottlingHigh: {
        for: "30m",
        severity: "info",
      },
    },
    kubeProxy: {
      // disable components that fail
      // https://github.com/prometheus-operator/kube-prometheus/issues/718
      enabled: false,
    },
    kubeScheduler: {
      // disable components that fail
      // https://github.com/prometheus-operator/kube-prometheus/issues/718
      enabled: false,
    },
    kubeControllerManager: {
      // disable components that fail
      // https://github.com/prometheus-operator/kube-prometheus/issues/718
      enabled: false,
    },
    grafana: createGrafanaValues(prometheusSecrets.name),
    nodeExporter: {
      operatingSystems: {
        linux: {
          enabled: true,
        },
        aix: {
          enabled: false,
        },
        darwin: {
          enabled: false,
        },
      },
    },
    alertmanager: {
      alertmanagerSpec: {
        externalUrl: "https://alertmanager.tailnet-1a49.ts.net",
        storage: {
          volumeClaimTemplate: {
            spec: {
              storageClassName: NVME_STORAGE_CLASS,
              accessModes: ["ReadWriteOnce"],
              resources: {
                requests: {
                  storage: Size.gibibytes(8).asString(),
                },
              },
              selector: null,
            },
          },
        },
        secrets: [alertmanagerSecrets.name],
        logLevel: "debug",
      },
      config: {
        global: {
          resolve_timeout: "5m",
        },
        inhibit_rules: [
          {
            source_matchers: ["severity = critical"],
            target_matchers: ["severity =~ warning|info"],
            equal: ["namespace", "alertname"],
          },
          {
            source_matchers: ["severity = warning"],
            target_matchers: ["severity = info"],
            equal: ["namespace", "alertname"],
          },
          {
            source_matchers: ["alertname = InfoInhibitor"],
            target_matchers: ["severity = info"],
            equal: ["namespace"],
          },
          {
            target_matchers: ["alertname = InfoInhibitor"],
          },
          {
            source_matchers: ['alertname = "HaWorkflowHighFailureRate"'],
            target_matchers: ['alertname = "HaWorkflowFailed"'],
            equal: ["workflow"],
          },
        ],
        templates: ["/etc/alertmanager/config/*.tmpl"],
        receivers: [
          {
            name: "null",
          },
          {
            name: "pagerduty",
            // https://prometheus.io/docs/alerting/latest/configuration/#pagerduty_config
            pagerduty_configs: [
              {
                send_resolved: true,
                routing_key_file: `/etc/alertmanager/secrets/${alertmanagerSecrets.name}/PAGERDUTY_TOKEN`,
                // Alertmanager will evaluate this Go template when sending to PagerDuty
                // kube-prometheus-stack chart passes config values through without template processing
                //
                // NOTE: use a real newline between alerts, not a literal `\n`. Go's
                // text/template does not interpret backslash escapes in literal template
                // text (only inside quoted action strings), so `\n` would reach PagerDuty
                // as the two characters "\n" and clutter the incident title.
                //
                // NOTE: include the namespace and fall back from `.message` to
                // `.description`. Different rule families use different detail
                // annotations (Velero/HA rules use `message`; createSensorAlert uses
                // `description`). Without the fallback, message-based alerts page with
                // only the static summary, making distinct incidents look like duplicates.
                description: escapeHelmGoTemplate(
                  `{{ range .Alerts }}{{ .Annotations.summary }}{{ if .Labels.namespace }} ({{ .Labels.namespace }}){{ end }}: {{ if .Annotations.message }}{{ .Annotations.message }}{{ else }}{{ .Annotations.description }}{{ end }}\n{{ end }}`,
                ),
                // Map alert severity label to PagerDuty severity (critical/warning/error/info)
                // Check if GroupLabels exists first (nil during helm lint)
                severity: escapeHelmGoTemplate(
                  '{{ if .GroupLabels }}{{ if eq .GroupLabels.severity "critical" }}critical{{ else if eq .GroupLabels.severity "warning" }}warning{{ else if eq .GroupLabels.severity "error" }}error{{ else if eq .GroupLabels.severity "info" }}info{{ else }}error{{ end }}{{ else }}error{{ end }}',
                ),
                // details: escapeHelmGoTemplate(
                //   JSON.stringify(
                //     {
                //       firing: "{{ range .Alerts.Firing }}{{ . }}\n{{ end }}",
                //       resolved:
                //         "{{ range .Alerts.Resolved }}{{ . }}\n{{ end }}",
                //       num_firing: "{{ .Alerts.Firing | len }}",
                //       num_resolved: "{{ .Alerts.Resolved | len }}",
                //     },
                //     null,
                //     2,
                //   ),
                // ),
                // // Grafana has an image rendering feature
                // // let's see if we can use it here
                // images: [],
                // links: [],
                // component: "",
                // group: "",
                // class: "",
              },
            ],
          },
        ],
        route: {
          group_by: ["namespace", "alertname"],
          group_wait: "30s",
          group_interval: "5m",
          repeat_interval: "12h",
          receiver: "pagerduty",
          routes: [
            {
              receiver: "null",
              matchers: ['alertname = "Watchdog"'],
            },
            {
              // InfoInhibitor is used internally to suppress info-level alerts, don't page for it
              receiver: "null",
              matchers: ['alertname = "InfoInhibitor"'],
            },
            {
              // Route info-level alerts to null receiver (don't page for informational alerts)
              receiver: "null",
              matchers: ['severity = "info"'],
            },
            {
              // Silence NodeMemoryMajorPagesFaults - noisy kube-prometheus-stack default
              // Custom memory alerts (HighMemoryPressure, LowMemoryAvailable, MemoryLeakSuspected) provide better coverage
              receiver: "null",
              matchers: ['alertname = "NodeMemoryMajorPagesFaults"'],
            },
            {
              // Silence PDB alerts for postgres-operator critical-op PDBs
              // These PDBs only match pods during critical operations, so Total=0 is expected
              receiver: "null",
              matchers: [
                'alertname = "KubePdbNotEnoughHealthyPods"',
                'poddisruptionbudget =~ ".*-critical-op-pdb"',
              ],
            },
            {
              // Route critical and warning alerts to PagerDuty
              receiver: "pagerduty",
              matchers: ['severity =~ "critical|warning"'],
            },
          ],
        },
      },
    },
    // Configure node_exporter to enable textfile collector for all monitoring services
    // Collects metrics from: SMART, OS info, NTPD, NVMe, ZFS snapshots, ZFS zpools

    "prometheus-node-exporter": {
      extraArgs: [
        "--collector.textfile.directory=/host/var/lib/node_exporter/textfile_collector",
      ],

      extraHostVolumeMounts: [
        {
          name: "textfile-collector",
          hostPath: "/var/lib/node_exporter/textfile_collector",
          mountPath: "/host/var/lib/node_exporter/textfile_collector",
          readOnly: true,
          mountPropagation: "HostToContainer",
        },
      ],

      prometheus: {
        monitor: {
          relabelings: [
            {
              sourceLabels: ["__meta_kubernetes_pod_node_name"],
              targetLabel: "node",
              action: "replace",
            },
          ],
        },
      },
    },
    prometheus: {
      prometheusSpec: {
        externalUrl: "https://prometheus.tailnet-1a49.ts.net",
        retention: "365d", // Keep data for 1 year
        retentionSize: "200GB", // Safety limit - keep headroom below PVC usage alerts
        // Required so Tempo's metrics-generator can push service-graph,
        // span-metrics, and local-blocks samples to Prometheus via remote_write.
        enableRemoteWriteReceiver: true,
        storageSpec: {
          volumeClaimTemplate: {
            metadata: {
              labels: {
                "velero.io/backup": "disabled",
                "velero.io/exclude-from-backup": "true",
              },
            },
            spec: {
              storageClassName: NVME_STORAGE_CLASS,
              accessModes: ["ReadWriteOnce"],
              resources: {
                requests: {
                  storage: Size.gibibytes(256).asString(),
                },
              },
              selector: null,
            },
          },
        },
        secrets: [prometheusSecrets.name],
        additionalScrapeConfigs: [
          {
            job_name: "hass",
            scrape_interval: "60s",
            metrics_path: "/api/prometheus",
            authorization: {
              credentials_file: `/etc/prometheus/secrets/${prometheusSecrets.name}/HOMEASSISTANT_TOKEN`,
            },
            scheme: "http",
            static_configs: [
              {
                targets: ["home-homeassistant-service.home:8123"],
              },
            ],
          },
        ],
      },
    },
  };

  return new Application(chart, "prometheus-app", {
    metadata: {
      name: "prometheus",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        // https://github.com/prometheus-community/helm-charts/
        repoUrl: "https://prometheus-community.github.io/helm-charts",
        chart: "kube-prometheus-stack",
        targetRevision: versions["kube-prometheus-stack"],
        helm: {
          valuesObject: prometheusValues,
        },
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "prometheus",
      },
      syncPolicy: {
        automated: {},
        syncOptions: ["CreateNamespace=true", "ServerSideApply=true"],
      },
      ignoreDifferences: [
        {
          group: "",
          kind: "Secret",
          name: "prometheus-grafana",
          namespace: "prometheus",
          jsonPointers: ["/data/admin-password"],
        },
        {
          group: "apps",
          kind: "StatefulSet",
          name: "prometheus-grafana",
          namespace: "prometheus",
          jsonPointers: [
            "/spec/template/metadata/annotations/checksum~1secret",
          ],
        },
      ],
    },
  });
}
