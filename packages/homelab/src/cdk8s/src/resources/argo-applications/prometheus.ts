import type { Chart} from "cdk8s";
import { Size } from "cdk8s";
import { Application } from "../../../generated/imports/argoproj.io.ts";
import versions from "../../versions.ts";
import { createIngress } from "../../misc/tailscale.ts";
import { NVME_STORAGE_CLASS } from "../../misc/storage-classes.ts";
import { OnePasswordItem } from "../../../generated/imports/onepassword.com.ts";
import { createPrometheusMonitoring } from "../monitoring/monitoring/prometheus.ts";
import { createSmartctlMonitoring } from "../monitoring/smartctl.ts";
import type { HelmValuesForChart } from "../../misc/typed-helm-parameters.ts";
import { createNvmeMetricsMonitoring } from "../monitoring/nvme-metrics.ts";
import { createZfsSnapshotsMonitoring } from "../monitoring/zfs-snapshots.ts";
import { createZfsZpoolMonitoring } from "../monitoring/zfs-zpool.ts";
import { createR2ExporterMonitoring } from "../monitoring/r2-exporter.ts";
import { createKubernetesEventExporter } from "../monitoring/kubernetes-event-exporter.ts";
import { escapeAlertmanagerTemplate } from "../monitoring/monitoring/rules/shared.ts";
// import { HelmValuesForChart } from "../types/helm/index.js"; // Using 'any' for complex config

