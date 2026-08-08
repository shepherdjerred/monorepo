import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { Namespace } from "cdk8s-plus-31";
import { KubeIngress } from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { registerBackendProbe } from "@shepherdjerred/homelab/cdk8s/src/misc/probe-registry.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";

const PLANE_NAMESPACE = "plane";
const PLANE_HOST = "plane";
const PLANE_SECRET_NAME = "plane-secrets";
const PLANE_ONEPASSWORD_ITEM = "plane-commercial-secrets";

export function createPlaneChart(app: App) {
  const chart = new Chart(app, "plane", {
    namespace: PLANE_NAMESPACE,
    disableResourceNameHashes: true,
  });

  new Namespace(chart, "plane-namespace", {
    metadata: {
      name: PLANE_NAMESPACE,
      labels: {
        // The vendor chart's bundled databases are not PSA-restricted. Keep
        // the namespace visible to the audit/warn profiles without blocking
        // those third-party containers.
        "pod-security.kubernetes.io/enforce": "privileged",
        "pod-security.kubernetes.io/audit": "restricted",
        "pod-security.kubernetes.io/warn": "restricted",
      },
    },
  });

  new OnePasswordItem(chart, "plane-secrets-onepassword", {
    spec: {
      itemPath: vaultItemPath(PLANE_ONEPASSWORD_ITEM),
    },
    metadata: {
      name: PLANE_SECRET_NAME,
      namespace: PLANE_NAMESPACE,
    },
  });

  // Plane's vendor chart only supports Traefik or nginx ingress. Route its
  // path-based services through the cluster's private Tailscale ingress
  // instead; the operator provisions HTTPS for the short hostname 'plane'.
  new KubeIngress(chart, "plane-ingress", {
    metadata: {
      name: "plane-ingress",
      namespace: PLANE_NAMESPACE,
    },
    spec: {
      ingressClassName: "tailscale",
      tls: [{ hosts: [PLANE_HOST] }],
      rules: [
        {
          http: {
            paths: [
              {
                path: "/spaces/",
                pathType: "Prefix",
                backend: {
                  service: { name: "plane-space", port: { number: 3000 } },
                },
              },
              {
                path: "/god-mode/",
                pathType: "Prefix",
                backend: {
                  service: { name: "plane-admin", port: { number: 3000 } },
                },
              },
              {
                path: "/api/",
                pathType: "Prefix",
                backend: {
                  service: { name: "plane-api", port: { number: 8000 } },
                },
              },
              {
                path: "/auth/",
                pathType: "Prefix",
                backend: {
                  service: { name: "plane-api", port: { number: 8000 } },
                },
              },
              {
                path: "/graphql/",
                pathType: "Prefix",
                backend: {
                  service: { name: "plane-api", port: { number: 8000 } },
                },
              },
              {
                path: "/marketplace/",
                pathType: "Prefix",
                backend: {
                  service: { name: "plane-api", port: { number: 8000 } },
                },
              },
              {
                path: "/live/",
                pathType: "Prefix",
                backend: {
                  service: { name: "plane-live", port: { number: 3000 } },
                },
              },
              {
                path: "/silo/",
                pathType: "Prefix",
                backend: {
                  service: { name: "plane-silo", port: { number: 3000 } },
                },
              },
              {
                path: "/",
                pathType: "Prefix",
                backend: {
                  service: { name: "plane-web", port: { number: 3000 } },
                },
              },
            ],
          },
        },
      ],
    },
  });

  registerBackendProbe({
    namespace: PLANE_NAMESPACE,
    serviceName: "plane-web",
    port: 3000,
  });

  return chart;
}
