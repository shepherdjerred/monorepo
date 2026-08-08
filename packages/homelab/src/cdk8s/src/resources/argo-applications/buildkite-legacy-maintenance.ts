import type { Chart } from "cdk8s";
import {
  KubeCronJob,
  Quantity,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import {
  CI_NODE_HOSTNAME,
  CI_NODE_TOLERATION,
} from "@shepherdjerred/homelab/cdk8s/src/misc/nodes.ts";

const CI_BASE_DIGEST_CONTENT = await Bun.file(
  new URL("ci-base.DIGEST", import.meta.url),
).text();
const CI_BASE_DIGEST = CI_BASE_DIGEST_CONTENT.trim();
if (!/^sha256:[\da-f]{64}$/.test(CI_BASE_DIGEST)) {
  throw new Error("ci-base.DIGEST must contain a canonical sha256 digest");
}

export function createLegacyBuildkiteMaintenanceJobs(chart: Chart): void {
  new KubeCronJob(chart, "buildkite-uv-cache-prune", {
    metadata: { name: "buildkite-uv-cache-prune", namespace: "buildkite" },
    spec: {
      schedule: "15 3 * * 0",
      timeZone: "America/Los_Angeles",
      concurrencyPolicy: "Forbid",
      successfulJobsHistoryLimit: 1,
      failedJobsHistoryLimit: 3,
      jobTemplate: {
        spec: {
          backoffLimit: 1,
          template: {
            spec: {
              restartPolicy: "Never",
              nodeSelector: { "kubernetes.io/hostname": CI_NODE_HOSTNAME },
              tolerations: [CI_NODE_TOLERATION],
              containers: [
                {
                  name: "uv-cache-prune",
                  image: `ghcr.io/shepherdjerred/ci-base@${CI_BASE_DIGEST}`,
                  imagePullPolicy: "IfNotPresent",
                  command: ["uv", "cache", "prune", "--ci"],
                  env: [{ name: "UV_CACHE_DIR", value: "/buildkite/uv-cache" }],
                  resources: {
                    requests: {
                      cpu: Quantity.fromString("50m"),
                      memory: Quantity.fromString("128Mi"),
                    },
                    limits: {
                      cpu: Quantity.fromString("500m"),
                      memory: Quantity.fromString("512Mi"),
                    },
                  },
                  volumeMounts: [
                    { name: "uv-cache", mountPath: "/buildkite/uv-cache" },
                  ],
                },
              ],
              volumes: [
                {
                  name: "uv-cache",
                  persistentVolumeClaim: { claimName: "buildkite-uv-cache" },
                },
              ],
            },
          },
        },
      },
    },
  });

  new KubeCronJob(chart, "buildkite-trivy-db-refresh", {
    metadata: { name: "buildkite-trivy-db-refresh", namespace: "buildkite" },
    spec: {
      schedule: "30 */6 * * *",
      timeZone: "America/Los_Angeles",
      concurrencyPolicy: "Forbid",
      successfulJobsHistoryLimit: 1,
      failedJobsHistoryLimit: 3,
      jobTemplate: {
        spec: {
          backoffLimit: 1,
          template: {
            spec: {
              restartPolicy: "Never",
              nodeSelector: { "kubernetes.io/hostname": CI_NODE_HOSTNAME },
              tolerations: [CI_NODE_TOLERATION],
              containers: [
                {
                  name: "trivy-db-refresh",
                  image: "aquasec/trivy:0.72.0",
                  command: ["trivy"],
                  args: [
                    "image",
                    "--download-db-only",
                    "--cache-dir",
                    "/buildkite/trivy-db",
                  ],
                  resources: {
                    requests: {
                      cpu: Quantity.fromString("50m"),
                      memory: Quantity.fromString("256Mi"),
                    },
                    limits: {
                      cpu: Quantity.fromString("500m"),
                      memory: Quantity.fromString("1Gi"),
                    },
                  },
                  volumeMounts: [
                    { name: "trivy-db", mountPath: "/buildkite/trivy-db" },
                  ],
                },
              ],
              volumes: [
                {
                  name: "trivy-db",
                  persistentVolumeClaim: { claimName: "buildkite-trivy-db" },
                },
              ],
            },
          },
        },
      },
    },
  });
}
