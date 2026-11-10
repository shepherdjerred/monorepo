import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { Namespace } from "cdk8s-plus-31";
import { KubeNetworkPolicy } from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { createBirmelDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/birmel/index.ts";
import {
  dnsEgressRule,
  nsPeer,
  tcp,
  fliptEgress,
  otlpEgress,
  prometheusIngressRule,
  externalHttpsEgressRule,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";

export function createBirmelChart(app: App) {
  const chart = new Chart(app, "birmel", {
    namespace: "birmel",
    disableResourceNameHashes: true,
  });

  new Namespace(chart, "birmel-namespace", {
    metadata: {
      name: "birmel",
      labels: {
        "pod-security.kubernetes.io/enforce": "privileged",
        "pod-security.kubernetes.io/audit": "restricted",
        "pod-security.kubernetes.io/warn": "restricted",
      },
    },
  });

  createBirmelDeployment(chart);

  // NetworkPolicy: Birmel exposes no ingress of its own now that the editor
  // OAuth server is gone — only Prometheus reaches in, to scrape health.
  new KubeNetworkPolicy(chart, "birmel-ingress-netpol", {
    metadata: { name: "birmel-ingress-netpol" },
    spec: {
      podSelector: {},
      policyTypes: ["Ingress"],
      ingress: [
        // Allow Prometheus to scrape the health service metrics, without
        // opening other pod ports to the monitoring namespace.
        prometheusIngressRule([8080]),
      ],
    },
  });

  // NetworkPolicy: Allow egress to DNS, Flipt, the OTLP trace gateway, PinchTab, and external HTTPS
  new KubeNetworkPolicy(chart, "birmel-egress-netpol", {
    metadata: { name: "birmel-egress-netpol" },
    spec: {
      podSelector: {},
      policyTypes: ["Egress"],
      egress: [
        // DNS
        dnsEgressRule(),
        // OTLP trace gateway (alloy-gateway.alloy-gateway.svc.cluster.local:4318)
        otlpEgress(),
        // Flipt evaluation (flipt-flipt-service.flipt.svc.cluster.local:8080)
        fliptEgress(),
        // PinchTab browser automation (pinchtab.pinchtab.svc.cluster.local:9867)
        {
          to: [nsPeer("pinchtab")],
          ports: [tcp(9867)],
        },
        // External HTTPS (Discord, OpenAI, Anthropic, GitHub, and Bugsink via its
        // public bugsink.sjer.red DSN host)
        externalHttpsEgressRule(),
      ],
    },
  });
}
