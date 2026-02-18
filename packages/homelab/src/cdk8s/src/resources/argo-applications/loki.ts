import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { createIngress } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";
import { NVME_STORAGE_CLASS } from "@shepherdjerred/homelab/cdk8s/src/misc/storage-classes.ts";
import type { HelmValuesForChart } from "@shepherdjerred/homelab/cdk8s/src/misc/typed-helm-parameters.ts";
import { ConfigMap } from "cdk8s-plus-31";

// Loki alerting rules for Kubernetes events
// Note: Go template syntax escaped for Helm compatibility ({{ "{{" }} ... {{ "}}" }})
const kubernetesEventsAlertRules = `
groups:
  - name: kubernetes-events
    rules:
      - alert: KubernetesWarningEvent
        expr: |
          sum by (namespace, kind, name, reason) (
            count_over_time({app="kubernetes-events", type="Warning"} [5m])
          ) > 0
        for: 0m
        labels:
          severity: warning
        annotations:
          summary: "Kubernetes Warning event: {{ "{{" }} $labels.reason {{ "}}" }}"
          description: "Warning event for {{ "{{" }} $labels.kind {{ "}}" }}/{{ "{{" }} $labels.name {{ "}}" }} in namespace {{ "{{" }} $labels.namespace {{ "}}" }}. Reason: {{ "{{" }} $labels.reason {{ "}}" }}. Count: {{ "{{" }} $value {{ "}}" }} in last 5 minutes."
      - alert: KubernetesFailedScheduling
        expr: |
          sum by (namespace, name) (
            count_over_time({app="kubernetes-events", reason="FailedScheduling"} [10m])
          ) > 0
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Pod scheduling failure"
          description: "Pod {{ "{{" }} $labels.name {{ "}}" }} in namespace {{ "{{" }} $labels.namespace {{ "}}" }} failed to schedule. Check node resources and taints."
      - alert: KubernetesImagePullFailure
        expr: |
          sum by (namespace, name) (
            count_over_time({app="kubernetes-events", reason=~"Failed|ErrImagePull|ImagePullBackOff"} |~ "(?i)(pull|image)" [10m])
          ) > 0
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Image pull failure"
          description: "Failed to pull image for {{ "{{" }} $labels.name {{ "}}" }} in namespace {{ "{{" }} $labels.namespace {{ "}}" }}."
      - alert: KubernetesOOMKilled
        expr: |
          count_over_time({app="kubernetes-events", reason="OOMKilled"} [15m]) > 0
        for: 0m
        labels:
          severity: warning
        annotations:
          summary: "Container OOMKilled"
          description: "A container was killed due to out of memory. Check memory limits."
      - alert: KubernetesCrashLoopBackOff
        expr: |
          sum by (namespace, name) (
            count_over_time({app="kubernetes-events", reason="BackOff"} |~ "(?i)crash" [15m])
          ) > 2
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Container in CrashLoopBackOff"
          description: "Container {{ "{{" }} $labels.name {{ "}}" }} in namespace {{ "{{" }} $labels.namespace {{ "}}" }} is in CrashLoopBackOff."
      - alert: KubernetesVolumeFailure
        expr: |
          sum by (namespace, name, reason) (
            count_over_time({app="kubernetes-events", reason=~"FailedAttachVolume|FailedMount|FailedBinding"} [10m])
          ) > 0
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Volume operation failed"
          description: "Volume failure for {{ "{{" }} $labels.name {{ "}}" }} in namespace {{ "{{" }} $labels.namespace {{ "}}" }}. Reason: {{ "{{" }} $labels.reason {{ "}}" }}."
      - alert: KubernetesNodeNotReady
        expr: |
          count_over_time({app="kubernetes-events", kind="Node", reason=~"NodeNotReady|NodeNotSchedulable"} [5m]) > 0
        for: 0m
        labels:
          severity: critical
        annotations:
          summary: "Node not ready"
          description: "A Kubernetes node is not ready or not schedulable."
      - alert: KubernetesHighEventRate
        expr: |
          sum(count_over_time({app="kubernetes-events", type="Warning"} [5m])) > 50
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "High rate of Kubernetes warning events"
          description: "More than 50 warning events in the last 5 minutes ({{ "{{" }} $value {{ "}}" }} events). This may indicate a cluster issue."
`;

