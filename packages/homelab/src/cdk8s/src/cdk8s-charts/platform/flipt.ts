import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { Namespace } from "cdk8s-plus-31";
import { KubeNetworkPolicy } from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import {
  createFliptDeployment,
  FLIPT_PORT,
} from "@shepherdjerred/homelab/cdk8s/src/resources/flipt/index.ts";
import {
  dnsEgressRule,
  nsPeer,
  tcp,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";

/**
 * Namespaces allowed to evaluate flags.
 *
 * These namespaces consume the explicitly unauthenticated evaluation surface.
 * Flipt management remains authenticated even from an allowed namespace.
 */
const CONSUMER_NAMESPACES = [
  "arcade",
  "delivery",
  "starlight-karma-bot-beta",
  "starlight-karma-bot-prod",
  "scout-beta",
  "scout-prod",
  "birmel",
  "temporal",
  "trmnl-dashboard",
  // The ops dashboard reads its incident-mail settings from Flipt.
  "alert-dashboard",
  // streambot is deployed inside the `media` chart, not its own namespace.
  "media",
  // The Woodpecker maintenance worker runs the shared temporal-worker image
  // (component: maintenance-worker) but lives in the `woodpecker-ci`
  // namespace, not `temporal` — it needs its own entry here or its
  // temporal-call-graph-tracing check silently degrades to the default false.
  // storm-brain reads the storm namespace flags (conversation and model).
  "storm-brain",
  "storm-forum",
  "storm-forum-beta",
  "minecraft-tsmc",
  "woodpecker-ci",
  "woodpecker",
  // Tracker reads its managed flags through the shared config source.
  "tracker",
] as const;

export function createFliptChart(app: App) {
  const chart = new Chart(app, "flipt", {
    namespace: "flipt",
    disableResourceNameHashes: true,
  });

  new Namespace(chart, "flipt-namespace", {
    metadata: { name: "flipt" },
  });

  createFliptDeployment(chart);

  // Network policy limits the authenticated gateway's callers. Tailscale
  // reaches the Basic-authenticated UI, Prometheus scrapes the explicitly
  // public metrics route, and consumers can only use the evaluation routes
  // that the gateway and Flipt both exempt from authentication.
  new KubeNetworkPolicy(chart, "flipt-ingress-netpol", {
    metadata: { name: "flipt-ingress-netpol" },
    spec: {
      podSelector: {},
      policyTypes: ["Ingress"],
      ingress: [
        {
          from: [
            nsPeer("tailscale"),
            nsPeer("prometheus"),
            // Consumer namespaces. Each service is added here as it adopts
            // flags; native authentication separately protects management.
            ...CONSUMER_NAMESPACES.map((namespace) => nsPeer(namespace)),
          ],
          ports: [tcp(FLIPT_PORT)],
        },
      ],
    },
  });

  // DNS only. Storage is a local git repo on the PVC, there is no remote sync,
  // and both the update check and telemetry are disabled in the config — so
  // Flipt has no legitimate reason to reach the internet at all.
  new KubeNetworkPolicy(chart, "flipt-egress-netpol", {
    metadata: { name: "flipt-egress-netpol" },
    spec: {
      podSelector: {},
      policyTypes: ["Egress"],
      egress: [dnsEgressRule()],
    },
  });
}
