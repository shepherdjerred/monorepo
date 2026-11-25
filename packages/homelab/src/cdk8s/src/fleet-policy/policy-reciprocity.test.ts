import { describe, expect, test } from "vitest";
import type {
  Fleet,
  FleetNetworkPolicy,
  FleetService,
  NetworkPolicyPeer,
} from "./fleet.ts";
import {
  fleetOf,
  namespacePeer,
  policy,
  tcpPort,
  workload,
} from "./fleet-fixtures.ts";
import { unreciprocatedRules } from "./policy-reciprocity.ts";

const NAMESPACE_NAME = "kubernetes.io/metadata.name";
const SMTP = { protocol: "TCP", port: 25, endPort: undefined };

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
  return fleetOf({
    workloads: [
      workload("forum", "web", 8080),
      workload("mail", "smtp", 25),
      // Listens on 25 for its own pod only; no Service forwards to it.
      workload("mail", "relay", 25),
    ],
    networkPolicies: [client, smtp],
    services,
  });
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

/**
 * A tasknotes-shaped namespace: the app and its postgres-operator cluster,
 * whose pods the operator renders and which are known only by the label the
 * app's Egress rule names them by.
 */
const DATABASE = { "cluster-name": "notes-postgresql" };
const TAILSCALE_ONLY = {
  ingress: [{ peers: [namespacePeer("tailscale")], ports: undefined }],
};

function notesFleet(
  databasePeer: NetworkPolicyPeer,
  ingress: readonly FleetNetworkPolicy[],
): Fleet {
  return fleetOf({
    workloads: [workload("notes", "notes", 3000)],
    networkPolicies: [
      policy("notes", "notes", {
        egress: [{ peers: [databasePeer], ports: [tcpPort(5432)] }],
      }),
      ...ingress,
    ],
  });
}

const DATABASE_PEER = { podSelector: { matchLabels: DATABASE } };

describe("unreciprocatedRules within one namespace", () => {
  test("a namespace-wide Ingress policy that does not admit the app shuts it out of its own database", () => {
    expect(
      unreciprocatedRules(
        notesFleet(DATABASE_PEER, [policy("notes", undefined, TAILSCALE_ONLY)]),
        "Egress",
      ),
    ).toEqual([
      "notes/notes-egress -> notes{cluster-name=notes-postgresql}:5432",
    ]);
  });

  test("a namespaceSelector naming the policy's own namespace is checked too", () => {
    const peer = { ...namespacePeer("notes"), ...DATABASE_PEER };
    expect(
      unreciprocatedRules(
        notesFleet(peer, [policy("notes", undefined, TAILSCALE_ONLY)]),
        "Egress",
      ),
    ).toEqual([
      "notes/notes-egress -> notes{cluster-name=notes-postgresql}:5432",
    ]);
  });

  test("an Ingress policy on the app alone leaves the database unpoliced", () => {
    expect(
      unreciprocatedRules(
        notesFleet(DATABASE_PEER, [policy("notes", "notes", TAILSCALE_ONLY)]),
        "Egress",
      ),
    ).toEqual([]);
  });

  test("a database policy admitting the app reciprocates the rule", () => {
    const database: FleetNetworkPolicy = {
      ...policy("notes", undefined, {
        ingress: [
          {
            peers: [{ podSelector: { matchLabels: { app: "notes" } } }],
            ports: [tcpPort(5432)],
          },
        ],
      }),
      podSelector: { matchLabels: DATABASE },
    };
    expect(
      unreciprocatedRules(notesFleet(DATABASE_PEER, [database]), "Egress"),
    ).toEqual([]);
  });

  test("an Ingress rule admitting pods of the namespace that never send to it grants nothing", () => {
    const fleet = fleetOf({
      workloads: [
        workload("notes", "notes", 3000),
        workload("notes", "cron", 8081),
      ],
      networkPolicies: [
        policy("notes", "notes", {
          ingress: [{ peers: [{ podSelector: {} }], ports: [tcpPort(3000)] }],
        }),
        policy("notes", undefined, {
          egress: [{ peers: [namespacePeer("flags")], ports: [tcpPort(7361)] }],
        }),
      ],
    });
    expect(unreciprocatedRules(fleet, "Ingress")).toEqual([
      "notes/notes-ingress <- notes:3000",
    ]);
  });
});
