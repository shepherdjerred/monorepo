import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { createIngress } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";
import { NVME_STORAGE_CLASS } from "@shepherdjerred/homelab/cdk8s/src/misc/storage-classes.ts";
import { CI_NODE_TOLERATION } from "@shepherdjerred/homelab/cdk8s/src/misc/nodes.ts";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import {
  BUILDKITE_IO_OBSERVABILITY_VALUES,
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
import { BLACKBOX_MODULES } from "@shepherdjerred/homelab/cdk8s/src/misc/blackbox-modules.ts";
import type { KubeprometheusstackHelmValuesAlertmanagerConfigRouteRoutesElement } from "@shepherdjerred/homelab/cdk8s/generated/helm/kube-prometheus-stack.types";

// The generated nested-route element type only models `receiver`/`matchers`,
// but Alertmanager child routes also accept `group_by` (the parent route type
// has it). Intersect it in so the per-execution grouping route below is typed
// honestly without a cast or a hand-edit to the generated types.
type AlertmanagerChildRoute =
  KubeprometheusstackHelmValuesAlertmanagerConfigRouteRoutesElement & {
    group_by: string[];
  };

function createPrometheusIngresses(chart: Chart): void {
  createIngress(chart, "alertmanager-ingress", {
    namespace: "prometheus",
    service: "prometheus-kube-prometheus-alertmanager",
    port: 9093,
    hosts: ["alertmanager"],
    proxyClass: "medium",
  });

  createIngress(chart, "prometheus-ingress", {
    namespace: "prometheus",
    service: "prometheus-kube-prometheus-prometheus",
    port: 9090,
    hosts: ["prometheus"],
  });
}

const ALERT_DASHBOARD_SERVICE_URL =
  "http://alert-dashboard-alert-dashboard-service.alert-dashboard.svc.cluster.local:7341";
const ALERTMANAGER_GLOBAL = {
  resolve_timeout: "5m",
  smtp_from: "alerts@sjer.red",
  smtp_smarthost: "postal-postal-smtp-service.postal.svc.cluster.local:25",
  smtp_require_tls: false,
};

export async function createPrometheusApp(chart: Chart) {
  // Temporal workflow-failure alerts (from the temporal-failure-watch schedule
  // in packages/temporal) all share alertname "TemporalWorkflowFailed" and carry
  // no `namespace` label, so under the parent route's group_by [namespace,
  // alertname] every failed execution would collapse into ONE notification
  // group / dedup key. Group by the per-execution identity labels so each failed
  // workflow execution remains distinct. Must precede the severity catch-all
  // route (these alerts are severity=warning).
  const temporalWorkflowFailureRoute: AlertmanagerChildRoute = {
    receiver: "alerts",
    matchers: ['alertname = "TemporalWorkflowFailed"'],
    group_by: ["alertname", "workflowId", "runId"],
  };
  const removedAgentTaskAggregateRoute: AlertmanagerChildRoute = {
    receiver: "null",
    // These alert names belonged to the removed hourly aggregate timeout
    // watcher. Keep stale rules/metrics from notifying while the new per-run
    // TemporalWorkflowFailed route remains the sole Temporal failure source.
    matchers: ['alertname =~ "TemporalAgentTask(TimingOut|TimeoutScanFailed)"'],
    group_by: ["alertname"],
  };
  createPrometheusIngresses(chart);

  createIngress(chart, "grafana-ingress", {
    namespace: "prometheus",
    service: "prometheus-grafana",
    port: 80,
    hosts: ["grafana"],
  });

  const alertDashboardSecrets = new OnePasswordItem(
    chart,
    "alert-dashboard-secrets-onepassword",
    {
      spec: { itemPath: vaultItemPath("alert-dashboard") },
      metadata: {
        name: "alert-dashboard-secrets",
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
      resources: {
        requests: { cpu: "20m", memory: "64Mi" },
      },
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
    defaultRules: {
      disabled: {
        // Replaced by the local firing-only rule. The chart default also
        // considers pending info alerts, which makes this control signal noisy.
        InfoInhibitor: true,
        KubeMemoryOvercommit: true,
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
    // cAdvisor owns the unique 10-second pod-parent counters. The normal
    // kube-state-metrics scrape adds Buildkite identity/link metadata; missing
    // joins remain explicit in the rules and CI I/O reporter rather than
    // accelerating the full cluster-wide metadata endpoint.
    ...BUILDKITE_IO_OBSERVABILITY_VALUES,
    grafana: createGrafanaValues(prometheusSecrets.name),
    prometheusOperator: {
      resources: {
        requests: { cpu: "100m", memory: "128Mi" },
      },
      prometheusConfigReloader: {
        resources: {
          requests: { cpu: "10m", memory: "64Mi" },
        },
      },
    },
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
        // Alertmanager's active-alert state is in-memory only (the PVC persists
        // just nflog/silences), so when it dies mid-outage, resolve events for
        // alerts that clear during the gap are never sent and the Alerts ledger
        // incidents orphan as forever-"triggered". With only the chart-default
        // 200Mi request and NO limit, it had one of the worst OOM scores on the
        // node and was the kernel's preferred victim in the 2026-07-11 global-OOM
        // storms (OOMKilled x5, e.g. 06:07:15Z) — exactly when its resolves
        // matter most. A real request keeps its score low so it survives storms;
        // the limit keeps it from becoming a problem itself (normal usage
        // ~50-100Mi).
        resources: {
          requests: {
            cpu: "50m",
            memory: "512Mi",
          },
          limits: {
            memory: "1Gi",
          },
        },
        storage: {
          volumeClaimTemplate: {
            metadata: {
              labels: {
                // Include the alertmanager PVC in Velero backups. Replaces the removed
                // Kyverno velero-label mutation (the chart templates volumeClaimTemplate
                // metadata onto the PVC, same as prometheusSpec above).
                "velero.io/backup": "enabled",
                "velero.io/exclude-from-backup": "false",
              },
            },
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
        secrets: [alertDashboardSecrets.name],
        logLevel: "debug",
      },
      config: {
        global: ALERTMANAGER_GLOBAL,
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
            name: "alerts",
            webhook_configs: [
              {
                send_resolved: true,
                url: `${ALERT_DASHBOARD_SERVICE_URL}/internal/v1/alertmanager/events`,
                http_config: {
                  authorization: {
                    type: "Bearer",
                    credentials_file: `/etc/alertmanager/secrets/${alertDashboardSecrets.name}/WEBHOOK_TOKEN`,
                  },
                },
              },
            ],
          },
          {
            name: "postal-fallback",
            email_configs: [
              {
                send_resolved: false,
                to: "claude@sjer.red",
              },
            ],
          },
        ],
        route: {
          group_by: ["namespace", "alertname"],
          group_wait: "30s",
          group_interval: "5m",
          repeat_interval: "12h",
          receiver: "alerts",
          routes: [
            {
              receiver: "postal-fallback",
              matchers: ['alert_dashboard_fallback = "true"'],
            },
            {
              // The Alerts webhook is the dashboard itself, so its own
              // namespace must retain an independent notification path while
              // that service is unavailable. This covers Kubernetes rollout
              // alerts and blackbox probe failures in addition to the explicit
              // AlertDashboard* rules above. Constrained to warning/critical so
              // it cannot outrun the info/Watchdog suppression routes below by
              // matching first — an info-level alert in this namespace must
              // still land on the null receiver.
              receiver: "postal-fallback",
              matchers: [
                'namespace = "alert-dashboard"',
                'severity =~ "critical|warning"',
              ],
            },
            {
              // AlertmanagerFailedToSendAlerts (single instance) and
              // AlertmanagerClusterFailedToSendAlerts (all instances, critical)
              // both fire once per failed notification integration — they
              // have historically fired together for this cluster (see
              // packages/docs/archive/homelab-audits/2026-04-04_homelab-health-audit-2.md).
              // Only route the webhook integration's failures here — that's
              // the one this fallback exists to diagnose. Email-integration
              // failures must stay on the normal Alerts receiver: routing a
              // "Postal is broken" diagnostic through Postal itself would
              // mean it never arrives.
              receiver: "postal-fallback",
              matchers: [
                'alertname =~ "AlertmanagerFailedToSendAlerts|AlertmanagerClusterFailedToSendAlerts"',
                'integration = "webhook"',
              ],
            },
            {
              // Prometheus-to-Alertmanager connectivity alerts diagnose the
              // webhook delivery path itself and cannot be delivered through
              // it. Deliberately an explicit alertname list, not `Alertmanager.*`
              // — that wildcard would also capture unrelated cluster/config
              // health alerts (e.g. AlertmanagerConfigInconsistent) that have
              // nothing to do with notification delivery and should notify
              // through the normal Alerts receiver like any other alert.
              receiver: "postal-fallback",
              matchers: [
                'alertname =~ "PrometheusErrorSendingAlertsTo.*|PrometheusNotConnectedToAlertmanagers"',
              ],
            },
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
              // Silence KubeJobFailed for Buildkite CI jobs — a failed PR build is a
              // normal outcome, already surfaced in Buildkite and as a GitHub commit
              // status. Job failures in every other namespace still page.
              receiver: "null",
              matchers: [
                'alertname = "KubeJobFailed"',
                'namespace = "buildkite"',
              ],
            },
            // Per-execution grouping for Temporal workflow failures —
            // see temporalWorkflowFailureRoute's definition above. Precedes the
            // severity catch-all (these alerts are severity=warning).
            temporalWorkflowFailureRoute,
            removedAgentTaskAggregateRoute,
            {
              // Route critical and warning alerts to the Alerts ledger.
              receiver: "alerts",
              matchers: ['severity =~ "critical|warning"'],
            },
          ],
        },
      },
    },
    // Configure node_exporter to enable textfile collector for all monitoring services
    // Collects metrics from: SMART, OS info, NTPD, NVMe, ZFS snapshots, ZFS zpools

    "prometheus-node-exporter": {
      // Node metrics must cover the CI-only node (liskov) too.
      tolerations: [CI_NODE_TOLERATION],
      resources: {
        requests: { cpu: "10m", memory: "64Mi" },
      },
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
        automated: { enabled: true },
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
