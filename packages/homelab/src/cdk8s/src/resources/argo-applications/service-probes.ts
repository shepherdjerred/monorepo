import type { Chart } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";

// Delivers the "service-probes" cdk8s chart (resources/monitoring/
// service-probes-chart.ts): the blackbox Probe CRs auto-registered for every
// TailscaleIngress/createIngress/createCloudflareTunnelBinding service. The
// chart existed since #1505 but was never wired to an Application, so the
// probe-* fleet never reached the cluster and ServiceProbeAbsent fired.
// Probes live in the prometheus namespace alongside blackbox-exporter.
export function createServiceProbesApp(chart: Chart) {
  return new Application(chart, "service-probes-app", {
    metadata: {
      name: "service-probes",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        repoUrl: "https://chartmuseum.tailnet-1a49.ts.net",
        targetRevision: "~2.0.0-0",
        chart: "service-probes",
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "prometheus",
      },
      syncPolicy: {
        // prune is generally avoided across this repo's Applications: it lets ArgoCD delete anything that
        // falls out of the render, so a codegen bug could cascade into deleting live workloads or stateful
        // resources. It is safe and correct HERE because this Application manages only derived, stateless
        // Probe CRs regenerated from the service registry — the worst a prune can do is delete a probe, and a
        // stale Probe is actively harmful: it keeps probing a deregistered service, adding alert noise or
        // masking ServiceProbeAbsent (the exact failure this PR fixes).
        automated: { prune: true },
      },
    },
  });
}
