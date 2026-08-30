import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import type { Service } from "cdk8s-plus-31";
import { Cpu, Job } from "cdk8s-plus-31";
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
        // Create the application namespaces before namespace-scoped clients
        // and workers become healthy. The job waits for the server below, so
        // it is safe to run before the ordinary Temporal resources finish.
        "argocd.argoproj.io/hook": "PreSync",
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
          // The built-in default namespace is retained only as a migration
          // drain. Production creates the two active control-plane namespaces
          // and registers the search attributes required by schedule actions.
          'for namespace in prod beta; do if temporal operator namespace describe --namespace "$namespace"; then echo "Temporal $namespace namespace already exists"; else temporal operator namespace create --namespace "$namespace" --retention 720h; fi; temporal operator namespace update --namespace "$namespace" --retention 720h; SEARCH_ATTRIBUTES="$(temporal operator search-attribute list --namespace "$namespace" --output json)"; for ATTRIBUTE in Environment Domain Trigger ReleaseCommit; do if printf "%s" "$SEARCH_ATTRIBUTES" | grep -q "\"$ATTRIBUTE\": \"INDEXED_VALUE_TYPE_KEYWORD\""; then echo "Temporal Search Attribute $ATTRIBUTE already exists in $namespace"; else temporal operator search-attribute create --namespace "$namespace" --name "$ATTRIBUTE" --type Keyword; fi; done; done',
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
        readOnlyRootFilesystem: true,
      },
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
