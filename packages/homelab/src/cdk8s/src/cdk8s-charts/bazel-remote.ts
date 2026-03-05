import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { Namespace } from "cdk8s-plus-31";
import {
  KubeDeployment,
  KubeService,
  KubeNetworkPolicy,
  IntOrString,
  Quantity,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { createIngress } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";

const S3_CREDENTIALS_SECRET_NAME = "seaweedfs-s3-credentials";

export function createBazelRemoteChart(app: App) {
  const chart = new Chart(app, "bazel-remote", {
    namespace: "bazel-remote",
    disableResourceNameHashes: true,
  });

  new Namespace(chart, "bazel-remote-namespace", {
    metadata: {
      name: "bazel-remote",
    },
  });

  // 1Password secret for S3 credentials (same SeaweedFS credentials used by other services)
  new OnePasswordItem(chart, "bazel-remote-s3-credentials", {
    spec: {
      itemPath:
        "vaults/v64ocnykdqju4ui6j6pua56xw4/items/seaweedfs-s3-credentials",
    },
    metadata: {
      name: S3_CREDENTIALS_SECRET_NAME,
      namespace: "bazel-remote",
    },
  });

  new KubeDeployment(chart, "bazel-remote-deployment", {
    metadata: { name: "bazel-remote" },
    spec: {
      replicas: 1,
      selector: {
        matchLabels: { app: "bazel-remote" },
      },
      template: {
        metadata: {
          labels: { app: "bazel-remote" },
        },
        spec: {
          // Disable K8s service links to prevent BAZEL_REMOTE_* env var collisions
          // (the Service named "bazel-remote" causes K8s to inject vars that conflict with the app)
          enableServiceLinks: false,
          containers: [
            {
              name: "bazel-remote",
              image: "buchgr/bazel-remote-cache:v2.6.1",
              args: [
                "--s3.endpoint=seaweedfs-s3.seaweedfs.svc.cluster.local:8333",
                "--s3.bucket=bazel-cache",
                "--s3.auth_method=access_key",
                "--s3.disable_ssl",
                "--max_size=50",
                "--experimental_remote_asset_api",
              ],
              ports: [
                { containerPort: 8080, name: "http", protocol: "TCP" },
                { containerPort: 9092, name: "grpc", protocol: "TCP" },
              ],
              env: [
                {
                  name: "BAZEL_REMOTE_S3_ACCESS_KEY_ID",
                  valueFrom: {
                    secretKeyRef: {
                      name: S3_CREDENTIALS_SECRET_NAME,
                      key: "access_key",
                    },
                  },
                },
                {
                  name: "BAZEL_REMOTE_S3_SECRET_ACCESS_KEY",
                  valueFrom: {
                    secretKeyRef: {
                      name: S3_CREDENTIALS_SECRET_NAME,
                      key: "secret_key",
                    },
                  },
                },
              ],
              resources: {
                requests: {
                  cpu: Quantity.fromString("250m"),
                  memory: Quantity.fromString("2Gi"),
                },
                limits: {
                  cpu: Quantity.fromString("2"),
                  memory: Quantity.fromString("8Gi"),
                },
              },
              readinessProbe: {
                httpGet: {
                  path: "/status",
                  port: IntOrString.fromNumber(8080),
                },
                initialDelaySeconds: 5,
                periodSeconds: 10,
              },
              livenessProbe: {
                httpGet: {
                  path: "/status",
                  port: IntOrString.fromNumber(8080),
                },
                initialDelaySeconds: 10,
                periodSeconds: 30,
              },
            },
          ],
        },
      },
    },
  });

  new KubeService(chart, "bazel-remote-service", {
    metadata: { name: "bazel-remote" },
    spec: {
      selector: { app: "bazel-remote" },
      ports: [
        { name: "http", port: 8080, targetPort: IntOrString.fromNumber(8080) },
        { name: "grpc", port: 9092, targetPort: IntOrString.fromNumber(9092) },
      ],
    },
  });

  // Tailscale ingress for external access (e.g., local dev)
  createIngress(chart, "bazel-remote-ingress", {
    namespace: "bazel-remote",
    service: "bazel-remote",
    port: 8080,
    hosts: ["bazel-remote"],
  });

  // NetworkPolicy: Allow ingress from Buildkite (CI pods) and Tailscale
  new KubeNetworkPolicy(chart, "bazel-remote-ingress-netpol", {
    metadata: { name: "bazel-remote-ingress-netpol" },
    spec: {
      podSelector: {},
      policyTypes: ["Ingress"],
      ingress: [
        {
          from: [
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "buildkite" },
              },
            },
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "tailscale" },
              },
            },
          ],
        },
      ],
    },
  });

  // NetworkPolicy: Allow egress to DNS and SeaweedFS S3
  new KubeNetworkPolicy(chart, "bazel-remote-egress-netpol", {
    metadata: { name: "bazel-remote-egress-netpol" },
    spec: {
      podSelector: {},
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
      ],
    },
  });
}
