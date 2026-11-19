import { Chart, type App } from "cdk8s";
import { KubeNetworkPolicy } from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { createArcadeDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/arcade.ts";
import { createArcadeEdge } from "@shepherdjerred/homelab/cdk8s/src/resources/arcade-edge.ts";
import {
  blackboxProbeIngressRule,
  cloudflareTunnelIngressRule,
  dnsEgressRule,
  externalHttpsEgressRule,
  prometheusIngressRule,
  tcp,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";

/** The controller's UI, API and metrics port. */
const CONTROLLER_PORT = 8081;
/** The edge's tunnel and HTTP-01 listener. */
const EDGE_BOOTSTRAP_PORT = 8082;
/** The edge's direct listeners behind the router's port forwards. */
const EDGE_DIRECT_PORTS = [8080, 8443];

export function createArcadeChart(app: App) {
  const chart = new Chart(app, "arcade", {
    namespace: "arcade",
    disableResourceNameHashes: true,
  });
  const controller = createArcadeDeployment(chart);
  const edge = createArcadeEdge(chart);

  // The controller is reached only through arcade-edge, and scraped on the
  // same port. Its egress stays unpoliced: Discord Go Live streaming sends
  // voice media over UDP to whatever voice server Discord assigns.
  new KubeNetworkPolicy(chart, "arcade-netpol", {
    metadata: { name: "arcade-netpol" },
    spec: {
      podSelector: { matchLabels: controller.matchLabels },
      policyTypes: ["Ingress"],
      ingress: [
        {
          from: [{ podSelector: { matchLabels: edge.matchLabels } }],
          ports: [tcp(CONTROLLER_PORT)],
        },
        prometheusIngressRule([CONTROLLER_PORT]),
      ],
    },
  });

  // The edge takes the public tunnel and its probe on the bootstrap port, and
  // internet clients directly on the NodePorts the router forwards to, which
  // keep the client's address (`externalTrafficPolicy: Local`). It proxies to
  // the controller and reaches the ACME directory over HTTPS for its
  // certificate.
  new KubeNetworkPolicy(chart, "arcade-edge-netpol", {
    metadata: { name: "arcade-edge-netpol" },
    spec: {
      podSelector: { matchLabels: edge.matchLabels },
      policyTypes: ["Ingress", "Egress"],
      ingress: [
        cloudflareTunnelIngressRule([EDGE_BOOTSTRAP_PORT]),
        blackboxProbeIngressRule(EDGE_BOOTSTRAP_PORT),
        {
          from: [{ ipBlock: { cidr: "0.0.0.0/0" } }],
          ports: EDGE_DIRECT_PORTS.map((port) => tcp(port)),
        },
      ],
      egress: [
        dnsEgressRule(),
        {
          to: [{ podSelector: { matchLabels: controller.matchLabels } }],
          ports: [tcp(CONTROLLER_PORT)],
        },
        externalHttpsEgressRule(),
      ],
    },
  });
}
