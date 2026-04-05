import type { Chart } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";
import { Namespace } from "cdk8s-plus-31";
import {
  IntOrString,
  KubeNetworkPolicy,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { createIngress } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";
import { createServiceMonitor } from "@shepherdjerred/homelab/cdk8s/src/misc/service-monitor.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

// The windmill-db-url secret is created by a PostSync Job in the windmill-db chart.
// It reads the postgres-operator auto-generated credentials and builds the full DATABASE_URL.
const DB_URL_SECRET_NAME = "windmill-db-url";
const DB_URL_SECRET_KEY = "url";

const WINDMILL_NAMESPACE = "windmill";

export function createWindmillApp(chart: Chart) {
  new Namespace(chart, "windmill-namespace", {
    metadata: {
      name: WINDMILL_NAMESPACE,
      labels: {
        "pod-security.kubernetes.io/audit": "restricted",
        "pod-security.kubernetes.io/warn": "restricted",
      },
    },
  });

  // 1Password: API keys (OpenAI, Anthropic) for Windmill scripts
  const apiKeys = new OnePasswordItem(chart, "windmill-api-keys", {
    spec: {
      itemPath: vaultItemPath("windmill-api-keys"),
    },
    metadata: {
      namespace: WINDMILL_NAMESPACE,
    },
  });

  // Tailscale Ingress: expose windmill-app service on port 8000
  createIngress(chart, "windmill-ingress", {
    namespace: WINDMILL_NAMESPACE,
    service: "windmill-app",
    port: 8000,
    hosts: ["windmill"],
  });

  // ServiceMonitor: scrape Prometheus metrics from port 8001
  // The Helm chart creates a headless service "windmill-app-metrics" on port 8001
  createServiceMonitor(chart, {
    name: "windmill",
    namespace: WINDMILL_NAMESPACE,
    port: "metrics",
    matchLabels: { "app.kubernetes.io/name": "windmill" },
  });

  // NetworkPolicy: Tailscale ingress, DNS + PostgreSQL + internet egress
  new KubeNetworkPolicy(chart, "windmill-netpol", {
    metadata: {
      name: "windmill-netpol",
      namespace: WINDMILL_NAMESPACE,
    },
    spec: {
      podSelector: {},
      policyTypes: ["Egress", "Ingress"],
      ingress: [
        {
          from: [
            {
              namespaceSelector: {
                matchLabels: {
                  "kubernetes.io/metadata.name": "tailscale",
                },
              },
            },
          ],
        },
        {
          // Allow intra-namespace traffic (app <-> workers <-> LSP <-> PostgreSQL)
          from: [
            {
              podSelector: {},
            },
          ],
        },
      ],
      egress: [
        {
          // DNS
          to: [
            {
              namespaceSelector: {},
              podSelector: {
                matchLabels: {
                  "k8s-app": "kube-dns",
                },
              },
            },
          ],
          ports: [
            { port: IntOrString.fromNumber(53), protocol: "UDP" },
            { port: IntOrString.fromNumber(53), protocol: "TCP" },
          ],
        },
        {
          // PostgreSQL within namespace
          to: [
            {
              podSelector: {
                matchLabels: {
                  cluster_name: "windmill-postgresql",
                },
              },
            },
          ],
          ports: [{ port: IntOrString.fromNumber(5432), protocol: "TCP" }],
        },
        {
          // Intra-namespace (app <-> workers <-> LSP)
          to: [
            {
              podSelector: {},
            },
          ],
        },
        {
          // Internet access for workers executing scripts that fetch external resources
          to: [{ ipBlock: { cidr: "0.0.0.0/0" } }],
          ports: [
            { port: IntOrString.fromNumber(443), protocol: "TCP" },
            { port: IntOrString.fromNumber(80), protocol: "TCP" },
          ],
        },
      ],
    },
  });

  // Shared extraEnv for both worker groups: API keys from 1Password + WHITELIST_ENVS
  const workerApiKeyEnv = [
    {
      name: "OPENAI_API_KEY",
      valueFrom: {
        secretKeyRef: {
          name: apiKeys.name,
          key: "openai-api-key",
        },
      },
    },
    {
      name: "ANTHROPIC_API_KEY",
      valueFrom: {
        secretKeyRef: {
          name: apiKeys.name,
          key: "anthropic-api-key",
        },
      },
    },
    {
      name: "WHITELIST_ENVS",
      value: "OPENAI_API_KEY,ANTHROPIC_API_KEY",
    },
  ];

  const windmillValues: Record<string, unknown> = {
    postgresql: {
      enabled: false,
    },
    minio: {
      enabled: false,
    },
    ingress: {
      enabled: false,
    },
    windmill: {
      baseDomain: "windmill.tailnet-1a49.ts.net",
      baseProtocol: "https",
      appReplicas: 1,
      extraReplicas: 1,
      databaseUrlSecretName: DB_URL_SECRET_NAME,
      databaseUrlSecretKey: DB_URL_SECRET_KEY,
      rustLog: "info",
      workerGroups: [
        {
          name: "default",
          controller: "Deployment",
          replicas: 1,
          privileged: false,
          disableUnsharePid: true,
          podSecurityContext: {
            runAsUser: 0,
            runAsNonRoot: false,
          },
          resources: {
            requests: {
              cpu: "100m",
              memory: "256Mi",
            },
            limits: {
              memory: "2Gi",
            },
          },
          extraEnv: workerApiKeyEnv,
          mode: "worker",
        },
        {
          name: "native",
          controller: "Deployment",
          replicas: 1,
          privileged: false,
          disableUnsharePid: true,
          podSecurityContext: {
            runAsUser: 0,
            runAsNonRoot: false,
          },
          resources: {
            requests: {
              cpu: "50m",
              memory: "128Mi",
            },
            limits: {
              memory: "1Gi",
            },
          },
          extraEnv: [
            {
              name: "NATIVE_MODE",
              value: "true",
            },
            {
              name: "SLEEP_QUEUE",
              value: "200",
            },
            ...workerApiKeyEnv,
          ],
          mode: "worker",
        },
      ],
    },
    app: {
      resources: {
        requests: {
          cpu: "100m",
          memory: "256Mi",
        },
        limits: {
          memory: "2Gi",
        },
      },
    },
  };

  return new Application(chart, "windmill-app", {
    metadata: {
      name: "windmill",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        repoUrl: "https://windmill-labs.github.io/windmill-helm-charts/",
        chart: "windmill",
        targetRevision: versions.windmill,
        helm: {
          valuesObject: windmillValues,
        },
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: WINDMILL_NAMESPACE,
      },
      syncPolicy: {
        automated: {},
        syncOptions: ["CreateNamespace=true", "ServerSideApply=true"],
      },
    },
  });
}