// Loki alerting rules for DNS audit
// Uses namespace label (always available) instead of app label (requires relabeling)
// Note: Go template syntax escaped for Helm compatibility ({{ "{{" }} ... {{ "}}" }})
const dnsAuditAlertRules = `
groups:
  - name: dns-audit
    rules:
      - alert: DNSAuditError
        expr: |
          count_over_time({namespace="dns-audit"} | json | level="error" [1h]) > 0
        for: 0m
        labels:
          severity: critical
        annotations:
          summary: "DNS audit found errors"
          description: "DNS audit detected configuration errors. Check dns-audit logs for details."
          runbook_url: "https://grafana.tailnet-1a49.ts.net/explore?schemaVersion=1&panes=%7B%22v1d%22:%7B%22datasource%22:%22loki%22,%22queries%22:%5B%7B%22refId%22:%22A%22,%22expr%22:%22%7Bnamespace%3D%5C%22dns-audit%5C%22%7D%20%7C%20json%20%7C%20level%3D%5C%22error%5C%22%22%7D%5D%7D%7D"
      - alert: DNSAuditSPFError
        expr: |
          count_over_time({namespace="dns-audit"} | json | level="error" | type="spf" [1h]) > 0
        for: 0m
        labels:
          severity: critical
        annotations:
          summary: "SPF record error detected"
          description: "SPF record validation failed. This may cause email delivery issues."
      - alert: DNSAuditDMARCError
        expr: |
          count_over_time({namespace="dns-audit"} | json | level="error" | type="dmarc" [1h]) > 0
        for: 0m
        labels:
          severity: critical
        annotations:
          summary: "DMARC record error detected"
          description: "DMARC record validation failed. Domain is vulnerable to email spoofing."
      - alert: DNSAuditDMARCPolicyNone
        expr: |
          count_over_time({namespace="dns-audit"} | json | level="warning" | type="dmarc" | policy="none" [1h]) > 0
        for: 0m
        labels:
          severity: warning
        annotations:
          summary: "DMARC policy is set to none"
          description: "DMARC policy is in monitoring mode (p=none). Consider upgrading to p=quarantine or p=reject for full protection."
      - alert: DNSAuditWarnings
        expr: |
          sum(count_over_time({namespace="dns-audit"} | json | level="warning" [1h])) > 5
        for: 0m
        labels:
          severity: warning
        annotations:
          summary: "DNS audit found multiple warnings"
          description: "DNS audit detected {{ "{{" }} $value {{ "}}" }} warnings. Review dns-audit logs for details."
`;

// Loki alerting rules for Home Assistant logs
// Note: Go template syntax escaped for Helm compatibility ({{ "{{" }} ... {{ "}}" }})
const lokiAlertRules = `
groups:
  - name: homeassistant-logs
    rules:
      - alert: HomeAssistantErrorLogs
        expr: |
          sum by (app) (
            count_over_time({app="homeassistant"} |~ "(?i)(error|exception|failed|failure)" [5m])
          ) > 10
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Home Assistant error logs detected"
          description: "Home Assistant has logged {{ "{{" }} $value {{ "}}" }} errors in the last 5 minutes."
          runbook_url: "https://grafana.tailnet-1a49.ts.net/explore?schemaVersion=1&panes=%7B%22v1d%22:%7B%22datasource%22:%22loki%22,%22queries%22:%5B%7B%22refId%22:%22A%22,%22expr%22:%22%7Bapp%3D%5C%22homeassistant%5C%22%7D%20%7C~%20%5C%22(?i)(error%7Cexception%7Cfailed%7Cfailure)%5C%22%22%7D%5D%7D%7D"
      - alert: HomeAssistantWarningLogs
        expr: |
          sum by (app) (
            count_over_time({app="homeassistant"} |~ "(?i)warning" [5m])
          ) > 50
        for: 10m
        labels:
          severity: info
        annotations:
          summary: "Home Assistant warning logs elevated"
          description: "Home Assistant has logged {{ "{{" }} $value {{ "}}" }} warnings in the last 5 minutes."
      - alert: HomeAssistantIntegrationFailed
        expr: |
          count_over_time({app="homeassistant"} |~ "(?i)(setup failed|integration .* failed|unable to set up)" [10m]) > 0
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Home Assistant integration setup failed"
          description: "A Home Assistant integration failed to set up. Check logs for details."
          runbook_url: "https://grafana.tailnet-1a49.ts.net/explore?schemaVersion=1&panes=%7B%22v1d%22:%7B%22datasource%22:%22loki%22,%22queries%22:%5B%7B%22refId%22:%22A%22,%22expr%22:%22%7Bapp%3D%5C%22homeassistant%5C%22%7D%20%7C~%20%5C%22(?i)(setup%20failed%7Cintegration%20.*%20failed%7Cunable%20to%20set%20up)%5C%22%22%7D%5D%7D%7D"
`;

