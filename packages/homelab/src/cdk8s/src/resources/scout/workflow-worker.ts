import type { Chart } from "cdk8s";
import { Duration, Size } from "cdk8s";
import { z } from "zod";
import {
  Cpu,
  Deployment,
  DeploymentStrategy,
  EnvValue,
  Probe,
  Protocol,
  Service,
  Volume,
} from "cdk8s-plus-31";
import { createServiceMonitor } from "@shepherdjerred/homelab/cdk8s/src/misc/probes/service-monitor.ts";
import {
  setRevisionHistoryLimit,
  withCommonProps,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import type { Stage } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/scout.ts";

export type ScoutWorkflowWorkerTrack =
  "stable" | "candidate" | `retained-${string}`;

// Build 12197 predates the workflow-only entrypoint. The main image release
// overrides the candidate pin while rendering, so the first capable build can
// create the pod in the same release without ever attempting to boot 12197.
const LAST_IMAGE_WITHOUT_WORKFLOW_WORKER = 12_197;
const WorkflowImageVersionSchema = z
  .string()
  .regex(/^2\.0\.0-(\d+)@sha256:[0-9a-f]{64}$/);

export function scoutWorkflowWorkerImageIsCapable(
  imageVersion: string,
): boolean {
  const parsed = WorkflowImageVersionSchema.parse(imageVersion);
  const buildText = parsed.split("@", 1)[0]?.split("-", 2)[1];
  const build = z.coerce.number().int().positive().parse(buildText);
  return build > LAST_IMAGE_WITHOUT_WORKFLOW_WORKER;
}

export function createScoutWorkflowWorker(
  chart: Chart,
  stage: Stage,
  track: ScoutWorkflowWorkerTrack,
  imageVersionOverride?: string,
): Deployment | undefined {
  const component = `scout-${stage}-workflows-${track}`;
  const name = `scout-workflow-worker-${track}`;
  const imageKey = `shepherdjerred/scout-for-lol/${stage}/workflows/${track}`;
  const imageVersion = imageVersionOverride ?? versions[imageKey];
  if (imageVersion === undefined) {
    throw new Error(`Missing Scout Workflow Worker image pin ${imageKey}`);
  }
  if (!scoutWorkflowWorkerImageIsCapable(imageVersion)) {
    return undefined;
  }

  const deployment = new Deployment(chart, name, {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    automountServiceAccountToken: false,
    securityContext: { fsGroup: 1000 },
    metadata: {
      annotations: {
        // Retained current builds must start before either mutable track can
        // replace its only poller. These workers share the normal family policy.
        "argocd.argoproj.io/sync-wave": track.startsWith("retained-")
          ? "-2"
          : "-1",
      },
    },
    podMetadata: {
      labels: {
        app: "scout-workflow-worker",
        component,
        "worker-family": `scout-${stage}-workflows`,
        track,
      },
    },
  });
  setRevisionHistoryLimit(deployment, 5);

  const container = deployment.addContainer(
    withCommonProps({
      name,
      image: `ghcr.io/shepherdjerred/scout-for-lol:${imageVersion}`,
      command: ["bun"],
      args: ["run", "src/temporal/workflow-worker.ts"],
      ports: [{ name: "metrics", number: 9464, protocol: Protocol.TCP }],
      readiness: Probe.fromCommand(
        [
          "bun",
          "-e",
          String.raw`const response=await fetch('http://127.0.0.1:9464/metrics',{signal:AbortSignal.timeout(2000)});const ready=response.ok&&(await response.text()).split('\n').some(line=>line.startsWith('temporal_worker_num_pollers{')&&line.includes('poller_type="workflow_task"')&&Number(line.slice(line.lastIndexOf(' ')+1))>0);process.exit(ready?0:1)`,
        ],
        {
          periodSeconds: Duration.seconds(5),
          timeoutSeconds: Duration.seconds(3),
          failureThreshold: 3,
        },
      ),
      securityContext: {
        user: 1000,
        group: 1000,
        ensureNonRoot: true,
        readOnlyRootFilesystem: true,
      },
      resources: {
        cpu: { request: Cpu.millis(100), limit: Cpu.millis(500) },
        memory: { request: Size.mebibytes(256), limit: Size.gibibytes(1) },
      },
      envVariables: {
        ENVIRONMENT: EnvValue.fromValue(stage),
        TEMPORAL_ADDRESS: EnvValue.fromValue(
          "temporal-temporal-server-service.temporal.svc.cluster.local:7233",
        ),
        TEMPORAL_METRICS_ADDRESS: EnvValue.fromValue("0.0.0.0:9464"),
        // Workflow workers are isolated to the stage they serve.
        TEMPORAL_NAMESPACE: EnvValue.fromValue(stage),
        TEMPORAL_WORKER_DEPLOYMENT_NAME: EnvValue.fromValue(
          `scout-${stage}-workflows`,
        ),
      },
    }),
  );
  container.mount(
    "/tmp",
    Volume.fromEmptyDir(chart, `${name}-tmp`, `${component}-tmp`),
  );

  new Service(chart, `${name}-metrics-service`, {
    metadata: {
      labels: { component },
    },
    selector: deployment,
    ports: [{ name: "metrics", port: 9464 }],
  });
  createServiceMonitor(chart, {
    name: `${name}-metrics`,
    matchLabels: { component },
  });

  return deployment;
}
