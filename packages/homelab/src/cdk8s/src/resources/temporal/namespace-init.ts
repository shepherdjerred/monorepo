import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import type { Service } from "cdk8s-plus-31";
import { Cpu, Job, Secret, Volume } from "cdk8s-plus-31";
import { withCommonProps } from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

export type CreateTemporalNamespaceInitJobProps = {
  serverService: Service;
};

export function createTemporalNamespaceInitJob(
  chart: Chart,
  props: CreateTemporalNamespaceInitJobProps,
) {
  const UID = 1000;
  const GID = 1000;

  const job = new Job(chart, "temporal-namespace-init", {
    metadata: {
      name: "temporal-namespace-init",
      annotations: {
        // This job registers the Environment/Domain/Trigger/ReleaseCommit
        // typed Search Attributes registerSchedules() needs on every gateway
        // boot. A "Sync" hook (not PostSync) runs during the normal sync
        // phase, ordered by sync-wave alongside regular resources -- unlike
        // PreSync/PostSync, which run strictly before/after every wave. That
        // lets this job's wave (below) sit ahead of temporal-gateway's
        // (syncWave: -1 in ingress-workers.ts): PostSync would run only
        // after every wave-resource, including the gateway, is Healthy --
        // but the gateway can't become healthy until these attributes exist,
        // deadlocking the release. The job's own retry loop
        // (`until temporal operator cluster health`) tolerates starting
        // before temporal-server (implicit wave 0) is up.
        "argocd.argoproj.io/hook": "Sync",
        "argocd.argoproj.io/hook-delete-policy": "BeforeHookCreation",
        "argocd.argoproj.io/sync-wave": "-2",
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
          "set -eu",
          'echo "Waiting for Temporal frontend..."',
          "until temporal operator cluster health; do sleep 5; done",
          'echo "Temporal frontend is ready"',
          // Create default namespace if needed, then enforce current retention.
          'if temporal operator namespace describe --namespace default; then echo "Temporal default namespace already exists"; else temporal operator namespace create --namespace default --retention 720h; fi',
          "temporal operator namespace update --namespace default --retention 720h",
          'SEARCH_ATTRIBUTES="$(temporal operator search-attribute list --namespace default --output json)"',
          String.raw`for ATTRIBUTE in Environment Domain Trigger ReleaseCommit; do if printf "%s" "$SEARCH_ATTRIBUTES" | grep -q "\"$ATTRIBUTE\": \"INDEXED_VALUE_TYPE_KEYWORD\""; then echo "Temporal Search Attribute $ATTRIBUTE already exists"; else temporal operator search-attribute create --namespace default --name "$ATTRIBUTE" --type Keyword; fi; done`,
          'echo "Namespace init complete"',
        ].join(" && "),
      ],
      envVariables: {
        TEMPORAL_ADDRESS: {
          value: `${props.serverService.name}:7233`,
        },
        TEMPORAL_CLI_ADDRESS: {
          value: `${props.serverService.name}:7233`,
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