export function createLokiApp(chart: Chart) {
  createIngress(chart, "loki-ingress", "loki", "loki", 3100, ["loki"], false);

  // Create ConfigMap for Loki alert rules
  const rulesConfigMap = new ConfigMap(chart, "loki-alert-rules", {
    metadata: {
      name: "loki-alert-rules",
      namespace: "loki",
    },
    data: {
      "homeassistant-rules.yaml": lokiAlertRules,
      "kubernetes-events-rules.yaml": kubernetesEventsAlertRules,
      "dns-audit-rules.yaml": dnsAuditAlertRules,
    },
  });

  const lokiValues: HelmValuesForChart<"loki"> = {
    deploymentMode: "SingleBinary",
    singleBinary: {
      replicas: 1,
      resources: {
        requests: {
          cpu: "250m",
          memory: "2Gi",
        },
        limits: {
          memory: "4Gi",
        },
      },
      persistence: {
        storageClass: NVME_STORAGE_CLASS,
        size: Size.gibibytes(64).asString(),
        labels: {
          "velero.io/backup": "enabled",
        },
      },
      extraVolumes: [
        {
          name: "alert-rules",
          configMap: {
            name: rulesConfigMap.name,
          },
        },
      ],
      extraVolumeMounts: [
        {
          name: "alert-rules",
          mountPath: "/etc/loki/rules/fake", // 'fake' is the tenant name when auth is disabled
          readOnly: true,
        },
      ],
    },
    // Disable scalable targets - they require object storage
    read: { replicas: 0 },
    write: { replicas: 0 },
    backend: { replicas: 0 },
    loki: {
      commonConfig: {
        replication_factor: 1,
      },
      auth_enabled: false,
      pattern_ingester: {
        enabled: true,
      },
      limits_config: {
        retention_period: "30d",
        allow_structured_metadata: true, // Required for OTLP ingestion
      },
      storage: {
        type: "filesystem",
      },
      schemaConfig: {
        configs: [
          {
            from: "2025-01-01",
            object_store: "filesystem",
            store: "tsdb",
            schema: "v13",
            index: {
              prefix: "index_",
              period: "24h",
            },
          },
        ],
      },
      // Ruler configuration for alerting (structuredConfig merges with templated config)
      structuredConfig: {
        ruler: {
          alertmanager_url:
            "http://prometheus-kube-prometheus-alertmanager.prometheus:9093",
          enable_api: true,
          enable_alertmanager_v2: true,
          storage: {
            type: "local",
            local: {
              directory: "/etc/loki/rules",
            },
          },
        },
      },
    },
    // Enable ruler component
    ruler: {
      enabled: true,
      directories: {
        fake: "/etc/loki/rules/fake", // 'fake' is the tenant name when auth is disabled
      },
    },
    minio: {
      enabled: false,
    },
  };

  return new Application(chart, "loki-app", {
    metadata: {
      name: "loki",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        // https://github.com/grafana/loki/tree/main/production/helm/loki
        repoUrl: "https://grafana.github.io/helm-charts",
        targetRevision: versions.loki,
        chart: "loki",
        helm: {
          valuesObject: lokiValues,
        },
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "loki",
      },
      syncPolicy: {
        automated: {},
        syncOptions: ["CreateNamespace=true", "ServerSideApply=true"],
      },
    },
  });
}
