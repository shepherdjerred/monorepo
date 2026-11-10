import { Testing } from "cdk8s";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  KubeNetworkPolicy,
  type NetworkPolicySpec,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import {
  blackboxProbeIngressRule,
  cloudflareTunnelIngressRule,
  dnsEgressRule,
  externalHttpsEgressRule,
  fliptEgress,
  intraNamespaceRule,
  nsPeer,
  otlpEgress,
  postgresEgress,
  prometheusIngressRule,
  seaweedfsEgress,
  tailscaleIngressRule,
  tcp,
} from "./network-policies.ts";

const Policy = z.object({
  spec: z.object({
    ingress: z.array(z.unknown()).optional(),
    egress: z.array(z.unknown()).optional(),
  }),
});

type Rules = Pick<NetworkPolicySpec, "ingress" | "egress">;

/** The rules as a NetworkPolicy renders them, after cdk8s resolves ports. */
function render(rules: Rules) {
  const chart = Testing.chart();
  new KubeNetworkPolicy(chart, "policy", {
    spec: { podSelector: {}, ...rules },
  });
  return Policy.parse(Testing.synth(chart)[0]).spec;
}

const namespace = (name: string) => ({
  namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": name } },
});
const port = (number: number, protocol = "TCP") => ({ port: number, protocol });

describe("network policy peer library", () => {
  test("a namespace peer selects by the namespace name label", () => {
    expect(
      render({ ingress: [{ from: [nsPeer("temporal")] }] }).ingress,
    ).toEqual([{ from: [namespace("temporal")] }]);
  });

  test("tcp renders a numeric TCP port", () => {
    expect(render({ ingress: [{ ports: [tcp(7233)] }] }).ingress).toEqual([
      { ports: [port(7233)] },
    ]);
  });

  test("ingress rules name their source namespace and only the given ports", () => {
    expect(
      render({
        ingress: [
          tailscaleIngressRule([8080]),
          cloudflareTunnelIngressRule([3000, 3001]),
          prometheusIngressRule([9090]),
          blackboxProbeIngressRule(8080),
        ],
      }).ingress,
    ).toEqual([
      { from: [namespace("tailscale")], ports: [port(8080)] },
      {
        from: [namespace("cloudflare-tunnel")],
        ports: [port(3000), port(3001)],
      },
      { from: [namespace("prometheus")], ports: [port(9090)] },
      { from: [namespace("prometheus")], ports: [port(8080)] },
    ]);
  });

  test("an edge rule without ports omits the ports key rather than rendering an empty list", () => {
    expect(
      render({
        ingress: [
          tailscaleIngressRule(),
          cloudflareTunnelIngressRule(),
          intraNamespaceRule(),
        ],
      }).ingress,
    ).toEqual([
      { from: [namespace("tailscale")] },
      { from: [namespace("cloudflare-tunnel")] },
      { from: [{ podSelector: {} }] },
    ]);
  });

  test("egress rules reach the shared in-cluster services on their fixed ports", () => {
    expect(
      render({
        egress: [
          dnsEgressRule(),
          fliptEgress(),
          otlpEgress(),
          seaweedfsEgress(),
          postgresEgress("tracker-postgresql"),
          externalHttpsEgressRule(),
        ],
      }).egress,
    ).toEqual([
      {
        to: [
          {
            namespaceSelector: {},
            podSelector: { matchLabels: { "k8s-app": "kube-dns" } },
          },
        ],
        ports: [port(53, "UDP"), port(53)],
      },
      { to: [namespace("flipt")], ports: [port(8080)] },
      { to: [namespace("alloy-gateway")], ports: [port(4318)] },
      { to: [namespace("seaweedfs")], ports: [port(8333)] },
      {
        to: [
          {
            podSelector: {
              matchLabels: { "cluster-name": "tracker-postgresql" },
            },
          },
        ],
        ports: [port(5432)],
      },
      { to: [{ ipBlock: { cidr: "0.0.0.0/0" } }], ports: [port(443)] },
    ]);
  });

  test("each call returns a fresh object", () => {
    expect(dnsEgressRule()).not.toBe(dnsEgressRule());
    expect(nsPeer("flipt")).not.toBe(nsPeer("flipt"));
  });
});
