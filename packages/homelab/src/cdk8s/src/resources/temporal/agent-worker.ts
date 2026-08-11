import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import {
  Cpu,
  Deployment,
  DeploymentStrategy,
  type EnvValue,
  Service,
  type ServiceAccount,
  Volume,
} from "cdk8s-plus-31";
import {
  setRevisionHistoryLimit,
  withCommonProps,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { createServiceMonitor } from "@shepherdjerred/homelab/cdk8s/src/misc/service-monitor.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { temporalWorkerHealthProbes } from "./worker-health.ts";

type CreateTemporalAgentWorkerProps = {
  serviceAccount: ServiceAccount;
  envVariables: Record<string, EnvValue>;
};

/**
 * Run provider-controlled report-only subprocesses outside the core worker.
 *
 * The service account receives the audit reader ClusterRole but none of the
 * namespace-scoped exec roles required by deterministic maintenance and
 * canary activities. The deployment also receives only provider auth and
 * non-secret evidence endpoints; email delivery runs on the core queue and
 * the public repository checkout is unauthenticated. These controls make the
 * runtime enforce the report-only boundary even if a provider disregards its
 * prompt.
 */
export function createTemporalAgentWorker(
  chart: Chart,
  props: CreateTemporalAgentWorkerProps,
): Deployment {
  const deployment = new Deployment(chart, "temporal-agent-worker", {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    serviceAccount: props.serviceAccount,
    automountServiceAccountToken: true,
    securityContext: {
      fsGroup: 1000,
    },
    podMetadata: {
      labels: {
        app: "temporal-worker",
        component: "agent-worker",
      },
    },
  });

  setRevisionHistoryLimit(deployment, 5);

  const container = deployment.addContainer(
    withCommonProps({
      name: "temporal-agent-worker",
      image: `ghcr.io/shepherdjerred/temporal-worker:${versions["shepherdjerred/temporal-worker"]}`,
      ports: [
        { number: 9464, name: "metrics" },
        { number: 9465, name: "app-metrics" },
      ],
      securityContext: {
        user: 1000,
        group: 1000,
        readOnlyRootFilesystem: false,
      },
      resources: {
        cpu: {
          request: Cpu.millis(500),
          limit: Cpu.millis(1500),
        },
        memory: {
          request: Size.gibibytes(3),
          limit: Size.gibibytes(6),
        },
      },
      ...temporalWorkerHealthProbes(),
      envVariables: props.envVariables,
    }),
  );

  const tmpVolume = Volume.fromEmptyDir(
    chart,
    "temporal-agent-worker-tmp",
    "agent-tmp",
  );
  container.mount("/tmp", tmpVolume);

  new Service(chart, "temporal-agent-worker-metrics-service", {
    selector: deployment,
    metadata: {
      labels: { app: "temporal-agent-worker-metrics" },
    },
    ports: [{ port: 9464, name: "metrics" }],
  });

  createServiceMonitor(chart, {
    name: "temporal-agent-worker-metrics",
    matchLabels: { app: "temporal-agent-worker-metrics" },
  });

  new Service(chart, "temporal-agent-worker-app-metrics-service", {
    metadata: {
      name: "temporal-agent-worker-app-metrics",
      labels: { app: "temporal-agent-worker-app-metrics" },
    },
    selector: deployment,
    ports: [{ name: "app-metrics", port: 9465, targetPort: 9465 }],
  });

  createServiceMonitor(chart, {
    name: "temporal-agent-worker-app-metrics",
    port: "app-metrics",
    interval: "30s",
    matchLabels: { app: "temporal-agent-worker-app-metrics" },
  });

  return deployment;
}
