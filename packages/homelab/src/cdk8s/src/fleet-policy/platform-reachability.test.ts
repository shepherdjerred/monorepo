import { describe, expect, test } from "vitest";
import type {
  FleetNetworkPolicy,
  FleetPolicyRule,
  FleetService,
} from "./fleet.ts";
import {
  fleetOf,
  namespacePeer,
  policy,
  tcpPort,
  workload,
} from "./fleet-fixtures.ts";
import {
  egressPodsWithoutDns,
  tailscaleBackendsNotAdmitted,
} from "./platform-reachability.ts";

const INGRESS = {
  apiVersion: "networking.k8s.io/v1",
  kind: "Ingress",
  metadata: { namespace: "media", name: "sonarr-tailscale-ingress" },
  spec: {
    ingressClassName: "tailscale",
    defaultBackend: { service: { name: "sonarr", port: { number: 80 } } },
  },
};

const SERVICE: FleetService = {
  namespace: "media",
  name: "sonarr",
  selector: { app: "sonarr" },
  ports: [{ port: 80, targetPort: 8989, protocol: "TCP" }],
};

function tailscaleViolations(
  networkPolicies: readonly FleetNetworkPolicy[],
  services: readonly FleetService[] = [SERVICE],
) {
  return tailscaleBackendsNotAdmitted(
    fleetOf({
      objects: [INGRESS],
      workloads: [workload("media", "sonarr", 8989)],
      services,
      networkPolicies,
    }),
  );
}

function admitting(rule: FleetPolicyRule) {
  return policy("media", "sonarr", { ingress: [rule] });
}

describe("tailscaleBackendsNotAdmitted", () => {
  const closed = ["media/sonarr-tailscale-ingress -> sonarr:80"];

  test("a backend no Ingress policy selects is open", () => {
    expect(tailscaleViolations([])).toEqual([]);
  });

  test("the tailscale namespace on the pod port is admitted", () => {
    expect(
      tailscaleViolations([
        admitting({
          peers: [namespacePeer("tailscale")],
          ports: [tcpPort(8989)],
        }),
      ]),
    ).toEqual([]);
  });

  test("the proxy pods of this Ingress alone are admitted", () => {
    const proxy = {
      ...namespacePeer("tailscale"),
      podSelector: {
        matchLabels: {
          "tailscale.com/parent-resource": "sonarr-tailscale-ingress",
          "tailscale.com/parent-resource-ns": "media",
        },
      },
    };
    expect(
      tailscaleViolations([admitting({ peers: [proxy], ports: undefined })]),
    ).toEqual([]);
  });

  test.each([
    ["another namespace", { peers: [namespacePeer("prometheus")] }],
    ["the Service port, not the pod port", { ports: [tcpPort(80)] }],
    [
      "the proxy of another Ingress",
      {
        peers: [
          {
            ...namespacePeer("tailscale"),
            podSelector: {
              matchLabels: { "tailscale.com/parent-resource": "radarr" },
            },
          },
        ],
      },
    ],
  ] as const)("a policy admitting %s closes the route", (_, rule) => {
    expect(
      tailscaleViolations([
        admitting({
          peers: [namespacePeer("tailscale")],
          ports: [tcpPort(8989)],
          ...rule,
        }),
      ]),
    ).toEqual(closed);
  });

  test("a Service synthesis cannot see is judged on its Service port", () => {
    const everyPod = policy("media", undefined, {
      ingress: [{ peers: [namespacePeer("tailscale")], ports: [tcpPort(80)] }],
    });
    expect(tailscaleViolations([everyPod], [])).toEqual([]);
    expect(
      tailscaleViolations([policy("media", undefined, { ingress: [] })], []),
    ).toEqual(closed);
  });

  test("an Ingress of another class is not a Tailscale route", () => {
    expect(
      tailscaleBackendsNotAdmitted(
        fleetOf({
          objects: [
            {
              ...INGRESS,
              spec: { ...INGRESS.spec, ingressClassName: "nginx" },
            },
          ],
          workloads: [workload("media", "sonarr", 8989)],
          services: [SERVICE],
          networkPolicies: [policy("media", "sonarr", { ingress: [] })],
        }),
      ),
    ).toEqual([]);
  });
});

const DNS_PEER = {
  namespaceSelector: {},
  podSelector: { matchLabels: { "k8s-app": "kube-dns" } },
};

function dnsPort(protocol: string) {
  return { protocol, port: 53, endPort: undefined };
}

function dnsViolations(...rules: FleetPolicyRule[]) {
  return egressPodsWithoutDns(
    fleetOf({
      workloads: [workload("media", "sonarr", 8989)],
      networkPolicies: [policy("media", "sonarr", { egress: rules })],
    }),
  );
}

describe("egressPodsWithoutDns", () => {
  test("a pod no Egress policy selects is open", () => {
    expect(
      egressPodsWithoutDns(
        fleetOf({ workloads: [workload("media", "sonarr", 8989)] }),
      ),
    ).toEqual([]);
  });

  test("the shared DNS rule opens both protocols", () => {
    expect(
      dnsViolations({
        peers: [DNS_PEER],
        ports: [dnsPort("UDP"), dnsPort("TCP")],
      }),
    ).toEqual([]);
  });

  test("each protocol left closed is reported", () => {
    expect(
      dnsViolations({ peers: [DNS_PEER], ports: [dnsPort("UDP")] }),
    ).toEqual(["media/sonarr:53/TCP"]);
    expect(
      dnsViolations({
        peers: [{ ipBlock: { cidr: "0.0.0.0/0" } }],
        ports: [tcpPort(443)],
      }),
    ).toEqual(["media/sonarr:53/UDP", "media/sonarr:53/TCP"]);
  });

  test("a rule for another namespace's pods does not reach CoreDNS", () => {
    expect(
      dnsViolations({
        peers: [namespacePeer("media")],
        ports: [dnsPort("UDP"), dnsPort("TCP")],
      }),
    ).toEqual(["media/sonarr:53/UDP", "media/sonarr:53/TCP"]);
  });

  test("policies add up across a pod", () => {
    expect(
      egressPodsWithoutDns(
        fleetOf({
          workloads: [workload("media", "sonarr", 8989)],
          networkPolicies: [
            policy("media", "sonarr", { egress: [] }),
            {
              ...policy("media", undefined, {
                egress: [{ peers: [DNS_PEER], ports: undefined }],
              }),
              name: "namespace-dns",
            },
          ],
        }),
      ),
    ).toEqual([]);
  });

  test("a policy for pods synthesis cannot see is checked by its selector", () => {
    const steps: FleetNetworkPolicy = {
      ...policy("ci", "step", { egress: [] }),
      name: "step-egress",
    };
    expect(egressPodsWithoutDns(fleetOf({ networkPolicies: [steps] }))).toEqual(
      ["ci/policy:step-egress:53/UDP", "ci/policy:step-egress:53/TCP"],
    );
  });

  test("a host-network pod is not selected by any policy", () => {
    expect(
      egressPodsWithoutDns(
        fleetOf({
          workloads: [
            { ...workload("home", "homeassistant", 8123), hostNetwork: true },
            workload("home", "zwave", 8091),
          ],
          networkPolicies: [
            {
              ...policy("home", undefined, {
                egress: [{ peers: [DNS_PEER], ports: undefined }],
              }),
            },
          ],
        }),
      ),
    ).toEqual([]);
  });
});
