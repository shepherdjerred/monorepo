import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { createHomeAssistantDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/home/homeassistant.ts";
import { createEufySecurityWsDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/home/eufy-security-ws.ts";
import { createScryptedDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/home/scrypted.ts";
import { createZwaveJsUiDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/home/zwave-js-ui.ts";
import {
  KubeNetworkPolicy,
  IntOrString,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import {
  dnsEgressRule,
  externalHttpsEgressRule,
  nsPeer,
  tcp,
  tailscaleIngressRule,
  cloudflareTunnelIngressRule,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";
import { PROD_NODE_LAN_IP } from "@shepherdjerred/homelab/cdk8s/src/misc/nodes.ts";

export async function createHomeChart(app: App) {
  const chart = new Chart(app, "home", {
    namespace: "home",
    disableResourceNameHashes: true,
  });

  await createHomeAssistantDeployment(chart);
  createEufySecurityWsDeployment(chart);
  createScryptedDeployment(chart);
  createZwaveJsUiDeployment(chart);

  // NetworkPolicy: Allow ingress to home namespace from Tailscale, Cloudflare tunnel, and LAN
  // Note: Home Assistant and Scrypted use hostNetwork, so no NetworkPolicy can
  // select them: they share the node's network namespace and their traffic is
  // node traffic. The CNI is flannel, which enforces no NetworkPolicy today;
  // the planned enforcer, kube-network-policies, does not police hostNetwork
  // pods either. This policy therefore affects only the pod-network pods in
  // the namespace (eufy-security-ws, zwave-js-ui), and the LAN rules below do
  // not restrict the hostNetwork pods.
  new KubeNetworkPolicy(chart, "home-ingress-policy", {
    metadata: { name: "home-ingress-policy" },
    spec: {
      podSelector: {},
      policyTypes: ["Ingress"],
      ingress: [
        // Allow from Tailscale (private access)
        tailscaleIngressRule(),
        // Allow from Cloudflare tunnel (public access)
        cloudflareTunnelIngressRule(),
        // Allow Prometheus scraping from monitoring namespace
        {
          from: [nsPeer("prometheus")],
        },
        // Allow HomeKit from LAN (mDNS discovery + Home Assistant bridge ports).
        // 21063 = HA1, 21064 = HA2 lights. The front-door doorbell accessory
        // (21065) was retired in favor of Scrypted's HomeKit Secure Video.
        {
          from: [{ ipBlock: { cidr: "192.168.1.0/24" } }],
          ports: [
            { port: IntOrString.fromNumber(5353), protocol: "UDP" },
            tcp(21_063),
            tcp(21_064),
          ],
        },
      ],
    },
  });

  // NetworkPolicy: Scrypted's HomeKit plugin allocates accessory HAP ports at
  // runtime, so LAN Home Hubs need access to the Scrypted pod beyond the fixed
  // Home Assistant bridge ports above. Limit the broader LAN allowance to the
  // Scrypted pod only.
  new KubeNetworkPolicy(chart, "scrypted-lan-ingress-policy", {
    metadata: { name: "scrypted-lan-ingress-policy" },
    spec: {
      podSelector: { matchLabels: { app: "scrypted" } },
      policyTypes: ["Ingress"],
      ingress: [
        {
          from: [{ ipBlock: { cidr: "192.168.1.0/24" } }],
        },
      ],
    },
  });

  // NetworkPolicy: Home Assistant's Z-Wave JS and Eufy Security integrations
  // hold websockets to zwave-js-ui and eufy-security-ws on 3000. Home
  // Assistant runs on the host network, so those connections arrive from the
  // node's LAN address, not from a pod. kube-network-policies skips queueing
  // packets from root-owned host sockets, which is what lets them through
  // today; this rule keeps them allowed without depending on the uid Home
  // Assistant runs as, and stops the enforcer's periodic re-evaluation of
  // established connections from flagging them.
  new KubeNetworkPolicy(chart, "home-assistant-websocket-ingress-policy", {
    metadata: { name: "home-assistant-websocket-ingress-policy" },
    spec: {
      podSelector: {
        matchExpressions: [
          {
            key: "app",
            operator: "In",
            values: ["zwave-js-ui", "eufy-security-ws"],
          },
        ],
      },
      policyTypes: ["Ingress"],
      ingress: [
        {
          from: [{ ipBlock: { cidr: `${PROD_NODE_LAN_IP}/32` } }],
          ports: [tcp(3000)],
        },
      ],
    },
  });

  // NetworkPolicy: Allow eufy-security-ws egress to DNS and external (Eufy cloud + P2P)
  new KubeNetworkPolicy(chart, "eufy-security-ws-egress-policy", {
    metadata: { name: "eufy-security-ws-egress-policy" },
    spec: {
      podSelector: { matchLabels: { app: "eufy-security-ws" } },
      policyTypes: ["Egress"],
      egress: [
        dnsEgressRule(),
        // External HTTPS (Eufy cloud API)
        externalHttpsEgressRule(),
        // Push notifications (motion, doorbell, lock events) arrive over a
        // long-lived TLS connection to Google's FCM endpoint,
        // mtalk.google.com:5228 (eufy-security-client `src/push/client.ts`).
        // Google publishes no fixed range for it.
        {
          to: [{ ipBlock: { cidr: "0.0.0.0/0" } }],
          ports: [tcp(5228)],
        },
        // Station and device events also arrive over Eufy's MQTT broker
        // (TLS on 8789, security-mqtt-*.anker.com), a long-lived connection
        // from eufy-security-client. Anker publishes no fixed range for it.
        {
          to: [{ ipBlock: { cidr: "0.0.0.0/0" } }],
          ports: [tcp(8789)],
        },
        // Allow all UDP egress (any port, any destination) for Eufy P2P.
        // Eufy stations perform NAT traversal with dynamic ephemeral ports on
        // both ends, so neither the destination IP nor port can be enumerated
        // ahead of time. This is the broadest egress rule on the pod -- the
        // P2P protocol requires it, and it is an accepted trade-off.
        {
          to: [{ ipBlock: { cidr: "0.0.0.0/0" } }],
          ports: [{ protocol: "UDP" }],
        },
      ],
    },
  });

  // zwave-js-ui reaches the Z-Wave stick through a host device, not the
  // network, and has no MQTT broker configured. It only calls out over HTTPS:
  // firmware and device-configuration updates, and Z-Wave JS usage statistics.
  new KubeNetworkPolicy(chart, "zwave-js-ui-egress-policy", {
    metadata: { name: "zwave-js-ui-egress-policy" },
    spec: {
      podSelector: { matchLabels: { app: "zwave-js-ui" } },
      policyTypes: ["Egress"],
      egress: [dnsEgressRule(), externalHttpsEgressRule()],
    },
  });
}
