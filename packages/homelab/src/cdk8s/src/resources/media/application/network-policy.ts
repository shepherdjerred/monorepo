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
  prometheusIngressRule,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";
import type { SingleAppDatabase } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/postgres-database.ts";
import { MEDIA_APPLICATION_LABEL } from "./environment.ts";
import {
  MAIL_API_ENDPOINT,
  PINCHTAB_ENDPOINT,
} from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/endpoint.ts";

export function createMediaApplicationNetworkPolicies(
  chart: Chart,
  database: SingleAppDatabase,
): void {
  const flags = flagsEgress();
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
        database.egress,
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
          database.egress,
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
                {
                  to: [PINCHTAB_ENDPOINT.namespacePeer()],
                  ports: [PINCHTAB_ENDPOINT.tcp()],
                },
                {
                  to: [MAIL_API_ENDPOINT.peer()],
                  ports: [MAIL_API_ENDPOINT.tcp()],
                },
              ]),
        ],
      },
    });
  }
  database.createClusterIngressPolicy("media-postgresql-netpol", {
    [MEDIA_APPLICATION_LABEL]: "true",
  });
}
