import type { Chart } from "cdk8s";
import { tailnetService } from "homelab/src/platform-model.ts";
import { Size } from "cdk8s";
import { IntOrString } from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import {
  blackboxProbeIngressRule,
  dnsEgressRule,
  publicAddressPeer,
  tailscaleIngressRule,
  tcp,
  udp,
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
    tailscale: { host: tailnetService("syncthing") },
    policies: [
      {
        // Allow ingress from Tailscale only
        name: "syncthing-ingress-netpol",
        selects: "namespace",
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
        selects: "namespace",
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
              // STUN, which Syncthing uses by default to learn its public
              // address for QUIC hole punching. Its UPnP and NAT-PMP port
              // mapping (UDP 1900 and 5351) stays denied: a pod cannot map a
              // port on the home router.
              udp(3478, 3479),
            ],
          },
          // Direct sync with remote peers on whatever port they advertise.
          // A peer behind a router port-forward or NAT-PMP mapping announces
          // its public address on an arbitrary TCP/UDP port (not 22000), and
          // a denied dial silently falls back to a slower public relay. The
          // ports are unenumerable, so this admits every port but only to
          // public addresses; private and CGNAT ranges stay limited to the
          // Syncthing ports above.
          {
            to: [publicAddressPeer()],
            ports: [{ protocol: "TCP" }, { protocol: "UDP" }],
          },
        ],
      },
    ],
  });
}
