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
                // Alertmanager evaluates these Go templates when sending to PagerDuty.
                // The kube-prometheus-stack chart passes config values through without
                // template processing, so they must be Helm-escaped (escapeHelmGoTemplate).
                //
                // TITLE (`description`): keep it a single clean line. PagerDuty uses this
                // as the incident title and truncates it mid-word at ~1024 chars, so the
                // full per-alert body must NOT go here — it belongs in `details` below.
                // We use the shared static summary (CommonAnnotations.summary, falling back
                // to the alertname), then append the namespace and a firing count so that
                // distinct namespaces/objects grouped into one incident stay distinguishable
                // (the original reason the body was inlined here — see
                // packages/docs/logs/2026-07-03_pagerduty-clean-titles.md).
                description: escapeHelmGoTemplate(
                  `{{ if .CommonAnnotations.summary }}{{ .CommonAnnotations.summary }}{{ else }}{{ .CommonLabels.alertname }}{{ end }}{{ if .CommonLabels.namespace }} [{{ .CommonLabels.namespace }}]{{ end }}{{ if gt (len .Alerts.Firing) 1 }} (x{{ len .Alerts.Firing }}){{ end }}`,
                ),
                // Link the incident back to Alertmanager.
                client: "Alertmanager",
                client_url: escapeHelmGoTemplate(`{{ .ExternalURL }}`),
                // Map the alert severity label to PagerDuty event severity. Use
                // CommonLabels (shared across the group) — `severity` is not in group_by,
                // so GroupLabels.severity would be empty and always fall through to "error".
                severity: escapeHelmGoTemplate(
                  '{{ if eq .CommonLabels.severity "critical" }}critical{{ else if eq .CommonLabels.severity "warning" }}warning{{ else if eq .CommonLabels.severity "info" }}info{{ else }}error{{ end }}',
                ),
                // Structured detail — PagerDuty renders `details` as a Custom Details
                // section. Each firing/resolved alert contributes one line, falling back
                // from `.message` (Velero/HA rules) to `.description` (createSensorAlert),
                // so the per-alert specifics that used to clutter the title live here.
                details: {
                  alertname: escapeHelmGoTemplate(
                    `{{ .CommonLabels.alertname }}`,
                  ),
                  namespace: escapeHelmGoTemplate(
                    `{{ .CommonLabels.namespace }}`,
                  ),
                  severity: escapeHelmGoTemplate(
                    `{{ .CommonLabels.severity }}`,
                  ),
                  num_firing: escapeHelmGoTemplate(
                    `{{ .Alerts.Firing | len }}`,
                  ),
                  num_resolved: escapeHelmGoTemplate(
                    `{{ .Alerts.Resolved | len }}`,
                  ),
                  firing: escapeHelmGoTemplate(
                    `{{ range .Alerts.Firing }}- {{ if .Annotations.message }}{{ .Annotations.message }}{{ else }}{{ .Annotations.description }}{{ end }}\n{{ end }}`,
                  ),
                  resolved: escapeHelmGoTemplate(
                    `{{ range .Alerts.Resolved }}- {{ if .Annotations.message }}{{ .Annotations.message }}{{ else }}{{ .Annotations.description }}{{ end }}\n{{ end }}`,
                  ),
                },
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
        // Baseline request so Prometheus isn't BestEffort (first evicted under
        // memory pressure). Steady ~1.9Gi, 30d spike to ~17.6Gi (compaction/big
        // queries) — request covers steady state; deliberately no limit.
        resources: {
          requests: {
            cpu: "200m",
            memory: "4Gi",
          },
        },
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
          // The grafana subchart regenerates this image-renderer token on
          // every helm render (randAlphaNum), so it can never converge.
          // The live token is the source of truth; never reconcile it.
          group: "",
          kind: "Secret",
          name: "prometheus-grafana-image-renderer",
          namespace: "prometheus",
          jsonPointers: ["/data/token"],
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
