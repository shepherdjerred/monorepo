import { describe, expect, test } from "vitest";
import { PROD_NODE_INTERNAL_IP } from "@shepherdjerred/homelab/cdk8s/src/misc/nodes.ts";
import type { FleetNetworkPolicy, FleetPolicyRule } from "./fleet.ts";
import { fleetOf, namespacePeer, policy, tcpPort } from "./fleet-fixtures.ts";
import {
  apiServerRulesOffEndpoint,
  postgresClustersClosedToOperator,
} from "./platform-peers.ts";

function apiViolations(rule: FleetPolicyRule) {
  return apiServerRulesOffEndpoint(
    fleetOf({
      networkPolicies: [policy("delivery", "api", { egress: [rule] })],
    }),
  );
}

function to(cidr: string, port: number): FleetPolicyRule {
  return { peers: [{ ipBlock: { cidr } }], ports: [tcpPort(port)] };
}

const CLUSTER = {
  apiVersion: "acid.zalan.do/v1",
  kind: "postgresql",
  metadata: { namespace: "media", name: "media-postgresql" },
};

function clusterPolicy(
  peer: string,
  ports: readonly number[],
): FleetNetworkPolicy {
  return {
    ...policy("media", undefined, {
      ingress: [
        { peers: [namespacePeer(peer)], ports: ports.map((p) => tcpPort(p)) },
      ],
    }),
    podSelector: { matchLabels: { "cluster-name": "media-postgresql" } },
  };
}

function violations(networkPolicies: readonly FleetNetworkPolicy[]) {
  return postgresClustersClosedToOperator(
    fleetOf({ objects: [CLUSTER], networkPolicies }),
  );
}

describe("apiServerRulesOffEndpoint", () => {
  test("the node's InternalIP is the endpoint the API server advertises", () => {
    expect(apiViolations(to(`${PROD_NODE_INTERNAL_IP}/32`, 6443))).toEqual([]);
  });

  test("the node's LAN address is not", () => {
    expect(apiViolations(to("192.168.1.81/32", 6443))).toEqual([
      "delivery/api-egress -> 192.168.1.81/32:6443",
    ]);
  });

  test.each([
    ["another port", to("192.168.1.81/32", 443)],
    ["every address", to("0.0.0.0/0", 6443)],
    ["no address", { peers: undefined, ports: [tcpPort(6443)] }],
    ["a namespace", { peers: [namespacePeer("kube")], ports: [tcpPort(6443)] }],
    ["every port", { peers: [{ ipBlock: { cidr: "10.0.0.0/8" } }] }],
  ] as const)("a rule for %s is not an API server rule", (_, rule) => {
    expect(apiViolations({ ports: undefined, ...rule })).toEqual([]);
  });
});

describe("postgresClustersClosedToOperator", () => {
  test("a cluster no Ingress policy selects is open", () => {
    expect(violations([])).toEqual([]);
  });

  test("a policy admitting the operator on SQL and Patroni passes", () => {
    expect(
      violations([clusterPolicy("postgres-operator", [5432, 8008])]),
    ).toEqual([]);
  });

  test("each port closed to the operator is reported", () => {
    expect(violations([clusterPolicy("postgres-operator", [5432])])).toEqual([
      "media/media-postgresql:8008",
    ]);
    expect(violations([clusterPolicy("media", [5432, 8008])])).toEqual([
      "media/media-postgresql:5432",
      "media/media-postgresql:8008",
    ]);
  });

  test("a namespace-wide policy binds the cluster's pods too", () => {
    expect(
      violations([
        policy("media", undefined, {
          ingress: [{ peers: [namespacePeer("tailscale")], ports: undefined }],
        }),
      ]),
    ).toEqual(["media/media-postgresql:5432", "media/media-postgresql:8008"]);
  });
});
