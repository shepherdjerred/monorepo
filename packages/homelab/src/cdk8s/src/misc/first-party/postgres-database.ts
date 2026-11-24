import type { Chart } from "cdk8s";
import { EnvValue, type ISecret, Secret } from "cdk8s-plus-31";
import type { PostgresqlSpecUsers } from "@shepherdjerred/homelab/cdk8s/generated/imports/acid.zalan.do";
import { KubeNetworkPolicy } from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import {
  postgresEgress,
  postgresOperatorIngressRule,
  tcp,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";
import { postgresClusterPodLabels } from "@shepherdjerred/homelab/cdk8s/src/resources/postgres/cluster-label.ts";
import { createSingleAppPostgreSQL } from "@shepherdjerred/homelab/cdk8s/src/resources/postgres/single-app-postgresql.ts";

const PG_PROTOCOL = "postgresql";
const PG_PORT = 5432;

/**
 * A PostgreSQL connection URL whose credentials are kubelet `$(VAR)`
 * references to the container's `DB_USER` and `DB_PASSWORD`, so the password
 * never appears in a manifest. Both variables must be declared before the one
 * holding this URL; Kubernetes expands only earlier variables.
 * @param host The database host, with its port
 * @param database The database name
 */
export function buildPostgresUrlExpr(host: string, database: string): string {
  const user = "$(DB_USER)";
  const password = "$(DB_" + "PASSWORD)";
  return `${PG_PROTOCOL}://${user}:${password}@${host}/${database}`;
}

type SingleAppDatabaseOptions = {
  /** Cluster `<app>-postgresql`, owner role `<app>`, database `<app>_db`. */
  app: string;
} & (
  | {
      /** Render the cluster in this chart with the owner's role flags. */
      provision: true;
      userFlags: PostgresqlSpecUsers[];
    }
  | {
      /** Connect to a cluster another chart owns. */
      provision: false;
    }
);

/** An app's connection to its own `createSingleAppPostgreSQL` cluster. */
export type SingleAppDatabase = {
  /** `<app>-postgresql`: the cluster, its Service and its pod label value. */
  readonly clusterName: string;
  /** The operator-generated owner credentials (`username`, `password`). */
  readonly credentials: ISecret;
  /**
   * `DB_USER`, `DB_PASSWORD` and the `DATABASE_URL` that expands them, in
   * that order.
   */
  readonly env: Record<string, EnvValue>;
  /** Egress from an app pod to the cluster's pods on 5432. */
  readonly egress: ReturnType<typeof postgresEgress>;
  /**
   * An Ingress NetworkPolicy on the cluster's pods admitting the app pods
   * matching `clients` on 5432, the postgres-operator, and the cluster's own
   * pods for replication and Patroni.
   */
  createClusterIngressPolicy: (
    id: string,
    clients: Record<string, string>,
    metadata?: { name: string },
  ) => KubeNetworkPolicy;
};

/**
 * A first-party app's single-instance PostgreSQL cluster and everything the
 * app needs to reach it: the operator's credentials Secret, the database
 * environment, and the NetworkPolicy rules on both sides.
 *
 * With `provision: false` the cluster belongs to another chart (Delivery's
 * operator-run data chart) and only the connection is built.
 */
export function singleAppDatabase(
  chart: Chart,
  options: SingleAppDatabaseOptions,
): SingleAppDatabase {
  const { app } = options;
  const clusterName = `${app}-postgresql`;
  if (options.provision)
    createSingleAppPostgreSQL(chart, { app, userFlags: options.userFlags });
  const credentials = Secret.fromSecretName(
    chart,
    `${clusterName}-credentials`,
    `${app}.${clusterName}.credentials.postgresql.acid.zalan.do`,
  );
  return {
    clusterName,
    credentials,
    env: {
      DB_USER: EnvValue.fromSecretValue({
        secret: credentials,
        key: "username",
      }),
      DB_PASSWORD: EnvValue.fromSecretValue({
        secret: credentials,
        key: "password",
      }),
      DATABASE_URL: EnvValue.fromValue(
        buildPostgresUrlExpr(`${clusterName}:${String(PG_PORT)}`, `${app}_db`),
      ),
    },
    egress: postgresEgress(clusterName),
    createClusterIngressPolicy: (id, clients, metadata) =>
      new KubeNetworkPolicy(chart, id, {
        ...(metadata === undefined ? {} : { metadata }),
        spec: {
          podSelector: { matchLabels: postgresClusterPodLabels(clusterName) },
          policyTypes: ["Ingress"],
          ingress: [
            {
              from: [{ podSelector: { matchLabels: clients } }],
              ports: [tcp(PG_PORT)],
            },
            postgresOperatorIngressRule(),
            {
              from: [
                {
                  podSelector: {
                    matchLabels: postgresClusterPodLabels(clusterName),
                  },
                },
              ],
              ports: [tcp(PG_PORT), tcp(8008)],
            },
          ],
        },
      }),
  };
}
