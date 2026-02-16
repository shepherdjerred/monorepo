import { Chart, Size } from "cdk8s";
import { Application } from "../../../generated/imports/argoproj.io.ts";
import versions from "../../versions.ts";
import { NVME_STORAGE_CLASS } from "../../misc/storage-classes.ts";

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
      retention: "168h", // 7 days of traces
      // Dagger traces can get very large; Tempo defaults to 5MB and will refuse
      // traces that exceed it with TRACE_TOO_LARGE. Increase the limit so we
      // ingest complete Dagger pipelines.
      overrides: {
        defaults: {
          global: {
            max_bytes_per_trace: 50_000_000, // 50MB
          },
        },
      },
    },
    // Persistence configuration
    persistence: {
      enabled: true,
      storageClassName: NVME_STORAGE_CLASS,
      size: Size.gibibytes(32).asString(),
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
        syncOptions: ["CreateNamespace=true"],
      },
    },
  });
}
