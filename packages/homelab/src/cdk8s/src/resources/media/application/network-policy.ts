import type { Chart } from "cdk8s";
import {
  IntOrString,
  KubeNetworkPolicy,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import {
  dnsEgressRule,
  externalHttpsEgressRule,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";
import { postgresClusterPodLabels } from "@shepherdjerred/homelab/cdk8s/src/resources/postgres/cluster-label.ts";
import { MEDIA_APPLICATION_LABEL } from "./environment.ts";

const namespace = (name: string) => ({
  namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": name } },
});
const tcp = (port: number) => ({
  port: IntOrString.fromNumber(port),
  protocol: "TCP",
});

export function createMediaApplicationNetworkPolicies(chart: Chart): void {
  const database = {
    to: [
      {
        podSelector: {
          matchLabels: postgresClusterPodLabels("media-postgresql"),
        },
      },
    ],
    ports: [tcp(5432)],
  };
  const flipt = { to: [namespace("flipt")], ports: [tcp(8080)] };
  const telemetry = { to: [namespace("alloy-gateway")], ports: [tcp(4318)] };
  new KubeNetworkPolicy(chart, "media-api-netpol", {
    spec: {
      podSelector: { matchLabels: { app: "media-api" } },
      policyTypes: ["Ingress", "Egress"],
      ingress: [
        {
          from: [namespace("tailscale"), namespace("prometheus")],
          ports: [tcp(7352)],
        },
      ],
      egress: [
        dnsEgressRule(),
        database,
        flipt,
        telemetry,
        externalHttpsEgressRule(),
        // Login verifies the user's own library access against the existing Plex service.
        { to: [{ podSelector: {} }], ports: [tcp(32_400)] },
        {
          to: [
            {
              ...namespace("temporal"),
              podSelector: { matchLabels: { app: "temporal-server" } },
            },
          ],
          ports: [tcp(7233)],
        },
      ],
    },
  });
  for (const role of ["media-network", "media-files"]) {
    new KubeNetworkPolicy(chart, `${role}-netpol`, {
      spec: {
        podSelector: { matchLabels: { component: role } },
        policyTypes: ["Ingress", "Egress"],
        ingress: [
          { from: [namespace("prometheus")], ports: [tcp(9464), tcp(9465)] },
        ],
        egress: [
          dnsEgressRule(),
          database,
          flipt,
          telemetry,
          {
            to: [
              {
                ...namespace("temporal"),
                podSelector: { matchLabels: { app: "temporal-server" } },
              },
            ],
            ports: [tcp(7233)],
          },
          ...(role === "media-files"
            ? []
            : [
                externalHttpsEgressRule(),
                // Kubernetes API endpoint; namespace-scoped read-only SA grants bound access.
                { ports: [tcp(6443)] },
                // Existing Plex uses a CDK-generated pod selector; the namespace and port bound this access.
                { to: [{ podSelector: {} }], ports: [tcp(32_400)] },
                {
                  to: [
                    { podSelector: { matchLabels: { app: "qbittorrent" } } },
                  ],
                  ports: [tcp(8080)],
                },
                { to: [namespace("pinchtab")], ports: [tcp(9867)] },
                { to: [namespace("postal")], ports: [tcp(5000)] },
              ]),
        ],
      },
    });
  }
  new KubeNetworkPolicy(chart, "media-postgresql-netpol", {
    spec: {
      podSelector: {
        matchLabels: postgresClusterPodLabels("media-postgresql"),
      },
      policyTypes: ["Ingress"],
      ingress: [
        {
          from: [
            {
              podSelector: {
                matchLabels: { [MEDIA_APPLICATION_LABEL]: "true" },
              },
            },
          ],
          ports: [tcp(5432)],
        },
        {
          from: [namespace("postgres-operator")],
          ports: [tcp(5432), tcp(8008)],
        },
        {
          from: [
            {
              podSelector: {
                matchLabels: postgresClusterPodLabels("media-postgresql"),
              },
            },
          ],
          ports: [tcp(5432), tcp(8008)],
        },
      ],
    },
  });
}
