import type { Chart } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";
import { Namespace } from "cdk8s-plus-31";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import type { HelmValuesForChart } from "@shepherdjerred/homelab/cdk8s/src/misc/typed-helm-parameters.ts";

// Grafana Alloy River config: receive OTLP/HTTP from every in-cluster trace
// producer and forward all spans to Tempo. This is the fan-out point for
// additional trace consumers (Braintrust arrives in a later phase as a
// tail-sampled branch off the receiver output); producers only ever know the
// gateway URL.
//
// Every producer in the repo speaks OTLP/HTTP on 4318 (several POST OTLP JSON
// via plain fetch, which the receiver also accepts) — no gRPC receiver until a
// gRPC producer exists. Tempo permits 50MB traces (max_bytes_per_trace), so
// the per-request cap must never be the smaller limit; the otelcol default of
// 20MiB is too low.
const ALLOY_GATEWAY_CONFIG = `
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
`;

/**
 * Grafana Alloy as an unprivileged OTLP trace gateway Deployment.
 *
 * This is a second Alloy release, deliberately separate from the `alloy` app:
 * that one is a privileged hostPID eBPF profiling DaemonSet whose security
 * boundary is "no ingress, pushes only to Pyroscope". A trace gateway needs
 * the opposite shape — network ingress, external egress (later phases), no
 * host access — so it gets its own namespace, Deployment, and Service instead
 * of widening the profiler's boundary. Both releases share the `versions.alloy`
 * chart pin and move together on chart bumps.
 */
export function createAlloyGatewayApp(chart: Chart) {
  // Explicit Namespace (root-chart sync wave 0) rather than relying only on
  // CreateNamespace=true: a later phase adds a OnePasswordItem into this
  // namespace, and root-chart 1Password items apply at wave -19 — before any
  // Application could create the namespace. Shipping the namespace one release
  // ahead keeps that ordering safe. Default (baseline) Pod Security applies;
  // nothing here is privileged.
  new Namespace(chart, "alloy-gateway-namespace", {
    metadata: {
      name: "alloy-gateway",
    },
  });

  const alloyGatewayValues: HelmValuesForChart<"alloy"> = {
    // Deterministic resource/Service names regardless of helm fullname logic:
    // producers address http://alloy-gateway.alloy-gateway.svc.cluster.local:4318.
    fullnameOverride: "alloy-gateway",
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
      // The chart's Service publishes every entry listed here alongside the
      // built-in 12345 http port.
      extraPorts: [
        {
          name: "otlp-http",
          port: 4318,
          targetPort: 4318,
          protocol: "TCP",
        },
      ],
      // Steady-state passthrough is cheap; revisit after tail sampling lands
      // (it buffers decision_wait's worth of spans in memory). Requests only,
      // no limits, per repo convention.
      resources: {
        requests: {
          cpu: "100m",
          memory: "256Mi",
        },
      },
    },
    // otelcol_* receiver/exporter metrics feed the byte-budget and failure
    // checks for the Braintrust branch.
    serviceMonitor: {
      enabled: true,
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
