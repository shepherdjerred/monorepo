import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import {
  IntOrString,
  KubeDeployment,
  KubeService,
  Quantity,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { ZfsNvmeVolume } from "@shepherdjerred/homelab/cdk8s/src/misc/storage/zfs-nvme-volume.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

export function createForumDatabase(chart: Chart, secretName: string): void {
  const data = new ZfsNvmeVolume(chart, "storm-forum-database", {
    storage: Size.gibibytes(32),
  });
  const labels = { app: "storm-forum", component: "database" };
  new KubeDeployment(chart, "database", {
    metadata: { name: "storm-forum-database" },
    spec: {
      replicas: 1,
      revisionHistoryLimit: 5,
      strategy: { type: "Recreate" },
      selector: { matchLabels: labels },
      template: {
        metadata: { labels },
        spec: {
          automountServiceAccountToken: false,
          securityContext: {
            runAsNonRoot: true,
            runAsUser: 999,
            runAsGroup: 999,
            fsGroup: 999,
            seccompProfile: { type: "RuntimeDefault" },
          },
          containers: [
            {
              name: "mariadb",
              image: `mariadb:${versions["library/mariadb"]}`,
              env: [
                { name: "MARIADB_DATABASE", value: "storm" },
                { name: "MARIADB_USER", value: "storm" },
                ...["MARIADB_PASSWORD", "MARIADB_ROOT_PASSWORD"].map(
                  (name) => ({
                    name,
                    valueFrom: {
                      secretKeyRef: {
                        name: secretName,
                        key: name === "MARIADB_PASSWORD" ? "DB_PASSWORD" : name,
                      },
                    },
                  }),
                ),
              ],
              ports: [{ name: "mysql", containerPort: 3306 }],
              resources: {
                requests: {
                  cpu: Quantity.fromString("100m"),
                  memory: Quantity.fromString("512Mi"),
                },
                limits: {
                  cpu: Quantity.fromString("2"),
                  memory: Quantity.fromString("2Gi"),
                },
              },
              securityContext: {
                allowPrivilegeEscalation: false,
                readOnlyRootFilesystem: true,
                capabilities: { drop: ["ALL"] },
              },
              volumeMounts: [
                { name: "database", mountPath: "/var/lib/mysql" },
                { name: "database-run", mountPath: "/run/mysqld" },
                { name: "database-tmp", mountPath: "/tmp" },
              ],
              startupProbe: {
                exec: {
                  command: [
                    "healthcheck.sh",
                    "--connect",
                    "--innodb_initialized",
                  ],
                },
                periodSeconds: 5,
                failureThreshold: 60,
              },
              readinessProbe: {
                exec: {
                  command: [
                    "healthcheck.sh",
                    "--connect",
                    "--innodb_initialized",
                  ],
                },
                periodSeconds: 10,
              },
              livenessProbe: {
                tcpSocket: { port: IntOrString.fromNumber(3306) },
                periodSeconds: 30,
              },
            },
          ],
          volumes: [
            {
              name: "database",
              persistentVolumeClaim: { claimName: data.claim.name },
            },
            { name: "database-run", emptyDir: {} },
            { name: "database-tmp", emptyDir: {} },
          ],
        },
      },
    },
  });
  new KubeService(chart, "database-service", {
    metadata: { name: "storm-forum-database" },
    spec: {
      selector: labels,
      ports: [{ port: 3306, targetPort: IntOrString.fromNumber(3306) }],
    },
  });
}
