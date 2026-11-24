import {
  TEMPORAL_SDK_METRICS_PORT,
  temporalMetricsAddressEnv,
} from "@shepherdjerred/homelab/cdk8s/src/resources/temporal/telemetry.ts";
import { temporalAddressEnv } from "@shepherdjerred/homelab/cdk8s/src/resources/temporal/address.ts";
import type { Chart } from "cdk8s";
import { Duration, Size } from "cdk8s";
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
import type { Stage } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/scout.ts";

/**
 * Scout's stage workflow worker stays outside `createTemporalDomainWorker`.
 * That helper describes a worker built from the shared Temporal worker image;
 * this one is a Delivery worker-rollout candidate of the Scout image and
 * differs in every part the helper fixes:
 *
 * - image `scout-for-lol` and an `sh -c` command that prepares the SWC cache,
 *   instead of the chart-selected Temporal image and its entrypoint;
 * - no ServiceAccount (the pod uses the namespace default with no token);
 * - one readiness probe that requires a live workflow-task poller on the SDK
 *   metrics port, instead of the `/healthz` probes on the app-metrics port;
 * - a read-only root filesystem that must run as non-root;
 * - only the SDK metrics port, selected through the Deployment, labelled with
 *   the worker's own component and without namespace relabelling or an
 *   app-metrics Service.
 *
 * Bending the helper to emit this would add an opt-out for nearly each of its
 * fields, so the two share only their Temporal client environment.
 */
export function createScoutWorkflowWorker(
  chart: Chart,
  stage: Stage,
): Deployment {
  const track = "candidate";
  const component = `scout-${stage}-workflows-${track}`;
  const name = `scout-workflow-worker-${track}`;
  const deployment = new Deployment(chart, name, {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    automountServiceAccountToken: false,
    securityContext: { fsGroup: 1000 },
    metadata: {
      annotations: {
        // This recipe is expanded only from the frozen PostgreSQL pool.
        "argocd.argoproj.io/sync-wave": "-2",
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
      image:
        '{{ required `Delivery requires image:scout-for-lol` (get (get (.Values.delivery | default dict) "images" | default dict) "scout-for-lol") }}',
      // @swc/core 1.16.22 materializes its native addon in a private cache.
      // The pod-private emptyDir is mode 0777, which that check rejects, so
      // the process creates a 0700 directory and uses the library's documented
      // isolated-runtime opt-out. The addon file itself still has to be private.
      command: ["sh", "-c"],
      args: [
        "mkdir -p /tmp/swc-native && chmod 700 /tmp/swc-native && exec bun run src/temporal/workflow-worker.ts",
      ],
      ports: [
        {
          name: "metrics",
          number: TEMPORAL_SDK_METRICS_PORT,
          protocol: Protocol.TCP,
        },
      ],
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
        ...temporalAddressEnv(),
        SWC_NATIVE_BINDING_CACHE: EnvValue.fromValue("/tmp/swc-native"),
        SWC_NATIVE_BINDING_CACHE_SKIP_SECURITY_CHECK: EnvValue.fromValue("1"),
        ...temporalMetricsAddressEnv(),
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
    ports: [{ name: "metrics", port: TEMPORAL_SDK_METRICS_PORT }],
  });
  createServiceMonitor(chart, {
    name: `${name}-metrics`,
    matchLabels: { component },
  });

  return deployment;
}
