import type { Chart } from "cdk8s";
import { KubeNetworkPolicy } from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import {
  dnsEgressRule,
  externalHttpsEgressRule,
  nsPeer,
  tcp,
  fliptEgress,
  otlpEgress,
  postgresEgress,
  prometheusIngressRule,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";
import { postgresClusterPodLabels } from "@shepherdjerred/homelab/cdk8s/src/resources/postgres/cluster-label.ts";
import { MEDIA_APPLICATION_LABEL } from "./environment.ts";

export function createMediaApplicationNetworkPolicies(chart: Chart): void {
  const database = postgresEgress("media-postgresql");
  const flipt = fliptEgress();
  const telemetry = otlpEgress();
  new KubeNetworkPolicy(chart, "media-api-netpol", {
    spec: {
      podSelector: { matchLabels: { app: "media-api" } },
      policyTypes: ["Ingress", "Egress"],
      ingress: [
        {
          from: [nsPeer("tailscale"), nsPeer("prometheus")],
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
              ...nsPeer("temporal"),
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
        ingress: [prometheusIngressRule([9464, 9465])],
        egress: [
          dnsEgressRule(),
          database,
          flipt,
          telemetry,
          {
            to: [
              {
                ...nsPeer("temporal"),
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
                { to: [nsPeer("pinchtab")], ports: [tcp(9867)] },
                { to: [nsPeer("postal")], ports: [tcp(5000)] },
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
          from: [nsPeer("postgres-operator")],
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
