import type { Chart } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { Namespace } from "cdk8s-plus-31";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { createIngress } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";
import type { HelmValuesForChart } from "@shepherdjerred/homelab/cdk8s/src/misc/typed-helm-parameters.ts";

// Phoenix ingests whole LLM traces per project; the project is selected by
// the x-project-name header on the exporter, and projects are created
// implicitly on first write — a typo here silently creates a stray project.
//
// Routing is an explicit allowlist: each branch's filter processor DROPS every
// span matching one of its `drop` conditions, so a branch's conditions are the
// negation of "this span belongs to the project". A service listed nowhere
// reaches no project by construction — that exclusion bounds Phoenix's
// database growth, so there must never be a catch-all branch.
type PhoenixBranch = {
  // Exact Phoenix project name.
  project: string;
  // River component suffix; must be a valid River identifier (no hyphens).
  river: string;
  // OTTL span conditions (filter processor drops on ANY match). Equality
  // against a nil service.name is simply false — safe. IsMatch on nil ERRORS,
  // and error_mode=ignore skips only the erroring condition, which would leak
  // the span into the project — any IsMatch use needs a `== nil` drop guard
  // listed first.
  drop: string[];
};

const SERVICE_NAME = 'resource.attributes["service.name"]';

// otlphttp appends /v1/traces. Its default encoding is protobuf, which is the
// only body Phoenix's OTLP route accepts (JSON gets a 415) — keep it, even
// though several producers POST OTLP JSON to this gateway.
const PHOENIX_ENDPOINT = "http://phoenix.phoenix.svc.cluster.local:6006";
const DEPLOY_ENV = 'resource.attributes["deployment.environment.name"]';

const PHOENIX_BRANCHES: PhoenixBranch[] = [
  {
    project: "scout-beta",
    river: "px_scout_beta",
    drop: [
      `not(${SERVICE_NAME} == "scout-backend" and ${DEPLOY_ENV} == "beta")`,
    ],
  },
  {
    project: "scout-prod",
    river: "px_scout_prod",
    drop: [
      `not(${SERVICE_NAME} == "scout-backend" and ${DEPLOY_ENV} == "prod")`,
    ],
  },
  {
    project: "birmel",
    river: "px_birmel",
    drop: [`${SERVICE_NAME} != "birmel"`],
  },
  {
    project: "temporal",
    river: "px_temporal",
    drop: [
      `${SERVICE_NAME} == nil`,
      `not(IsMatch(${SERVICE_NAME}, "^temporal-"))`,
    ],
  },
  {
    project: "discord-plays",
    river: "px_discord_plays",
    drop: [
      `not(${SERVICE_NAME} == "discord-plays-pokemon" or ${SERVICE_NAME} == "discord-plays-mario-kart")`,
    ],
  },
  {
    project: "misc",
    river: "px_misc",
    drop: [
      `not(${SERVICE_NAME} == "streambot" or ${SERVICE_NAME} == "alert-dashboard")`,
    ],
  },
];

