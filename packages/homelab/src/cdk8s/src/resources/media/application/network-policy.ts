import type { Chart } from "cdk8s";
import { KubeNetworkPolicy } from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import {
  dnsEgressRule,
  externalHttpsEgressRule,
  nsPeer,
  tcp,
  flagsEgress,
  lokiOtlpEgress,
  otlpEgress,
  postgresEgress,
  postgresOperatorIngressRule,
  prometheusIngressRule,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";
import { postgresClusterPodLabels } from "@shepherdjerred/homelab/cdk8s/src/resources/postgres/cluster-label.ts";
import { MEDIA_APPLICATION_LABEL } from "./environment.ts";
import { platformModel } from "homelab/src/platform-model.ts";

export function createMediaApplicationNetworkPolicies(chart: Chart): void {
  const database = postgresEgress("media-postgresql");
  const flags = flagsEgress();
  const telemetry = otlpEgress();
  new KubeNetworkPolicy(chart, "media-api-netpol", {
    spec: {
      podSelector: { matchLabels: { app: "media-api" } },
      policyTypes: ["Ingress", "Egress"],
      ingress: [
        {
          // Actual upstream cloudflared identity, separate from its controller.
          from: [
            {
              ...nsPeer("cloudflare-operator-system"),
              podSelector: {
                matchLabels: {
                  "cfargotunnel.com/app": "cloudflared",
                  "cfargotunnel.com/tunnel":
                    platformModel.cloudflareTunnel.name,
                },
              },
            },
          ],
          ports: [tcp(7352)],
        },
        {
          from: [nsPeer("tailscale"), nsPeer("prometheus")],
          ports: [tcp(7352)],
        },
      ],
      egress: [
        dnsEgressRule(),
        database,
        flags,
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
          flags,
          telemetry,
          // The Temporal worker image ships its logs to Loki by default.
          lokiOtlpEgress(),
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
        postgresOperatorIngressRule(),
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
