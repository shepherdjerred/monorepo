import type { Chart } from "cdk8s";
import { KubeCronJob, Quantity } from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import type { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { buildDbUrlScript } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

export function createBugsinkHousekeepingCronJob(
  chart: Chart,
  bugsinkSecrets: OnePasswordItem,
) {
  const UID = 14_237;
  const GID = 14_237;

  // PostgreSQL credentials
  const postgresSecretName =
    "bugsink.bugsink-postgresql.credentials.postgresql.acid.zalan.do";

  // CronJob for daily housekeeping at 3am
  new KubeCronJob(chart, "bugsink-housekeeping", {
    metadata: {
      name: "bugsink-housekeeping",
      annotations: {
        "ignore-check.kube-linter.io/no-read-only-root-fs":
          "Containers require writable filesystem for database URL and command execution",
      },
    },
    spec: {
      schedule: "0 3 * * *",
      timeZone: "America/Los_Angeles",
      concurrencyPolicy: "Forbid",
      successfulJobsHistoryLimit: 3,
      failedJobsHistoryLimit: 3,
      jobTemplate: {
        spec: {
          backoffLimit: 2,
          template: {
            spec: {
              restartPolicy: "OnFailure",
              securityContext: {
                runAsUser: UID,
                runAsGroup: GID,
                fsGroup: GID,
                runAsNonRoot: true,
              },
              initContainers: [
                {
                  name: "build-db-url",
                  image: `library/busybox:${versions["library/busybox"]}`,
                  command: ["/bin/sh", "-c"],
                  args: [
                    buildDbUrlScript("bugsink-postgresql:5432", "bugsink_db", "/db-url/url"),
                  ],
                  volumeMounts: [
                    {
                      name: "pg-secret",
                      mountPath: "/pg-secret",
                      readOnly: true,
                    },
                    {
                      name: "db-url",
                      mountPath: "/db-url",
                    },
                  ],
                  securityContext: {
                    allowPrivilegeEscalation: false,
                    readOnlyRootFilesystem: false,
                  },
                },
              ],
              containers: [
                {
                  name: "housekeeping",
                  image: `bugsink/bugsink:${versions["bugsink/bugsink"]}`,
                  command: ["/bin/sh", "-c"],
                  args: [
                    `
export DATABASE_URL=$(cat /db-url/url)
echo "Running vacuum_tags..."
bugsink-manage vacuum_tags
echo "Running vacuum_files..."
bugsink-manage vacuum_files
echo "Running vacuum_eventless_issuetags..."
bugsink-manage vacuum_eventless_issuetags
echo "Running cleanup_eventstorage..."
bugsink-manage cleanup_eventstorage default
echo "Housekeeping complete!"
`,
                  ],
                  env: [
                    {
                      name: "SECRET_KEY",
                      valueFrom: {
                        secretKeyRef: {
                          name: bugsinkSecrets.name,
                          key: "secret-key",
                        },
                      },
                    },
                    {
                      name: "DEBUG",
                      value: "False",
                    },
                  ],
                  volumeMounts: [
                    {
                      name: "db-url",
                      mountPath: "/db-url",
                      readOnly: true,
                    },
                  ],
                  resources: {
                    requests: {
                      cpu: Quantity.fromString("100m"),
                      memory: Quantity.fromString("256Mi"),
                    },
                    limits: {
                      cpu: Quantity.fromString("500m"),
                      memory: Quantity.fromString("512Mi"),
                    },
                  },
                  securityContext: {
                    allowPrivilegeEscalation: false,
                    readOnlyRootFilesystem: false,
                  },
                },
              ],
              volumes: [
                {
                  name: "pg-secret",
                  secret: {
                    secretName: postgresSecretName,
                  },
                },
                {
                  name: "db-url",
                  emptyDir: {},
                },
              ],
            },
          },
        },
      },
    },
  });
}
