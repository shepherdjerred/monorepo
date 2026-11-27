import type { Chart } from "cdk8s";
import { tailnetService } from "homelab/src/platform-model.ts";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { Namespace } from "cdk8s-plus-31";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { createIngress } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";
import type { HelmValuesForChart } from "@shepherdjerred/homelab/cdk8s/src/misc/typed-helm-parameters.ts";
import { helmApplication } from "@shepherdjerred/homelab/cdk8s/src/misc/argo/application.ts";

// OTTL conditions embed as River strings, so their inner quotes need escaping.
function riverString(value: string): string {
  return `"${value
    .replaceAll("\\", String.raw`\\`)
    .replaceAll('"', String.raw`\"`)}"`;
}

/** OTLP/HTTP metrics port published on the tailnet as `otlp-metrics`. */
export const TAILNET_METRICS_PORT = 4319;

/**
 * Metric-name prefixes the tailnet receiver admits. The toolkit history
 * daemon on Jerred's Mac pushes AI usage and subscription quota. Justin's
 * runner metrics use an exact allowlist on the same metrics-only route.
 */
export const TAILNET_METRIC_NAME_PATTERN = "^(ai_usage_|ai_subscription_)";
export const JUSTIN_METRIC_NAMES = [
  "justin_reconcile_last_started_timestamp_seconds",
  "justin_reconcile_last_success_timestamp_seconds",
  "justin_stage_deadline_timestamp_seconds",
  "justin_consecutive_failures",
  "justin_queue_eligible",
  "justin_open_pull_requests",
  "justin_tasks",
  "justin_oldest_wait_seconds",
  "justin_task_transitions_total",
  "justin_stage_elapsed_seconds_total",
  "justin_stages_total",
  "justin_reconciles_total",
  "justin_codex_tokens_total",
  "justin_passes_total",
] as const;
const justinMetricNamePattern = "^(" + JUSTIN_METRIC_NAMES.join("|") + ")$";

// Metrics-only OTLP/HTTP receiver for workstation pushes arriving over the
// Tailscale ingress. It is a separate receiver on its own port so the tailnet
// can reach metrics without exposing the trace receiver on 4318, and so a
// tailnet client can never inject spans into Tempo.
//
// The Tailscale ingress is unauthenticated beyond tailnet ACLs, so the filter
// is the allowlist: anything whose name does not match the prefix is dropped
// before it reaches Prometheus. Metric names arrive already in their final
// Prometheus spelling, so suffixes stay off. `service.name` and
// `service.instance.id` map to `job` and `instance` by the exporter itself;
// target_info and scope labels would only add noise series and labels.
const TAILNET_METRICS_CONFIG = `otelcol.receiver.otlp "tailnet_metrics" {
  http {
    endpoint = "0.0.0.0:${String(TAILNET_METRICS_PORT)}"
  }

  output {
    metrics = [otelcol.processor.filter.tailnet_metrics.input]
  }
}

otelcol.processor.filter "tailnet_metrics" {
  metrics {
    metric = [
      ${riverString(`not IsMatch(name, "${TAILNET_METRIC_NAME_PATTERN}") and not (resource.attributes["service.name"] == "justin-principal-engineer" and IsMatch(name, "${justinMetricNamePattern}"))`)},
    ]
  }

  output {
    metrics = [otelcol.processor.batch.tailnet_metrics.input]
  }
}

otelcol.processor.batch "tailnet_metrics" {
  output {
    metrics = [otelcol.exporter.prometheus.tailnet.input]
  }
}

otelcol.exporter.prometheus "tailnet" {
  add_metric_suffixes  = false
  include_target_info  = false
  include_scope_labels = false
  forward_to           = [prometheus.remote_write.cluster.receiver]
}

prometheus.remote_write "cluster" {
  endpoint {
    url = "http://prometheus-kube-prometheus-prometheus.prometheus:9090/api/v1/write"
    authorization {
      type        = "Bearer"
      credentials = sys.env("PROMETHEUS_WRITE_TOKEN")
    }
  }
}`;

// Grafana Alloy River config: stateless OTLP/HTTP trace forwarder for every
// in-cluster trace producer, batching all spans directly into Tempo (where Hub
// `/traces` reads 0–30d full-content trajectories alongside the 365d SeaweedFS
// `llm-archive` index). Producers only ever know the gateway URL.
//
// Every producer in the repo speaks OTLP/HTTP on 4318 (several POST OTLP JSON
// via plain fetch, which the receiver also accepts) — no gRPC receiver until a
// gRPC producer exists. Tempo permits 50MB traces (max_bytes_per_trace), so
// the per-request cap must never be the smaller limit; the otelcol default of
// 20MiB is too low.
export const ALLOY_GATEWAY_CONFIG = `
otelcol.receiver.otlp "gateway" {
  http {
    endpoint = "0.0.0.0:4318"
    max_request_body_size = "64MiB"
  }

  output {
    traces = [otelcol.processor.batch.tempo.input]
  }
}

otelcol.processor.batch "tempo" {
  output {
    traces = [otelcol.exporter.otlphttp.tempo.input]
  }
}

otelcol.exporter.otlphttp "tempo" {
  client {
    endpoint = "http://tempo.tempo.svc.cluster.local:4318"
  }
}

${TAILNET_METRICS_CONFIG}
`;

/**
 * Grafana Alloy as an unprivileged OTLP trace & tailnet metrics gateway Deployment.
 *
 * This is a second Alloy release, deliberately separate from the `alloy` app:
 * that one is a privileged hostPID eBPF profiling DaemonSet whose security
 * boundary is "no ingress, pushes only to Pyroscope". A trace gateway needs
 * the opposite shape — network ingress, egress to Tempo and Prometheus, no
 * host access — so it gets its own namespace, Deployment, and Service instead
 * of widening the profiler's boundary. Both releases share the `versions.alloy`
 * chart pin and move together on chart bumps.
 */
// Explicit Namespace (root-chart sync wave 0) rather than relying only on
// CreateNamespace=true: the OnePasswordItem in the Application applies at
// wave -19 — before any Application could create the namespace — so the
// namespace has to exist independently. Default (baseline) Pod Security
// applies; nothing here is privileged.
export function createAlloyGatewayNamespace(chart: Chart): void {
  new Namespace(chart, "alloy-gateway-namespace", {
    metadata: {
      name: "alloy-gateway",
    },
  });
}

/** Objects the root renders beside the Application; the `alloy-gateway-companion` companion chart renders the same objects under transition rendering. */
export function createAlloyGatewayResources(chart: Chart): OnePasswordItem {
  const monitoringAuth = new OnePasswordItem(
    chart,
    "alloy-gateway-monitoring-auth-1p",
    {
      metadata: {
        name: "alloy-gateway-monitoring-api-auth",
        namespace: "alloy-gateway",
      },
      spec: {
        itemPath: vaultItemPath("gnx5xq5rrsdlncvajjc4i577gm"),
      },
    },
  );

  // Only the metrics port is published on the tailnet; the trace receiver on
  // 4318 stays cluster-internal. The OTLP receiver answers 404/405 on "/",
  // so the probe checks the TCP listener instead.
  createIngress(chart, "alloy-gateway-otlp-metrics-ingress", {
    namespace: "alloy-gateway",
    service: "alloy-gateway",
    port: TAILNET_METRICS_PORT,
    hosts: [tailnetService("otlp-metrics")],
    probeModule: "tcp_connect",
  });
  return monitoringAuth;
}

export function createAlloyGatewayApp(chart: Chart) {
  createAlloyGatewayNamespace(chart);
  const monitoringAuth = createAlloyGatewayResources(chart);

  const alloyGatewayValues: HelmValuesForChart<"alloy"> = {
    // Deterministic resource/Service names regardless of helm fullname logic:
    // producers address http://alloy-gateway.alloy-gateway.svc.cluster.local:4318.
    fullnameOverride: "alloy-gateway",
    // The profiler `alloy` Application already installs this chart's
    // cluster-scoped monitoring CRDs; rendering them from a second Application
    // would make two Argo apps own identical CRD objects.
    crds: {
      create: false,
    },
    // The gateway only receives OTLP and exports onward — it never calls the
    // Kubernetes API, so a network-facing pod gets neither RBAC nor an
    // automounted service-account token to escalate with.
    rbac: {
      create: false,
    },
    serviceAccount: {
      automountServiceAccountToken: false,
    },
    controller: {
      type: "deployment",
      replicas: 1,
    },
    alloy: {
      // All otelcol components used here are general-availability — no
      // stabilityLevel override (the profiler's "experimental" is for
      // pyroscope.ebpf only).
      configMap: {
        content: ALLOY_GATEWAY_CONFIG,
      },
      // sys.env() in the River config reads this. The secret is materialized
      // by the OnePasswordItem above; a missing item fails the pod fast
      // rather than exporting unauthenticated.
      extraEnv: [
        {
          name: "PROMETHEUS_WRITE_TOKEN",
          valueFrom: {
            secretKeyRef: {
              name: monitoringAuth.name,
              key: "prometheus-write-token",
            },
          },
        },
      ],
      // The chart's Service publishes every entry listed here alongside the
      // built-in 12345 http port.
      extraPorts: [
        {
          name: "otlp-http",
          port: 4318,
          targetPort: 4318,
          protocol: "TCP",
        },
        {
          name: "otlp-metrics",
          port: TAILNET_METRICS_PORT,
          targetPort: TAILNET_METRICS_PORT,
          protocol: "TCP",
        },
      ],
      // Stateless OTLP batch forwarding plus tailnet metric filtering.
      // Requests only, no limits, per repo convention — bursts can exceed it.
      resources: {
        requests: {
          cpu: "100m",
          memory: "256Mi",
        },
      },
    },
    // otelcol_* receiver/exporter metrics feed Tempo & Prometheus delivery
    // checks. Prometheus only discovers ServiceMonitors carrying
    // release: prometheus (same convention createServiceMonitor enforces).
    serviceMonitor: {
      enabled: true,
      additionalLabels: {
        release: "prometheus",
      },
    },
  };

  return helmApplication(chart, {
    name: "alloy-gateway",
    namespace: "alloy-gateway",
    chart: "alloy",
    // https://github.com/grafana/alloy/tree/main/operations/helm/charts/alloy
    repoUrl: "https://grafana.github.io/helm-charts",
    targetRevision: versions.alloy,
    valuesObject: alloyGatewayValues,
    syncPolicy: {
      // selfHeal per the tempo.ts precedent: renderer/Helm-version drift
      // under a fixed chart revision must re-converge without operator action.
      automated: { enabled: true, selfHeal: true },
      syncOptions: ["CreateNamespace=true", "ServerSideApply=true"],
    },
  });
}
