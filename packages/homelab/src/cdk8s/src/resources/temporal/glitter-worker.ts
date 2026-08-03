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

type CreateTemporalGlitterWorkerProps = {
  serviceAccount: ServiceAccount;
  envVariables: Record<string, EnvValue>;
};

export function createTemporalGlitterWorker(
  chart: Chart,
  props: CreateTemporalGlitterWorkerProps,
): Deployment {
  const deployment = new Deployment(chart, "temporal-glitter-worker", {
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
        component: "glitter-worker",
      },
    },
  });

  setRevisionHistoryLimit(deployment, 5);

  const container = deployment.addContainer(
    withCommonProps({
      name: "temporal-glitter-worker",
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
          request: Size.gibibytes(2),
          limit: Size.gibibytes(6),
        },
      },
      ...temporalWorkerHealthProbes(),
      envVariables: props.envVariables,
    }),
  );

  const tmpVolume = Volume.fromEmptyDir(
    chart,
    "temporal-glitter-worker-tmp",
    "glitter-tmp",
  );
  container.mount("/tmp", tmpVolume);

  new Service(chart, "temporal-glitter-worker-metrics-service", {
    selector: deployment,
    metadata: {
      labels: { app: "temporal-glitter-worker-metrics" },
    },
    ports: [{ port: 9464, name: "metrics" }],
  });

  createServiceMonitor(chart, {
    name: "temporal-glitter-worker-metrics",
    matchLabels: { app: "temporal-glitter-worker-metrics" },
  });

  new Service(chart, "temporal-glitter-worker-app-metrics-service", {
    metadata: {
      name: "temporal-glitter-worker-app-metrics",
      labels: { app: "temporal-glitter-worker-app-metrics" },
    },
    selector: deployment,
    ports: [{ name: "app-metrics", port: 9465, targetPort: 9465 }],
  });

  createServiceMonitor(chart, {
    name: "temporal-glitter-worker-app-metrics",
    port: "app-metrics",
    interval: "30s",
    matchLabels: { app: "temporal-glitter-worker-app-metrics" },
  });

  return deployment;
}