// OTTL conditions embed as River strings, so their inner quotes need escaping.
function riverString(value: string): string {
  return `"${value
    .replaceAll("\\", String.raw`\\`)
    .replaceAll('"', String.raw`\"`)}"`;
}

function renderPhoenixBranch(branch: PhoenixBranch): string {
  const conditions = branch.drop
    .map((condition) => `      ${riverString(condition)},`)
    .join("\n");
  return `otelcol.processor.filter "${branch.river}" {
  error_mode = "ignore"

  traces {
    span = [
${conditions}
    ]
  }

  output {
    traces = [otelcol.exporter.otlphttp.${branch.river}.input]
  }
}

otelcol.exporter.otlphttp "${branch.river}" {
  client {
    endpoint = "${PHOENIX_ENDPOINT}"
    auth     = otelcol.auth.bearer.phoenix.handler
    headers  = {
      "x-project-name" = "${branch.project}",
    }
  }
}`;
}

/** OTLP/HTTP metrics port published on the tailnet as `otlp-metrics`. */
export const TAILNET_METRICS_PORT = 4319;

/**
 * Metric-name prefixes the tailnet receiver admits. The toolkit history
 * daemon on Jerred's Mac pushes AI usage and subscription quota; nothing else
 * may write into cluster Prometheus through this door.
 */
export const TAILNET_METRIC_NAME_PATTERN = "^(ai_usage_|ai_subscription_)";

// Metrics-only OTLP/HTTP receiver for workstation pushes arriving over the
// Tailscale ingress. It is a separate receiver on its own port so the tailnet
// can reach metrics without exposing the trace receiver on 4318, and so a
// tailnet client can never inject spans into Tempo or Phoenix.
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
      ${riverString(`not IsMatch(name, "${TAILNET_METRIC_NAME_PATTERN}")`)},
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
    url = "http://prometheus-operated.prometheus:9090/api/v1/write"
  }
}`;

// Grafana Alloy River config: receive OTLP/HTTP from every in-cluster trace
// producer, forward ALL spans to Tempo unconditionally, and tail-sample whole
// traces containing LLM spans into per-service-stage Phoenix projects.
// Producers only ever know the gateway URL.
//
// Every producer in the repo speaks OTLP/HTTP on 4318 (several POST OTLP JSON
// via plain fetch, which the receiver also accepts) — no gRPC receiver until a
// gRPC producer exists. Tempo permits 50MB traces (max_bytes_per_trace), so
// the per-request cap must never be the smaller limit; the otelcol default of
// 20MiB is too low.
//
// Tail sampling holds a trace for decision_wait before deciding, so Phoenix
// receives whole traces with their root span rather than orphaned LLM
// children — reading the full trajectory is the point. The sampled decision cache forwards spans of
// long agent traces that arrive after the decision immediately;
// non_sampled_cache_size must stay 0 (unset) so "drop" windows are
// re-evaluated when late LLM spans arrive. The kill switch for a runaway
// producer is removing a branch from tail_sampling's output list — the
// config-reloader applies that without recreating the pod.
export const ALLOY_GATEWAY_CONFIG = `
otelcol.receiver.otlp "gateway" {
  http {
    endpoint = "0.0.0.0:4318"
    max_request_body_size = "64MiB"
  }

  output {
    traces = [
      otelcol.processor.batch.tempo.input,
      otelcol.processor.tail_sampling.llm.input,
    ]
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

otelcol.processor.tail_sampling "llm" {
  decision_wait = "120s"

  decision_cache = {
    sampled_cache_size = 100000,
  }

  policy {
    name = "llm-traces"
    type = "ottl_condition"

    ottl_condition {
      error_mode = "ignore"
      span = [
        ${riverString('attributes["gen_ai.system"] != nil')},
        ${riverString('attributes["gen_ai.request.model"] != nil')},
        ${riverString('attributes["gen_ai.operation.name"] != nil')},
      ]
    }
  }

  output {
    traces = [
${PHOENIX_BRANCHES.map(
  (branch) => `      otelcol.processor.filter.${branch.river}.input,`,
).join("\n")}
    ]
  }
}

otelcol.auth.bearer "phoenix" {
  token = sys.env("PHOENIX_API_KEY")
}

${PHOENIX_BRANCHES.map((branch) => renderPhoenixBranch(branch)).join("\n\n")}

${TAILNET_METRICS_CONFIG}
`;

/**
 * Grafana Alloy as an unprivileged OTLP trace gateway Deployment.
 *
 * This is a second Alloy release, deliberately separate from the `alloy` app:
 * that one is a privileged hostPID eBPF profiling DaemonSet whose security
 * boundary is "no ingress, pushes only to Pyroscope". A trace gateway needs
 * the opposite shape — network ingress, egress to Tempo, Phoenix, and
 * Prometheus, no host access — so it gets its own namespace, Deployment, and Service instead
 * of widening the profiler's boundary. Both releases share the `versions.alloy`
 * chart pin and move together on chart bumps.
 */
export function createAlloyGatewayApp(chart: Chart) {
  // Explicit Namespace (root-chart sync wave 0) rather than relying only on
  // CreateNamespace=true: the OnePasswordItem below applies at wave -19 —
  // before any Application could create the namespace — so the namespace has
  // to exist independently (it shipped one release ahead of the item).
  // Default (baseline) Pod Security applies; nothing here is privileged.
  new Namespace(chart, "alloy-gateway-namespace", {
    metadata: {
      name: "alloy-gateway",
    },
  });

  // One Phoenix system API key, shared by every per-project exporter.
  new OnePasswordItem(chart, "alloy-gateway-phoenix-1p", {
    metadata: {
      name: "phoenix-ingest",
      namespace: "alloy-gateway",
    },
    spec: {
      itemPath: vaultItemPath("phoenix-ingest"),
    },
  });

  // Only the metrics port is published on the tailnet; the trace receiver on
  // 4318 stays cluster-internal. The OTLP receiver answers 404/405 on "/",
  // so the probe checks the TCP listener instead.
  createIngress(chart, "alloy-gateway-otlp-metrics-ingress", {
    namespace: "alloy-gateway",
    service: "alloy-gateway",
    port: TAILNET_METRICS_PORT,
    hosts: ["otlp-metrics"],
    probeModule: "tcp_connect",
  });

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
      // Must stay 1 once tail sampling lands: sampling decisions require every
      // span of a trace on the same instance. Scaling out needs a trace-ID-aware
      // otelcol.exporter.loadbalancing tier in front — build that instead of
      // raising this number.
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
          name: "PHOENIX_API_KEY",
          valueFrom: {
            secretKeyRef: {
              name: "phoenix-ingest",
              key: "PHOENIX_API_KEY",
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
      // Tail sampling buffers decision_wait's worth of spans in memory; at
      // homelab span volume that is a few MB, well inside this request.
      // Requests only, no limits, per repo convention — bursts can exceed it.
      resources: {
        requests: {
          cpu: "100m",
          memory: "256Mi",
        },
      },
    },
    // otelcol_* receiver/exporter metrics feed the delivery and failure
    // checks for the Phoenix branches. Prometheus only discovers
    // ServiceMonitors carrying release: prometheus (same convention the shared
    // createServiceMonitor helper enforces).
    serviceMonitor: {
      enabled: true,
      additionalLabels: {
        release: "prometheus",
      },
    },
  };

  return new Application(chart, "alloy-gateway-app", {
    metadata: {
      name: "alloy-gateway",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        // https://github.com/grafana/alloy/tree/main/operations/helm/charts/alloy
        repoUrl: "https://grafana.github.io/helm-charts",
        targetRevision: versions.alloy,
        chart: "alloy",
        helm: {
          valuesObject: alloyGatewayValues,
        },
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "alloy-gateway",
      },
      syncPolicy: {
        // selfHeal per the tempo.ts precedent: renderer/Helm-version drift
        // under a fixed chart revision must re-converge without operator action.
        automated: { enabled: true, selfHeal: true },
        syncOptions: ["CreateNamespace=true", "ServerSideApply=true"],
      },
    },
  });
}
