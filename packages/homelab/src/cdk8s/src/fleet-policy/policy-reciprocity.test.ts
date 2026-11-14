import { describe, expect, test } from "vitest";
import type {
  Fleet,
  FleetNetworkPolicy,
  FleetService,
  FleetWorkload,
} from "./fleet.ts";
import { unreciprocatedRules } from "./policy-reciprocity.ts";

const NAMESPACE_NAME = "kubernetes.io/metadata.name";
const SMTP = { protocol: "TCP", port: 25, endPort: undefined };

function workload(
  namespace: string,
  name: string,
  containerPort: number,
): FleetWorkload {
  return {
    key: `${namespace}/${name}`,
    kind: "Deployment",
    namespace,
    name,
    longRunning: true,
    hostNetwork: false,
    podLabels: { app: name },
    podSeccomp: undefined,
    containers: [
      {
        key: `${namespace}/${name}/main`,
        runsToCompletion: false,
        spec: { name: "main", ports: [{ containerPort }] },
      },
    ],
  };
}

/** A mail namespace: `smtp` behind a Service and policed, `relay` neither. */
function fleetWith(
  smtpAdmits: string,
  services: readonly FleetService[],
): Fleet {
  const client: FleetNetworkPolicy = {
    namespace: "forum",
    name: "forum-egress",
    podSelector: {},
    policyTypes: ["Egress"],
    ingress: [],
    egress: [
      {
        peers: [
          { namespaceSelector: { matchLabels: { [NAMESPACE_NAME]: "mail" } } },
        ],
        ports: [SMTP],
      },
    ],
  };
  const smtp: FleetNetworkPolicy = {
    namespace: "mail",
    name: "smtp-ingress",
    podSelector: { matchLabels: { app: "smtp" } },
    policyTypes: ["Ingress"],
    ingress: [
      {
        peers: [
          {
            namespaceSelector: {
              matchLabels: { [NAMESPACE_NAME]: smtpAdmits },
            },
          },
        ],
        ports: [SMTP],
      },
    ],
    egress: [],
  };
  return {
    objects: [],
    workloads: [
      workload("forum", "web", 8080),
      workload("mail", "smtp", 25),
      // Listens on 25 for its own pod only; no Service forwards to it.
      workload("mail", "relay", 25),
    ],
    networkPolicies: [client, smtp],
    services,
    serviceSelectors: [],
    applicationNamespaces: new Set(),
    backendProbes: [],
  };
}

const SMTP_SERVICE: FleetService = {
  namespace: "mail",
  name: "smtp",
  selector: { app: "smtp" },
  ports: [{ port: 25, targetPort: 25, protocol: "TCP" }],
};

describe("unreciprocatedRules", () => {
  test("a namespace-wide egress is answered by the workload a Service exposes on the port, not by an unpoliced neighbour", () => {
    expect(
      unreciprocatedRules(fleetWith("elsewhere", [SMTP_SERVICE]), "Egress"),
    ).toEqual(["forum/forum-egress -> mail:25"]);
  });

  test("the exposed workload admitting the source reciprocates the rule", () => {
    expect(
      unreciprocatedRules(fleetWith("forum", [SMTP_SERVICE]), "Egress"),
    ).toEqual([]);
  });

  test("the Service's target port is compared, not the port it listens on", () => {
    const fleet = fleetWith("elsewhere", [
      {
        ...SMTP_SERVICE,
        ports: [{ port: 2525, targetPort: 25, protocol: "TCP" }],
      },
    ]);
    expect(unreciprocatedRules(fleet, "Egress")).toEqual([
      "forum/forum-egress -> mail:25",
    ]);
  });

  test("when no Service carries the port every named peer still counts", () => {
    expect(unreciprocatedRules(fleetWith("elsewhere", []), "Egress")).toEqual(
      [],
    );
  });
});
