import { Chart } from "cdk8s";
import type { App } from "cdk8s";
import { createScoutDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/scout/index.ts";
import { createScoutPostgreSQLDatabase } from "@shepherdjerred/homelab/cdk8s/src/resources/postgres/scout-db.ts";
import { Namespace } from "cdk8s-plus-31";
import {
  KubeNetworkPolicy,
  IntOrString,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { FLIPT_PORT } from "@shepherdjerred/homelab/cdk8s/src/resources/flipt/index.ts";
import { createScoutWorkflowWorker } from "@shepherdjerred/homelab/cdk8s/src/resources/scout/workflow-worker.ts";
import { createDnsEgressRule } from "@shepherdjerred/homelab/cdk8s/src/resources/temporal/worker-network-policies.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

export type Stage = "prod" | "beta";
type WorkflowWorkerImageOverrides = {
  stable?: string;
  candidate?: string;
};

export function createScoutChart(
  app: App,
  stage: Stage,
  workflowWorkerImageOverrides?: WorkflowWorkerImageOverrides,
) {
  const chart = new Chart(app, `scout-${stage}`, {
    namespace: `scout-${stage}`,
    disableResourceNameHashes: true,
  });

  new Namespace(chart, `scout-${stage}-namespace`, {
    metadata: {
      name: `scout-${stage}`,
    },
  });

  createScoutPostgreSQLDatabase(chart, stage);
  createScoutDeployment(chart, stage);
  const stableImage =
    workflowWorkerImageOverrides?.stable ??
    versions[`shepherdjerred/scout-for-lol/${stage}/workflows/stable`];
  const candidateImage =
    workflowWorkerImageOverrides?.candidate ??
    versions[`shepherdjerred/scout-for-lol/${stage}/workflows/candidate`];
  const stableWorkflowWorker =
    stage === "beta"
      ? createScoutWorkflowWorker(chart, stage, "stable", stableImage)
      : undefined;
  // The embedded backend poller is unversioned and cannot be a rollback target.
  // Bootstrap a capable stable version first. Keep the candidate Deployment
  // rendered even when its pin equals stable so promotion does not leave
  // unmanaged candidate resources behind when pruning is disabled.
  const candidateWorkflowWorker =
    stage === "beta" &&
    stableWorkflowWorker !== undefined &&
    candidateImage !== undefined
      ? createScoutWorkflowWorker(chart, stage, "candidate", candidateImage)
      : undefined;
  const workflowWorkerCreated =
    stableWorkflowWorker !== undefined || candidateWorkflowWorker !== undefined;

  // NetworkPolicy: Allow ingress from Prometheus (scrapes scout-backend
  // metrics on :3000), in-namespace pods, and the shared s3-static-sites
  // Caddy (reverse-proxies /trpc + /api on scout-for-lol.com to
  // scout-service-{stage}:3000 cross-namespace). The Cloudflare Tunnel
  // now terminates at s3-static-sites, not directly at scout-{stage}.
  new KubeNetworkPolicy(chart, "scout-ingress-netpol", {
    metadata: { name: "scout-ingress-netpol" },
    spec: {
      // Backend pods only: the Patroni/Spilo postgres pods stay unselected
      // so this policy does not sever their Kubernetes API access.
      podSelector: { matchLabels: { app: "scout-backend" } },
      policyTypes: ["Ingress"],
      ingress: [
        {
          from: [
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "prometheus" },
              },
            },
            { podSelector: {} },
            {
              namespaceSelector: {
                matchLabels: {
                  "kubernetes.io/metadata.name": "s3-static-sites",
                },
              },
            },
            ...(stage === "beta"
              ? [
                  {
                    namespaceSelector: {
                      matchLabels: {
                        "kubernetes.io/metadata.name": "temporal",
                      },
                    },
                    podSelector: {
                      matchLabels: { component: "scout-worker" },
                    },
                  },
                ]
              : []),
          ],
          ports: [{ port: IntOrString.fromNumber(3000), protocol: "TCP" }],
        },
      ],
    },
  });

  // NetworkPolicy: Allow egress to DNS, Flipt, SeaweedFS S3, PostgreSQL, and external HTTPS
  new KubeNetworkPolicy(chart, "scout-egress-netpol", {
    metadata: { name: "scout-egress-netpol" },
    spec: {
      // Keep the operator-managed PostgreSQL pods outside this policy.
      podSelector: { matchLabels: { app: "scout-backend" } },
      policyTypes: ["Egress"],
      egress: [
        // DNS
        {
          to: [
            {
              namespaceSelector: {},
              podSelector: { matchLabels: { "k8s-app": "kube-dns" } },
            },
          ],
          ports: [
            { port: IntOrString.fromNumber(53), protocol: "UDP" },
            { port: IntOrString.fromNumber(53), protocol: "TCP" },
          ],
        },
        // SeaweedFS S3 (seaweedfs-s3.seaweedfs.svc.cluster.local:8333)
        {
          to: [
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "seaweedfs" },
              },
            },
          ],
          ports: [{ port: IntOrString.fromNumber(8333), protocol: "TCP" }],
        },
        // Flipt evaluation (flipt-flipt-service.flipt.svc.cluster.local:8080)
        {
          to: [
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "flipt" },
              },
            },
          ],
          ports: [
            { port: IntOrString.fromNumber(FLIPT_PORT), protocol: "TCP" },
          ],
        },
        // In-namespace PostgreSQL (scout-<stage>-postgresql:5432)
        {
          to: [{ podSelector: {} }],
          ports: [{ port: IntOrString.fromNumber(5432), protocol: "TCP" }],
        },
        // Temporal gRPC for the stage-local competition dispatcher and the
        // embedded Scout workers. Restrict both to the server pod and port.
        {
          to: [
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "temporal" },
              },
              podSelector: { matchLabels: { app: "temporal-server" } },
            },
          ],
          ports: [{ port: IntOrString.fromNumber(7233), protocol: "TCP" }],
        },
        // External HTTPS (Riot API, Discord, Sentry, OpenAI, Gemini, ElevenLabs)
        {
          to: [{ ipBlock: { cidr: "0.0.0.0/0" } }],
          ports: [{ port: IntOrString.fromNumber(443), protocol: "TCP" }],
        },
      ],
    },
  });

  if (workflowWorkerCreated) {
    new KubeNetworkPolicy(chart, "scout-workflow-worker-netpol", {
      metadata: {
        name: "scout-workflow-worker-netpol",
        annotations: { "argocd.argoproj.io/sync-wave": "-2" },
      },
      spec: {
        podSelector: {
          matchLabels: { "worker-family": "scout-beta-workflows" },
        },
        policyTypes: ["Ingress", "Egress"],
        ingress: [
          {
            from: [
              {
                namespaceSelector: {
                  matchLabels: {
                    "kubernetes.io/metadata.name": "prometheus",
                  },
                },
              },
            ],
            ports: [{ port: IntOrString.fromNumber(9464), protocol: "TCP" }],
          },
        ],
        egress: [
          createDnsEgressRule(),
          {
            to: [
              {
                namespaceSelector: {
                  matchLabels: {
                    "kubernetes.io/metadata.name": "temporal",
                  },
                },
                podSelector: { matchLabels: { app: "temporal-server" } },
              },
            ],
            ports: [{ port: IntOrString.fromNumber(7233), protocol: "TCP" }],
          },
        ],
      },
    });
  }
}
