import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import {
  Cpu,
  Deployment,
  DeploymentStrategy,
  type EnvValue,
  Pods,
  Service,
  ServiceAccount,
  Volume,
} from "cdk8s-plus-31";
import {
  setRevisionHistoryLimit,
  withCommonProps,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { createServiceMonitor } from "@shepherdjerred/homelab/cdk8s/src/misc/service-monitor.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { temporalWorkerHealthProbes } from "./worker-health.ts";

type GlitterWorkerDefinition = {
  name: "temporal-glitter-context-worker" | "temporal-glitter-corpus-worker";
  component: "glitter-context-worker" | "glitter-corpus-worker";
  envVariables: Record<string, EnvValue>;
  cpuRequest: Cpu;
  cpuLimit: Cpu;
  memoryRequest: Size;
  memoryLimit: Size;
};

function createGlitterWorker(
  chart: Chart,
  definition: GlitterWorkerDefinition,
): Deployment {
  const serviceAccount = new ServiceAccount(
    chart,
    `${definition.name}-service-account`,
    { metadata: { name: definition.name } },
  );
  const deployment = new Deployment(chart, definition.name, {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    metadata: {
      annotations: { "argocd.argoproj.io/sync-wave": "2" },
    },
    serviceAccount,
    automountServiceAccountToken: false,
    securityContext: { fsGroup: 1000 },
    podMetadata: {
      labels: {
        app: "temporal-worker",
        component: definition.component,
      },
    },
  });

  setRevisionHistoryLimit(deployment, 5);

  const container = deployment.addContainer(
    withCommonProps({
      name: definition.name,
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
          request: definition.cpuRequest,
          limit: definition.cpuLimit,
        },
        memory: {
          request: definition.memoryRequest,
          limit: definition.memoryLimit,
        },
      },
      ...temporalWorkerHealthProbes(),
      envVariables: definition.envVariables,
    }),
  );

  const tmpVolume = Volume.fromEmptyDir(
    chart,
    `${definition.name}-tmp`,
    `${definition.component}-tmp`,
  );
  container.mount("/tmp", tmpVolume);

  const selector = Pods.select(chart, `${definition.name}-selector`, {
    labels: { component: definition.component },
  });
  const sdkMetricsComponent = `${definition.component}-sdk-metrics`;
  new Service(chart, `${definition.name}-metrics-service`, {
    selector,
    metadata: { labels: { component: sdkMetricsComponent } },
    ports: [{ port: 9464, name: "metrics" }],
  });
  createServiceMonitor(chart, {
    name: `${definition.name}-metrics`,
    matchLabels: { component: sdkMetricsComponent },
  });

  const appMetricsComponent = `${definition.component}-app-metrics`;
  new Service(chart, `${definition.name}-app-metrics-service`, {
    metadata: {
      name: `${definition.name}-app-metrics`,
      labels: { component: appMetricsComponent },
    },
    selector,
    ports: [{ name: "app-metrics", port: 9465, targetPort: 9465 }],
  });
  createServiceMonitor(chart, {
    name: `${definition.name}-app-metrics`,
    port: "app-metrics",
    interval: "30s",
    matchLabels: { component: appMetricsComponent },
  });

  return deployment;
}

export function createTemporalGlitterWorkers(
  chart: Chart,
  props: {
    corpusEnvVariables: Record<string, EnvValue>;
    contextEnvVariables: Record<string, EnvValue>;
  },
): {
  corpusDeployment: Deployment;
  contextDeployment: Deployment;
} {
  return {
    corpusDeployment: createGlitterWorker(chart, {
      name: "temporal-glitter-corpus-worker",
      component: "glitter-corpus-worker",
      envVariables: props.corpusEnvVariables,
      cpuRequest: Cpu.millis(250),
      cpuLimit: Cpu.units(1),
      memoryRequest: Size.mebibytes(512),
      memoryLimit: Size.gibibytes(3),
    }),
    contextDeployment: createGlitterWorker(chart, {
      name: "temporal-glitter-context-worker",
      component: "glitter-context-worker",
      envVariables: props.contextEnvVariables,
      cpuRequest: Cpu.millis(750),
      cpuLimit: Cpu.units(2),
      memoryRequest: Size.mebibytes(2560),
      memoryLimit: Size.gibibytes(6),
    }),
  };
}
