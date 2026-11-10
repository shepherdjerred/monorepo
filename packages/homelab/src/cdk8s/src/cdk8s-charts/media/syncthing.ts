import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import {
  KubeNetworkPolicy,
  IntOrString,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { createSyncthingDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/syncthing.ts";
import {
  dnsEgressRule,
  tcp,
  tailscaleIngressRule,
  blackboxProbeIngressRule,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";

export function createSyncthingChart(app: App) {
  const chart = new Chart(app, "syncthing", {
    namespace: "syncthing",
    disableResourceNameHashes: true,
  });

  createSyncthingDeployment(chart);

  // NetworkPolicy: Allow ingress from Tailscale only
  new KubeNetworkPolicy(chart, "syncthing-ingress-netpol", {
    metadata: { name: "syncthing-ingress-netpol" },
    spec: {
      podSelector: {},
      policyTypes: ["Ingress"],
      ingress: [
        tailscaleIngressRule(),
        // Allow blackbox-exporter's in-cluster health probe (GUI service port
        // only — not every port on the pod)
        blackboxProbeIngressRule(8384),
      ],
    },
  });

  // NetworkPolicy: Allow egress to DNS and Syncthing protocols
  new KubeNetworkPolicy(chart, "syncthing-egress-netpol", {
    metadata: { name: "syncthing-egress-netpol" },
    spec: {
      podSelector: {},
      policyTypes: ["Egress"],
      egress: [
        // DNS
        dnsEgressRule(),
        // Syncthing protocols + global discovery/relay servers
        {
          to: [{ ipBlock: { cidr: "0.0.0.0/0" } }],
          ports: [
            tcp(22_000), // BEP sync
            { port: IntOrString.fromNumber(22_000), protocol: "UDP" }, // QUIC sync
            { port: IntOrString.fromNumber(21_027), protocol: "UDP" }, // Local discovery
            tcp(443), // Global discovery + relay pool lookup
            // Relay data connection. torvalds accepts no inbound sync connections
            // (only the 8384 GUI is exposed), so peers behind symmetric NAT — with
            // no directly-dialable address of their own — can only meet it on a
            // relay. Public relays (strelaysrv) listen on 22067; without this,
            // relaying silently fails and those peers never connect. See
            // the original investigation.
            tcp(22_067), // Relay data connection
          ],
        },
      ],
    },
  });
}
