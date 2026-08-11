import type { Chart } from "cdk8s";
import {
  IntOrString,
  KubeNetworkPolicy,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";

/**
 * Record the agent worker's narrow topology independently from the broad core
 * worker policy. The current Flannel cluster does not enforce NetworkPolicy;
 * provider-to-Temporal denial is enforced by the pod-local uid firewall.
 */
export function createTemporalAgentWorkerNetworkPolicy(chart: Chart): void {
  new KubeNetworkPolicy(chart, "temporal-agent-worker-netpol", {
    metadata: { name: "temporal-agent-worker-netpol" },
    spec: {
      podSelector: {
        matchLabels: { app: "temporal-agent-worker" },
      },
      policyTypes: ["Ingress", "Egress"],
      ingress: [
        {
          from: [
            {
              namespaceSelector: {
                matchLabels: {
                  "kubernetes.io/metadata.name": "prometheus",
                },
              },
            },
          ],
          ports: [
            { port: IntOrString.fromNumber(9464), protocol: "TCP" },
            { port: IntOrString.fromNumber(9465), protocol: "TCP" },
          ],
        },
      ],
      egress: [
        {
          to: [
            {
              namespaceSelector: {},
              podSelector: { matchLabels: { "k8s-app": "kube-dns" } },
            },
          ],
          ports: [
            { port: IntOrString.fromNumber(53), protocol: "UDP" },
            { port: IntOrString.fromNumber(53), protocol: "TCP" },
          ],
        },
        {
          to: [
            {
              podSelector: {
                matchLabels: { app: "temporal-server" },
              },
            },
          ],
          ports: [{ port: IntOrString.fromNumber(7233), protocol: "TCP" }],
        },
        {
          to: [
            {
              namespaceSelector: {
                matchLabels: {
                  "kubernetes.io/metadata.name": "prometheus",
                },
              },
            },
          ],
          ports: [{ port: IntOrString.fromNumber(9090), protocol: "TCP" }],
        },
        {
          to: [
            {
              namespaceSelector: {
                matchLabels: {
                  "kubernetes.io/metadata.name": "alert-dashboard",
                },
              },
            },
          ],
          ports: [{ port: IntOrString.fromNumber(7341), protocol: "TCP" }],
        },
        {
          to: [
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "tempo" },
              },
            },
          ],
          ports: [{ port: IntOrString.fromNumber(4318), protocol: "TCP" }],
        },
        // Provider APIs, GitHub, registry metadata, and the Kubernetes API.
        { ports: [{ port: IntOrString.fromNumber(443), protocol: "TCP" }] },
        { ports: [{ port: IntOrString.fromNumber(6443), protocol: "TCP" }] },
      ],
    },
  });
}
