import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { Namespace } from "cdk8s-plus-31";
import {
  KubeIngress,
  KubeService,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { registerBackendProbe } from "@shepherdjerred/homelab/cdk8s/src/misc/probe-registry.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";

const PLANE_NAMESPACE = "plane";
const PLANE_HOST = "plane";
const PLANE_SECRET_NAME = "plane-secrets";
const PLANE_ONEPASSWORD_ITEM = "plane-commercial-secrets";
const planeIngressBackends = {
  admin: {
    serviceName: "plane-ingress-admin",
    selector: "plane-plane-admin",
    port: 3000,
  },
  api: {
    serviceName: "plane-ingress-api",
    selector: "plane-plane-api",
    port: 8000,
  },
  live: {
    serviceName: "plane-ingress-live",
    selector: "plane-plane-live",
    port: 3000,
  },
  silo: {
    serviceName: "plane-ingress-silo",
    selector: "plane-plane-silo",
    port: 3000,
  },
  space: {
    serviceName: "plane-ingress-space",
    selector: "plane-plane-space",
    port: 3000,
  },
  web: {
    serviceName: "plane-ingress-web",
    selector: "plane-plane-web",
    port: 3000,
  },
} as const;

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

  // Plane's vendor chart exposes its HTTP workloads through headless Services.
  // The Tailscale operator rejects headless backends, so give the ingress
  // stable ClusterIP adapters while retaining the vendor selectors and ports.
  for (const backend of Object.values(planeIngressBackends)) {
    new KubeService(chart, `${backend.serviceName}-service`, {
      metadata: {
        name: backend.serviceName,
        namespace: PLANE_NAMESPACE,
      },
      spec: {
        selector: { "app.name": backend.selector },
        ports: [{ port: backend.port }],
      },
    });
  }

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
                  service: {
                    name: planeIngressBackends.space.serviceName,
                    port: { number: planeIngressBackends.space.port },
                  },
                },
              },
              {
                path: "/god-mode/",
                pathType: "Prefix",
                backend: {
                  service: {
                    name: planeIngressBackends.admin.serviceName,
                    port: { number: planeIngressBackends.admin.port },
                  },
                },
              },
              {
                path: "/api/",
                pathType: "Prefix",
                backend: {
                  service: {
                    name: planeIngressBackends.api.serviceName,
                    port: { number: planeIngressBackends.api.port },
                  },
                },
              },
              {
                path: "/auth/",
                pathType: "Prefix",
                backend: {
                  service: {
                    name: planeIngressBackends.api.serviceName,
                    port: { number: planeIngressBackends.api.port },
                  },
                },
              },
              {
                path: "/graphql/",
                pathType: "Prefix",
                backend: {
                  service: {
                    name: planeIngressBackends.api.serviceName,
                    port: { number: planeIngressBackends.api.port },
                  },
                },
              },
              {
                path: "/marketplace/",
                pathType: "Prefix",
                backend: {
                  service: {
                    name: planeIngressBackends.api.serviceName,
                    port: { number: planeIngressBackends.api.port },
                  },
                },
              },
              {
                path: "/live/",
                pathType: "Prefix",
                backend: {
                  service: {
                    name: planeIngressBackends.live.serviceName,
                    port: { number: planeIngressBackends.live.port },
                  },
                },
              },
              {
                path: "/silo/",
                pathType: "Prefix",
                backend: {
                  service: {
                    name: planeIngressBackends.silo.serviceName,
                    port: { number: planeIngressBackends.silo.port },
                  },
                },
              },
              {
                path: "/",
                pathType: "Prefix",
                backend: {
                  service: {
                    name: planeIngressBackends.web.serviceName,
                    port: { number: planeIngressBackends.web.port },
                  },
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
