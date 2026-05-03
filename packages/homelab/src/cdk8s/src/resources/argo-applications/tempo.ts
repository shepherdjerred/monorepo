import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { NVME_STORAGE_CLASS } from "@shepherdjerred/homelab/cdk8s/src/misc/storage-classes.ts";

/**
 * Creates Grafana Tempo for distributed tracing.
 * Receives traces from Dagger via OTLP protocol.
 * Deployed in SingleBinary mode suitable for homelab scale.
 */
export function createTempoApp(chart: Chart) {
  // Tempo values - SingleBinary mode with OTLP receiver enabled
  // Dagger will send traces directly to Tempo's OTLP endpoint
  const tempoValues = {
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
      // Dagger traces can get very large; Tempo defaults to 5MB and will refuse
      // traces that exceed it with TRACE_TOO_LARGE. Increase the limit so we
      // ingest complete Dagger pipelines.
      overrides: {
        defaults: {
          global: {
            max_bytes_per_trace: 50_000_000, // 50MB
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
          "http://prometheus-operated.prometheus:9090/api/v1/write",
        processor: {
          service_graphs: {},
          span_metrics: {},
          local_blocks: { filter_server_spans: false },
        },
        // Reuse the same PVC mounted at /var/tempo so the generator WAL
        // survives pod restarts.
        storage: {
          path: "/var/tempo/metrics-generator",
        },
        traces_storage: {
          path: "/var/tempo/metrics-generator-traces",
        },
      },
    },
    // Persistence configuration
    persistence: {
      enabled: true,
      storageClassName: NVME_STORAGE_CLASS,
      size: Size.gibibytes(64).asString(),
      labels: {
        "velero.io/backup": "enabled",
      },
    },
    // Expose OTLP ports via service
    service: {
      type: "ClusterIP",
    },
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
      syncPolicy: {
        automated: {},
        syncOptions: ["CreateNamespace=true", "Replace=true"],
      },
    },
  });
}
