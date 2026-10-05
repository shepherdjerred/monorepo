import type { Chart } from "cdk8s";
import { Duration } from "cdk8s";
import {
  Deployment,
  DeploymentStrategy,
  EnvValue,
  type IPersistentVolumeClaim,
  Service,
  Volume,
} from "cdk8s-plus-31";
import { ARGOCD_SYNC_WAVE_ANNOTATION } from "@shepherdjerred/homelab/cdk8s/src/application-release-policy.ts";
import type { Stage } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/scout.ts";
import {
  withCommonProps,
  setRevisionHistoryLimit,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { addAnthropicFederation } from "@shepherdjerred/homelab/cdk8s/src/misc/llm-provider-credentials.ts";
import { createServiceMonitor } from "@shepherdjerred/homelab/cdk8s/src/misc/probes/service-monitor.ts";
import {
  applyZfsVolumeSelinuxRelabeling,
  type ZfsVolumeSelinuxLevel,
} from "@shepherdjerred/homelab/cdk8s/src/misc/selinux.ts";
import {
  SCOUT_DUCKDB_SCRATCH,
  SCOUT_RUNTIME_ROLE_LABEL,
} from "@shepherdjerred/homelab/cdk8s/src/resources/scout/gateway.ts";
import { scoutAdminRoleContainerBase } from "@shepherdjerred/homelab/cdk8s/src/resources/scout/probes.ts";

export const SCOUT_ACTIVITY_WORKER_APP_LABEL = "scout-activity-worker";

/** The worker is admitted only after the application pod and policy exist. */
export const SCOUT_ACTIVITY_WORKER_SYNC_WAVE = "1";

export type ScoutActivityWorkerDeploymentOptions = {
  readonly imageVersion: string;
  readonly envVariables: Record<string, EnvValue>;
  readonly claim: IPersistentVolumeClaim;
  readonly selinuxLevel: ZfsVolumeSelinuxLevel;
  readonly colocateWith: Deployment;
};

/**
 * Polls realtime, background and competition activities after the queue
 * handoff. The worker writes lake staging data, so its mount is read-write.
 */
export function createScoutActivityWorkerDeployment(
  chart: Chart,
  stage: Stage,
  options: ScoutActivityWorkerDeploymentOptions,
) {
  const deployment = new Deployment(chart, "scout-activity-worker", {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    progressDeadline: Duration.seconds(2400),
    terminationGracePeriod: Duration.seconds(45),
    securityContext: {},
    podMetadata: {
      labels: {
        app: SCOUT_ACTIVITY_WORKER_APP_LABEL,
        [SCOUT_RUNTIME_ROLE_LABEL]: "activity-worker",
      },
    },
    metadata: {
      annotations: {
        "ignore-check.kube-linter.io/run-as-non-root":
          "Scout requires flexible user permissions",
        "ignore-check.kube-linter.io/no-read-only-root-fs":
          "Scout requires a writable filesystem for report rendering",
        [ARGOCD_SYNC_WAVE_ANNOTATION]: SCOUT_ACTIVITY_WORKER_SYNC_WAVE,
      },
    },
  });

  // OpenEBS ZFS LocalPV mounts the claim on one node. The stage's ZFSVolume
  // must have spec.shared=yes; affinity makes co-location a
  // scheduling constraint rather than an accident of current node placement.
  deployment.scheduling.colocate(options.colocateWith);

  deployment.addContainer(
    withCommonProps({
      ...scoutAdminRoleContainerBase(options.imageVersion, "activity-worker"),
      volumeMounts: [
        {
          path: "/data",
          volume: Volume.fromPersistentVolumeClaim(
            chart,
            "scout-activity-worker-volume",
            options.claim,
          ),
        },
        {
          path: SCOUT_DUCKDB_SCRATCH.path,
          volume: Volume.fromEmptyDir(
            chart,
            "scout-activity-worker-duckdb-scratch",
            "duckdb-scratch",
            { sizeLimit: SCOUT_DUCKDB_SCRATCH.sizeLimit },
          ),
        },
      ],
      envVariables: {
        ...options.envVariables,
        SCOUT_RUNTIME_ROLE: EnvValue.fromValue("activity-worker"),
        TELEMETRY_SERVICE_NAME: EnvValue.fromValue("scout-activity-worker"),
      },
    }),
  );

  // Both writers use identical MCS categories on the same ZFS dataset.
  applyZfsVolumeSelinuxRelabeling(deployment, options.selinuxLevel);
  addAnthropicFederation(deployment, { workload: `scout-${stage}` });
  setRevisionHistoryLimit(deployment);

  new Service(chart, `scout-activity-worker-service-${stage}`, {
    metadata: {
      name: `scout-activity-worker-service-${stage}`,
      labels: { app: SCOUT_ACTIVITY_WORKER_APP_LABEL, stage },
    },
    selector: deployment,
    ports: [{ name: "metrics", port: 3000 }],
  });
  createServiceMonitor(chart, {
    name: `scout-activity-worker-${stage}`,
    matchLabels: { app: SCOUT_ACTIVITY_WORKER_APP_LABEL, stage },
  });

  return deployment;
}
