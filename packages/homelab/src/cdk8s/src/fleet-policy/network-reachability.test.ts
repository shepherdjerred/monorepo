import { PROD_NODE_INTERNAL_IP } from "@shepherdjerred/homelab/cdk8s/src/misc/nodes.ts";
import { describe, expect, test } from "vitest";
import type { FleetPolicyPort } from "./fleet.ts";
import { workload } from "./fleet-fixtures.ts";
import {
  namespaceNamedBy,
  peerNamespace,
  peerSelects,
  podsLabelled,
  podsOf,
  portsCover,
} from "./network-reachability.ts";

function nsPeer(name: string) {
  return {
    namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": name } },
  };
}

function podPeer(app: string) {
  return { ...nsPeer("prometheus"), podSelector: { matchLabels: { app } } };
}

function port(
  value: number | string | undefined,
  protocol = "TCP",
  endPort?: number,
): FleetPolicyPort {
  return { protocol, port: value, endPort };
}

describe("peerSelects", () => {
  const pods = podsLabelled("prometheus", { app: "blackbox" });

  test("a namespace peer selects every pod of that namespace", () => {
    expect(peerSelects(nsPeer("prometheus"), "media", pods)).toBe(true);
    expect(peerSelects(nsPeer("tailscale"), "media", pods)).toBe(false);
  });

  test("a peer without a namespaceSelector means the policy's namespace", () => {
    expect(peerSelects({ podSelector: {} }, "prometheus", pods)).toBe(true);
    expect(peerSelects({ podSelector: {} }, "media", pods)).toBe(false);
  });

  test("a namespace and pod selector must both match", () => {
    expect(peerSelects(podPeer("blackbox"), "media", pods)).toBe(true);
    expect(peerSelects(podPeer("grafana"), "media", pods)).toBe(false);
  });

  test.each([
    [{ cidr: "0.0.0.0/0" }, true],
    [{ cidr: "0.0.0.0/0", except: ["10.0.0.0/8"] }, false],
    [{ cidr: "192.168.1.0/24" }, false],
  ])(
    "an ipBlock selects pods only when it covers every address: %j",
    (ipBlock, expected) => {
      expect(peerSelects({ ipBlock }, "prometheus", pods)).toBe(expected);
    },
  );

  test("hostNetwork workloads are selected by the production node's /32 ipBlock, never by namespace selectors", () => {
    const hostPods = podsOf({
      ...workload("home", "homeassistant", 8123),
      hostNetwork: true,
    });
    expect(peerSelects(nsPeer("home"), "alert-dashboard", hostPods)).toBe(
      false,
    );
    expect(peerSelects({ podSelector: {} }, "home", hostPods)).toBe(false);
    expect(
      peerSelects(
        { ipBlock: { cidr: `${PROD_NODE_INTERNAL_IP}/32` } },
        "alert-dashboard",
        hostPods,
      ),
    ).toBe(true);
    expect(
      peerSelects(
        { ipBlock: { cidr: "0.0.0.0/0" } },
        "alert-dashboard",
        hostPods,
      ),
    ).toBe(true);
    expect(
      peerSelects(
        { ipBlock: { cidr: "192.168.1.0/24" } },
        "alert-dashboard",
        hostPods,
      ),
    ).toBe(false);
  });
});

describe("namespaceNamedBy", () => {
  test("reads the namespace name label, when the peer selects on it", () => {
    expect(namespaceNamedBy(nsPeer("flipt"))).toBe("flipt");
    expect(namespaceNamedBy({ namespaceSelector: {} })).toBeUndefined();
    expect(namespaceNamedBy({ podSelector: {} })).toBeUndefined();
  });
});

describe("peerNamespace", () => {
  test("a peer without a namespaceSelector names the policy's namespace", () => {
    expect(peerNamespace({ podSelector: {} }, "tasknotes")).toBe("tasknotes");
  });

  test("a namespaceSelector names the namespace it selects by name", () => {
    expect(peerNamespace(nsPeer("flipt"), "tasknotes")).toBe("flipt");
    expect(peerNamespace(nsPeer("tasknotes"), "tasknotes")).toBe("tasknotes");
  });

  test("an ipBlock or a selector on another label names no single namespace", () => {
    expect(
      peerNamespace({ ipBlock: { cidr: "0.0.0.0/0" } }, "tasknotes"),
    ).toBeUndefined();
    expect(
      peerNamespace({ namespaceSelector: {}, podSelector: {} }, "tasknotes"),
    ).toBeUndefined();
  });
});

describe("portsCover", () => {
  const named = new Map([["http", 8080]]);

  test("no port list covers every port", () => {
    expect(portsCover(undefined, port(8080), named)).toBe(true);
  });

  test("no wanted port asks only for the rule", () => {
    expect(portsCover([port(8080)], undefined, named)).toBe(true);
  });

  test.each([
    [[port(8080)], port(8080), true],
    [[port(8081)], port(8080), false],
    [[port(8080, "UDP")], port(8080), false],
    [[port(undefined)], port(8080), true],
    [[port(8080)], port(undefined), false],
    [[port(8000, "TCP", 8100)], port(8080), true],
    [[port(8000, "TCP", 8100)], port(8090, "TCP", 8200), false],
    [[port("http")], port(8080), true],
    [[port(8080)], port("http"), true],
    [[port("metrics")], port(8080), false],
    [[port("metrics")], port("metrics"), true],
  ] as const)("%j covers %j: %s", (allowed, wanted, expected) => {
    expect(portsCover(allowed, wanted, named)).toBe(expected);
  });
});