export async function createPrometheusApp(chart: Chart) {
  createIngress(
    chart,
    "alertmanager-ingress",
    "prometheus",
    "prometheus-kube-prometheus-alertmanager",
    9093,
    ["alertmanager"],
    false,
  );

  createIngress(
    chart,
    "prometheus-ingress",
    "prometheus",
    "prometheus-kube-prometheus-prometheus",
    9090,
    ["prometheus"],
    false,
  );

  const alertmanagerSecrets = new OnePasswordItem(chart, "alertmanager-secrets-onepassword", {
    spec: {
      itemPath: "vaults/v64ocnykdqju4ui6j6pua56xw4/items/cki3qk5okk5b7xn3jmlpg74yka",
    },
    metadata: {
      name: "alertmanager-secrets",
      namespace: "prometheus",
    },
  });

  const prometheusSecrets = new OnePasswordItem(chart, "grafana-secret-onepassword", {
    spec: {
      itemPath: "vaults/v64ocnykdqju4ui6j6pua56xw4/items/42fn7x3zaemfenz35en27thw5u",
    },
    metadata: {
      name: "prometheus-secrets",
      namespace: "prometheus",
    },
  });

  createPrometheusMonitoring(chart);
  await createSmartctlMonitoring(chart);
  await createNvmeMetricsMonitoring(chart);
  await createZfsSnapshotsMonitoring(chart);
  await createZfsZpoolMonitoring(chart);
  await createR2ExporterMonitoring(chart);
  createKubernetesEventExporter(chart);

  // Type extension for blackbox-exporter subchart (not included in generated types)
  type PrometheusValuesWithBlackbox = HelmValuesForChart<"kube-prometheus-stack"> & {
    "prometheus-blackbox-exporter"?: {
      enabled?: boolean;
      config?: {
        modules?: Record<
          string,
          {
            prober: string;
            timeout?: string;
            http?: {
              valid_http_versions?: string[];
              valid_status_codes?: number[];
              follow_redirects?: boolean;
              preferred_ip_protocol?: string;
            };
          }
        >;
      };
    };
  };

  // Note: Some configurations bypass type checking due to incomplete generated types
  const prometheusValues: PrometheusValuesWithBlackbox = {
    // Enable blackbox-exporter for HTTP probing of static sites
    "prometheus-blackbox-exporter": {
      enabled: true,
      config: {
        modules: {
          http_2xx: {
            prober: "http",
            timeout: "10s",
            http: {
              valid_http_versions: ["HTTP/1.1", "HTTP/2.0"],
              valid_status_codes: [200, 301, 302],
              follow_redirects: true,
              preferred_ip_protocol: "ip4",
            },
          },
        },
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
    grafana: {
      // Database configuration via grafana.ini using file providers
      "grafana.ini": {
        database: {
          type: "postgres",
          host: "grafana-postgresql:5432",
          name: "grafana",
          user: "grafana",
          ssl_mode: "disable",
          // Password from mounted secret file
          password: "$__file{/etc/secrets/postgres/password}",
        },
        feature_toggles: {
          provisioning: true,
          kubernetesDashboards: true,
          grafanaAdvisor: true,
        },
      },
      imageRenderer: {
        enabled: true,
      },
      // Mount the auto-generated postgres-operator secret
      extraSecretMounts: [
        {
          name: "postgres-secret-mount",
          secretName: "grafana.grafana-postgresql.credentials.postgresql.acid.zalan.do",
          defaultMode: 0o440,
          mountPath: "/etc/secrets/postgres",
          readOnly: true,
        },
      ],
      persistence: {
        enabled: true,
        storageClassName: NVME_STORAGE_CLASS,
        labels: {
          "velero.io/backup": "enabled",
        },
      },
      // Deploy Grafana as a StatefulSet instead of Deployment to avoid PVC deadlock
      // Single-replica StatefulSet handles rolling updates properly with RWO (ReadWriteOnce) PVCs
      // by managing pod identity and volumes, so no strategy configuration is needed
      useStatefulSet: true,
      sidecar: {
        datasources: {
          alertmanager: {
            handleGrafanaManagedAlerts: true,
          },
        },
      },
      prune: true,
      additionalDataSources: [
        {
          name: "loki",
          editable: false,
          type: "loki",
          url: "http://loki-gateway.loki",
          version: 1,
        },
        {
          name: "tempo",
          editable: false,
          type: "tempo",
          url: "http://tempo.tempo.svc:3200",
          version: 1,
          // TODO: tracesToLogsV2 must be configured manually in Grafana UI.
          // See: docs/tempo-loki-correlation.md
          // Blocked by: https://github.com/grafana/grafana/issues/110740
        },
      ],
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
                routing_key_file: `/etc/alertmanager/secrets/${alertmanagerSecrets.name}/pagerduty_token`,
                // Alertmanager will evaluate this Go template when sending to PagerDuty
                // kube-prometheus-stack chart passes config values through without template processing
                description: escapeAlertmanagerTemplate(
                  String.raw`{{ range .Alerts }}{{ .Annotations.summary }}\n{{ .Annotations.description }}\n{{ end }}`,
                ),
                // Map alert severity label to PagerDuty severity (critical/warning/error/info)
                // Check if GroupLabels exists first (nil during helm lint)
                severity: escapeAlertmanagerTemplate(
                  '{{ if .GroupLabels }}{{ if eq .GroupLabels.severity "critical" }}critical{{ else if eq .GroupLabels.severity "warning" }}warning{{ else }}error{{ end }}{{ else }}error{{ end }}',
                ),
                // details: escapeAlertmanagerTemplate(
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
              matchers: ['alertname = "KubePdbNotEnoughHealthyPods"', 'poddisruptionbudget =~ ".*-critical-op-pdb"'],
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
      extraArgs: ["--collector.textfile.directory=/host/var/lib/node_exporter/textfile_collector"],

      extraHostVolumeMounts: [
        {
          name: "textfile-collector",
          hostPath: "/var/lib/node_exporter/textfile_collector",
          mountPath: "/host/var/lib/node_exporter/textfile_collector",
          readOnly: true,
          mountPropagation: "HostToContainer",
        },
      ],
    },
    prometheus: {
      prometheusSpec: {
        externalUrl: "https://prometheus.tailnet-1a49.ts.net",
        retention: "180d", // Keep data for 6 months
        retentionSize: "120GB", // Safety limit - delete old data if storage exceeds this
        storageSpec: {
          volumeClaimTemplate: {
            spec: {
              storageClassName: NVME_STORAGE_CLASS,
              accessModes: ["ReadWriteOnce"],
              resources: {
                requests: {
                  storage: Size.gibibytes(128).asString(),
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
          jsonPointers: ["/spec/template/metadata/annotations/checksum~1secret"],
        },
      ],
    },
  });
}
