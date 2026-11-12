import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import { IntOrString } from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import {
  blackboxProbeIngressRule,
  dnsEgressRule,
  tailscaleIngressRule,
  tcp,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";
import { LinuxServerApp } from "@shepherdjerred/homelab/cdk8s/src/misc/third-party/linuxserver-app.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

const GUI_PORT = 8384;

export function createSyncthingDeployment(chart: Chart) {
  new LinuxServerApp(chart, "syncthing-app", {
    name: "syncthing",
    image: `ghcr.io/linuxserver/syncthing:${versions["linuxserver/syncthing"]}`,
    port: GUI_PORT,
    fsGroup: true,
    claims: [
      {
        claim: "syncthing-config",
        volumeId: "syncthing-volume",
        storage: Size.gibibytes(8),
        path: "/config",
      },
      {
        claim: "syncthing-data",
        volumeId: "syncthing-data-volume",
        storage: Size.gibibytes(256),
        path: "/sync",
      },
    ],
    // Deliberately BestEffort (no requests/limits) — negligible or
    // non-critical usage; see the 2026-06-12 right-sizing plan.
    resources: {},
    tailscale: { host: "syncthing" },
    policies: [
      {
        // Allow ingress from Tailscale only
        name: "syncthing-ingress-netpol",
        ingress: [
          tailscaleIngressRule(),
          // Allow blackbox-exporter's in-cluster health probe (GUI service port
          // only — not every port on the pod)
          blackboxProbeIngressRule(GUI_PORT),
        ],
      },
      {
        // Allow egress to DNS and Syncthing protocols
        name: "syncthing-egress-netpol",
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
    ],
  });
}
