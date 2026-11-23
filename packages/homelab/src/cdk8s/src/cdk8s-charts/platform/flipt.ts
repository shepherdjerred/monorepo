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

export function createFliptChart(app: App) {
  const chart = new Chart(app, "flipt", {
    namespace: "flipt",
    disableResourceNameHashes: true,
  });

  new Namespace(chart, "flipt-namespace", {
    metadata: { name: "flipt" },
  });

  createFliptDeployment(chart);

  // Current flag consumers evaluate against first-party `flags`. While Flipt
  // stays deployed ahead of retirement, Tailscale and Prometheus reach its
  // gateway, and so do the retained Temporal workflow hosts
  // (`delivery-wf-retained-*`), whose pinned builds predate the Flipt-to-Flags
  // cutover (#4948). The retained-host rule goes when Flipt retires (#4969,
  // FM-59).
  new KubeNetworkPolicy(chart, "flipt-ingress-netpol", {
    metadata: { name: "flipt-ingress-netpol" },
    spec: {
      podSelector: {},
      policyTypes: ["Ingress"],
      ingress: [
        {
          from: [nsPeer("tailscale"), nsPeer("prometheus")],
          ports: [tcp(FLIPT_PORT)],
        },
        {
          from: [
            {
              ...nsPeer("temporal"),
              podSelector: {
                matchLabels: { "worker-family": "central-workflows" },
              },
            },
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

  // Flipt alone stays open until the namespace is retired: enforcing it
  // dropped callers whose Delivery releases still pointed here. This
  // allow-all overrides the two policies above. It keeps the name it had as
  // the namespace's enforcement staging policy, so the live object is updated
  // in place rather than replaced.
  new KubeNetworkPolicy(chart, "enforcement-staging-flipt", {
    metadata: {
      name: "enforcement-staging-flipt",
      annotations: {
        "homelab.sjer.red/description":
          "Allows all traffic for every Flipt pod until the namespace is retired.",
      },
    },
    spec: {
      podSelector: {},
      policyTypes: ["Ingress", "Egress"],
      ingress: [{}],
      egress: [{}],
    },
  });
}
