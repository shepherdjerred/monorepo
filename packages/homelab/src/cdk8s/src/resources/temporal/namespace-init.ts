import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import { Cpu, Job, Secret, Volume } from "cdk8s-plus-31";
import { withCommonProps } from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

export function createTemporalNamespaceInitJob(chart: Chart) {
  const UID = 1000;
  const GID = 1000;

  const job = new Job(chart, "temporal-namespace-init", {
    metadata: {
      name: "temporal-namespace-init",
      annotations: {
        // Run after the temporal-server deployment is synced
        "argocd.argoproj.io/hook": "PostSync",
        "argocd.argoproj.io/hook-delete-policy": "BeforeHookCreation",
      },
    },
    securityContext: {
      fsGroup: GID,
    },
    backoffLimit: 6,
    activeDeadline: undefined,
    podMetadata: {
      labels: {
        app: "temporal-namespace-init",
      },
    },
  });

  // Mount postgres secret for admin-tools DB access
  const postgresSecretName =
    "temporal.temporal-postgresql.credentials.postgresql.acid.zalan.do";
  const pgSecretVolume = Volume.fromSecret(
    chart,
    "namespace-init-pg-secret-volume",
    Secret.fromSecretName(
      chart,
      "namespace-init-pg-secret",
      postgresSecretName,
    ),
    {
      name: "pg-secret",
    },
  );

  job.addContainer(
    withCommonProps({
      name: "namespace-init",
      image: `temporalio/admin-tools:${versions["temporalio/admin-tools"]}`,
      command: ["/bin/sh", "-c"],
      args: [
        [
          // Wait for Temporal frontend to be ready
          'echo "Waiting for Temporal frontend..."',
          "until temporal operator cluster health 2>/dev/null; do sleep 5; done",
          'echo "Temporal frontend is ready"',
          // Create default namespace (idempotent — exits 0 if it already exists)
          "temporal operator namespace create --namespace default --retention 72h 2>/dev/null; true",
          'echo "Namespace init complete"',
        ].join(" && "),
      ],
      envVariables: {
        TEMPORAL_ADDRESS: {
          value: "temporal-server-service:7233",
        },
        TEMPORAL_CLI_ADDRESS: {
          value: "temporal-server-service:7233",
        },
      },
      securityContext: {
        user: UID,
        group: GID,
        ensureNonRoot: true,
        readOnlyRootFilesystem: false,
      },
      volumeMounts: [
        {
          path: "/pg-secret",
          volume: pgSecretVolume,
          readOnly: true,
        },
      ],
      resources: {
        cpu: {
          request: Cpu.millis(50),
          limit: Cpu.millis(250),
        },
        memory: {
          request: Size.mebibytes(64),
          limit: Size.mebibytes(256),
        },
      },
    }),
  );

  return job;
}
