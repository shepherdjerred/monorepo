import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { NVME_STORAGE_CLASS } from "@shepherdjerred/homelab/cdk8s/src/misc/storage/storage-classes.ts";
import type { HelmValuesForChart } from "@shepherdjerred/homelab/cdk8s/src/misc/typed-helm-parameters.ts";
import { escapeHelmGoTemplate } from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/monitoring/rules/shared.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";

const MAX_TRACE_BYTES = 50_000_000;

/**
 * Creates Grafana Tempo for distributed tracing.
 * Receives traces over the OTLP protocol.
 * Deployed in SingleBinary mode suitable for homelab scale.
 */
export function createTempoApp(chart: Chart) {
  const monitoringAuth = new OnePasswordItem(
    chart,
    "tempo-monitoring-auth-onepassword",
    {
      metadata: { name: "tempo-monitoring-api-auth", namespace: "tempo" },
      spec: { itemPath: vaultItemPath("gnx5xq5rrsdlncvajjc4i577gm") },
    },
  );

  // Tempo values - SingleBinary mode with OTLP receiver enabled
  const tempoValues: HelmValuesForChart<"tempo"> = {
    // This chart exposes distributor settings through its configuration template.
    // Keep attributes whole within the existing trace cap: Tempo's default 2KiB
    // truncation cuts JSON messages and vectors into invalid, incomplete bodies.
    config: escapeHelmGoTemplate(`
memberlist:
  cluster_label: "{{ .Release.Name }}.{{ .Release.Namespace }}"
multitenancy_enabled: {{ .Values.tempo.multitenancyEnabled }}
usage_report:
  reporting_enabled: {{ .Values.tempo.reportingEnabled }}
compactor:
  compaction:
    block_retention: {{ .Values.tempo.retention }}
distributor:
  max_attribute_bytes: ${MAX_TRACE_BYTES.toString()}
  receivers:
    {{- toYaml .Values.tempo.receivers | nindent 4 }}
ingester:
  {{- toYaml .Values.tempo.ingester | nindent 2 }}
server:
  {{- toYaml .Values.tempo.server | nindent 2 }}
storage:
  {{- toYaml .Values.tempo.storage | nindent 2 }}
querier:
  {{- toYaml .Values.tempo.querier | nindent 2 }}
query_frontend:
  {{- toYaml .Values.tempo.queryFrontend | nindent 2 }}
overrides:
  {{- toYaml .Values.tempo.overrides | nindent 2 }}
{{- if .Values.tempo.metricsGenerator.enabled }}
metrics_generator:
  processor:
    {{- toYaml .Values.tempo.metricsGenerator.processor | nindent 4 }}
  {{- if .Values.tempo.metricsGenerator.registry }}
  registry:
    {{- toYaml .Values.tempo.metricsGenerator.registry | nindent 4 }}
  {{- end }}
  storage:
    path: {{ .Values.tempo.metricsGenerator.storage.path | quote }}
    remote_write:
      {{- if .Values.tempo.metricsGenerator.storage.remote_write }}
      {{- toYaml .Values.tempo.metricsGenerator.storage.remote_write | nindent 6 }}
      {{- else }}
      - url: {{ .Values.tempo.metricsGenerator.remoteWriteUrl }}
      {{- end }}
  traces_storage:
    path: {{ .Values.tempo.metricsGenerator.traces_storage.path | quote }}
{{- end }}
`),
    tempo: {
      // Enable OTLP receivers for trace ingestion
      receivers: {
        otlp: {
          protocols: {
            grpc: {
              endpoint: "0.0.0.0:4317",
            },
            http: {
              endpoint: "0.0.0.0:4318",
            },
          },
        },
      },
      // Retention configuration
      retention: "720h", // 30 days of traces
      // Some traces (the old CI's Dagger pipelines especially) get very large;
      // Tempo defaults to 5MB and refuses traces that exceed it with
      // TRACE_TOO_LARGE, so the limit is raised.
      overrides: {
        defaults: {
          global: {
            max_bytes_per_trace: MAX_TRACE_BYTES, // 50MB
          },
          // Per-tenant list of metrics-generator processors to run. Without this
          // the generator pod runs but processes nothing — required for the
          // generator to populate its hash ring with actual work to do.
          metrics_generator: {
            processors: ["service-graphs", "span-metrics", "local-blocks"],
          },
        },
      },
      // Metrics-generator derives Prometheus metrics from spans (service graph,
      // span metrics) and serves TraceQL `rate()` / `quantile_over_time()`
      // queries used by Grafana's Service Graph and Traces panel. Without this
      // block, those queries fail with `error finding generators: empty ring`.
      metricsGenerator: {
        enabled: true,
        remoteWriteUrl:
          "http://prometheus-kube-prometheus-prometheus.prometheus:9090/api/v1/write",
        processor: {
          service_graphs: {},
          span_metrics: {},
          local_blocks: { filter_server_spans: false },
        },
        // Reuse the same PVC mounted at /var/tempo so the generator WAL
        // survives pod restarts.
        storage: {
          path: "/var/tempo/metrics-generator",
          remote_write: [
            {
              url: "http://prometheus-kube-prometheus-prometheus.prometheus:9090/api/v1/write",
              authorization: {
                type: "Bearer",
                credentials_file:
                  "/etc/tempo/secrets/monitoring-api-auth/prometheus-write-token",
              },
            },
          ],
        },
        traces_storage: {
          path: "/var/tempo/metrics-generator-traces",
        },
      },
      // Reserve the baseline and allow bounded compaction/query bursts.
      resources: {
        requests: {
          cpu: "1",
          memory: "1Gi",
        },
        limits: { memory: "4Gi" },
      },
      extraVolumeMounts: [
        {
          name: "monitoring-api-auth",
          mountPath: "/etc/tempo/secrets/monitoring-api-auth",
          readOnly: true,
        },
      ],
    },
    // Persistence configuration
    persistence: {
      enabled: true,
      storageClassName: NVME_STORAGE_CLASS,
      size: Size.gibibytes(64).asString(),
      labels: {
        "velero.io/backup": "disabled",
        "velero.io/exclude-from-backup": "true",
      },
    },
    // Expose OTLP ports via service
    service: {
      type: "ClusterIP",
    },
    extraVolumes: [
      {
        name: "monitoring-api-auth",
        secret: { secretName: monitoringAuth.name },
      },
    ],
  };

  return new Application(chart, "tempo-app", {
    metadata: {
      name: "tempo",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        // https://github.com/grafana/helm-charts/tree/main/charts/tempo
        repoUrl: "https://grafana.github.io/helm-charts",
        targetRevision: versions.tempo,
        chart: "tempo",
        helm: {
          valuesObject: tempoValues,
        },
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "tempo",
      },
      // StatefulSet volume-claim templates are immutable after creation.
      // Kubernetes copies API-defaulted fields (volumeMode, status) into the
      // live template, and the chart's PVC labels never land on that field.
      // Changing Tempo's pod resources (main 16061) re-rendered the
      // Application and the apply-safety preflight refused the sync even
      // though size, storage class, and access modes were unchanged. Ignore
      // the whole field like Loki and Pyroscope. PVC backup labels on created
      // claims are enforced by cluster admission, not this comparison.
      ignoreDifferences: [
        {
          group: "apps",
          kind: "StatefulSet",
          name: "tempo",
          namespace: "tempo",
          jsonPointers: ["/spec/volumeClaimTemplates"],
        },
      ],
      syncPolicy: {
        // selfHeal (velero/seaweedfs precedent): without it, automated sync
        // runs once per revision, so a renderer change under a fixed chart
        // revision strands the app OutOfSync forever. Exactly that happened
        // 2026-08-23: the ArgoCD 10.4.0 bump swapped bundled Helm 3→4, Helm 4
        // drops null-valued default keys during coalesce, and tempo's chart
        // declares `opencensus:` (null) in its default receivers — the desired
        // ConfigMap render changed under 1.24.4 and nothing ever re-converged
        // it, pinning the root app at Progressing.
        automated: { enabled: true, selfHeal: true },
        syncOptions: [
          "CreateNamespace=true",
          "ServerSideApply=true",
          "RespectIgnoreDifferences=true",
        ],
      },
    },
  });
}
