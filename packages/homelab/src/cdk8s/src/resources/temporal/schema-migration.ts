import type { Chart } from "cdk8s";
import { Duration, Size } from "cdk8s";
import { Cpu, EnvValue, Job, Secret, Volume } from "cdk8s-plus-31";
import { withCommonProps } from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import {
  TEMPORAL_POSTGRES_TLS_CA_FILE,
  TEMPORAL_POSTGRES_TLS_SECRET,
  TEMPORAL_POSTGRES_TLS_SERVER_NAME,
} from "@shepherdjerred/homelab/cdk8s/src/resources/postgres/temporal-db-tls.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

const POSTGRES_SECRET_NAME =
  "temporal.temporal-postgresql.credentials.postgresql.acid.zalan.do";
const POSTGRES_TLS_DIRECTORY = "/etc/temporal/postgres-tls";
// Trust the stable CA (see temporal-db-tls.ts), not the rotating leaf's own
// tls.crt — this Job is short-lived and re-reads the mounted secret fresh on
// every run, but a leaf rotation between runs would still make tls.crt
// untrustworthy the moment cert-manager regenerates it.
const POSTGRES_TLS_CA_FILE_PATH = `${POSTGRES_TLS_DIRECTORY}/${TEMPORAL_POSTGRES_TLS_CA_FILE}`;

const SCHEMA_MIGRATION_SCRIPT = String.raw`
set -eu -o pipefail

temporal-sql-tool \\
  --plugin postgres12 \\
  --ep ${TEMPORAL_POSTGRES_TLS_SERVER_NAME} \\
  -p 5432 \\
  -u "$POSTGRES_USER" \\
  --db temporal \\
  --tls=true \\
  --tls-ca-file "$POSTGRES_TLS_CA_FILE" \\
  --tls-server-name "$POSTGRES_TLS_SERVER_NAME" \\
  setup-schema -v 0.0

temporal-sql-tool \\
  --plugin postgres12 \\
  --ep ${TEMPORAL_POSTGRES_TLS_SERVER_NAME} \\
  -p 5432 \\
  -u "$POSTGRES_USER" \\
  --db temporal \\
  --tls=true \\
  --tls-ca-file "$POSTGRES_TLS_CA_FILE" \\
  --tls-server-name "$POSTGRES_TLS_SERVER_NAME" \\
  update-schema -d /etc/temporal/schema/postgresql/v12/temporal/versioned

temporal-sql-tool \\
  --plugin postgres12 \\
  --ep ${TEMPORAL_POSTGRES_TLS_SERVER_NAME} \\
  -p 5432 \\
  -u "$POSTGRES_USER" \\
  --db temporal_visibility \\
  --tls=true \\
  --tls-ca-file "$POSTGRES_TLS_CA_FILE" \\
  --tls-server-name "$POSTGRES_TLS_SERVER_NAME" \\
  setup-schema -v 0.0

temporal-sql-tool \\
  --plugin postgres12 \\
  --ep ${TEMPORAL_POSTGRES_TLS_SERVER_NAME} \\
  -p 5432 \\
  -u "$POSTGRES_USER" \\
  --db temporal_visibility \\
  --tls=true \\
  --tls-ca-file "$POSTGRES_TLS_CA_FILE" \\
  --tls-server-name "$POSTGRES_TLS_SERVER_NAME" \\
  update-schema -d /etc/temporal/schema/postgresql/v12/visibility/versioned
`.trim();

export function createTemporalSchemaMigrationJob(chart: Chart) {
  const postgresSecret = Secret.fromSecretName(
    chart,
    "temporal-schema-postgres-secret",
    POSTGRES_SECRET_NAME,
  );
  const tlsVolume = Volume.fromSecret(
    chart,
    "temporal-schema-postgres-tls-volume",
    Secret.fromSecretName(
      chart,
      "temporal-schema-postgres-tls-secret",
      TEMPORAL_POSTGRES_TLS_SECRET,
    ),
    { name: "postgres-tls" },
  );

  const job = new Job(chart, "temporal-schema-migration", {
    metadata: {
      name: "temporal-schema-migration",
      annotations: {
        // A "Sync" hook, not PreSync. PreSync runs as its own phase that
        // completes before the Sync phase applies ANY ordinary resource, and
        // three things this job needs are ordinary resources: the
        // `temporal-postgresql-tls` secret cert-manager issues from the
        // Certificate at wave -3, the database at wave -2, and this job's own
        // egress policy at wave -2. As a PreSync hook it therefore waited on a
        // secret that could not exist yet and sat in ContainerCreating with
        // `MountVolume.SetUp failed ... secret "temporal-postgresql-tls" not
        // found` until its deadline, failing every temporal sync. A Sync hook
        // at wave -1 is still blocking and still ahead of the server at wave
        // 0, but now runs after everything it depends on. The backup-preflight
        // PreSync gate still precedes the whole phase.
        "argocd.argoproj.io/hook": "Sync",
        "argocd.argoproj.io/sync-wave": "-1",
        "argocd.argoproj.io/hook-delete-policy":
          "BeforeHookCreation,HookSucceeded",
      },
    },
    automountServiceAccountToken: false,
    backoffLimit: 1,
    activeDeadline: Duration.seconds(900),
    podMetadata: { labels: { app: "temporal-schema-migration" } },
  });

  job.addContainer(
    withCommonProps({
      name: "schema-migration",
      image: `temporalio/admin-tools:${versions["temporalio/admin-tools"]}`,
      command: ["/bin/bash", "-c"],
      args: [SCHEMA_MIGRATION_SCRIPT],
      envVariables: {
        POSTGRES_USER: EnvValue.fromSecretValue({
          secret: postgresSecret,
          key: "username",
        }),
        SQL_PASSWORD: EnvValue.fromSecretValue({
          secret: postgresSecret,
          key: "password",
        }),
        POSTGRES_TLS_CA_FILE: EnvValue.fromValue(POSTGRES_TLS_CA_FILE_PATH),
        POSTGRES_TLS_SERVER_NAME: EnvValue.fromValue(
          TEMPORAL_POSTGRES_TLS_SERVER_NAME,
        ),
      },
      securityContext: {
        user: 1000,
        group: 1000,
        ensureNonRoot: true,
        readOnlyRootFilesystem: true,
      },
      volumeMounts: [
        {
          path: POSTGRES_TLS_DIRECTORY,
          volume: tlsVolume,
          readOnly: true,
        },
      ],
      resources: {
        cpu: { request: Cpu.millis(25), limit: Cpu.millis(250) },
        memory: { request: Size.mebibytes(64), limit: Size.mebibytes(256) },
      },
    }),
  );

  return job;
}
