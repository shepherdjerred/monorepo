import type { Chart } from "cdk8s";
import {
  KubeCronJob,
  KubeNamespace,
  Quantity,
} from "../../../generated/imports/k8s.ts";
import { OnePasswordItem } from "../../../generated/imports/onepassword.com.ts";
import versions from "../../versions.ts";

export function createDependencySummaryCronJob(chart: Chart) {
  // Create namespace for dependency summary
  new KubeNamespace(chart, "dependency-summary-namespace", {
    metadata: {
      name: "dependency-summary",
    },
  });

  // 1Password secret for API keys
  const secretItem = new OnePasswordItem(chart, "dependency-summary-secrets", {
    spec: {
      itemPath:
        "vaults/v64ocnykdqju4ui6j6pua56xw4/items/zuz7msnwhrkmjsxxgmxxv2mnkm",
    },
    metadata: {
      name: "dependency-summary-secrets",
      namespace: "dependency-summary",
    },
  });

  // CronJob to run every Monday at 9am
  new KubeCronJob(chart, "dependency-summary-cronjob", {
    metadata: {
      name: "dependency-summary",
      namespace: "dependency-summary",
      annotations: {
        "ignore-check.kube-linter.io/run-as-non-root":
          "Container runs as default user",
        "ignore-check.kube-linter.io/no-read-only-root-fs":
          "Container requires writable filesystem",
      },
    },
    spec: {
      // Every Monday at 9am UTC
      schedule: "0 9 * * 1",
      timeZone: "America/Los_Angeles",
      concurrencyPolicy: "Forbid",
      successfulJobsHistoryLimit: 3,
      failedJobsHistoryLimit: 1,
      jobTemplate: {
        spec: {
          activeDeadlineSeconds: 1200,
          backoffLimit: 2,
          template: {
            spec: {
              restartPolicy: "OnFailure",
              containers: [
                {
                  name: "dependency-summary",
                  image: `ghcr.io/shepherdjerred/dependency-summary:${versions["shepherdjerred/dependency-summary"]}`,
                  command: [
                    "timeout",
                    "300",
                    "bun",
                    "run",
                    "src/deps-email/src/main.ts",
                  ],
                  env: [
                    {
                      name: "OPENAI_API_KEY",
                      valueFrom: {
                        secretKeyRef: {
                          name: secretItem.name,
                          key: "openai_api_key",
                        },
                      },
                    },
                    {
                      name: "GITHUB_TOKEN",
                      valueFrom: {
                        secretKeyRef: {
                          name: secretItem.name,
                          key: "github_token",
                        },
                      },
                    },
                    {
                      name: "POSTAL_HOST",
                      value:
                        "http://postal-postal-web-service.postal.svc.cluster.local:5000",
                    },
                    {
                      name: "POSTAL_HOST_HEADER",
                      value: "postal.tailnet-1a49.ts.net",
                    },
                    {
                      name: "POSTAL_API_KEY",
                      valueFrom: {
                        secretKeyRef: {
                          name: secretItem.name,
                          key: "postal_api_key",
                        },
                      },
                    },
                    {
                      name: "RECIPIENT_EMAIL",
                      value: "dependencies@sjer.red",
                    },
                    {
                      name: "SENDER_EMAIL",
                      value: "dependencies@sjer.red",
                    },
                  ],
                  resources: {
                    requests: {
                      cpu: Quantity.fromString("100m"),
                      memory: Quantity.fromString("512Mi"),
                    },
                    limits: {
                      cpu: Quantity.fromString("500m"),
                      memory: Quantity.fromString("1Gi"),
                    },
                  },
                },
              ],
            },
          },
        },
      },
    },
  });
}
