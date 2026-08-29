import type { Chart } from "cdk8s";
import type { Size } from "cdk8s";
import {
  type Cpu,
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

export type TemporalDomainWorkerProps = {
  name: string;
  component: string;
  syncWave?: number;
  envVariables: Record<string, EnvValue>;
  ports?: { number: number; name: string }[];
  cpuRequest: Cpu;
  memoryRequest: Size;
  cpuLimit?: Cpu;
  memoryLimit?: Size;
  automountServiceAccountToken?: boolean;
  serviceAccount?: ServiceAccount;
  volumeMounts?: readonly {
    path: string;
    volume: Volume;
    readOnly?: boolean;
  }[];
};

export function createTemporalDomainWorker(
  chart: Chart,
  props: TemporalDomainWorkerProps,
): Deployment {
  const serviceAccount =
    props.serviceAccount ??
    new ServiceAccount(chart, `${props.name}-service-account`, {
      metadata: {
        name: props.name,
        ...(props.syncWave === undefined
          ? {}
          : {
              annotations: {
                "argocd.argoproj.io/sync-wave": String(props.syncWave),
              },
            }),
      },
    });
  const deployment = new Deployment(chart, props.name, {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    serviceAccount,
    automountServiceAccountToken: props.automountServiceAccountToken ?? false,
    securityContext: { fsGroup: 1000 },
    podMetadata: {
      labels: { app: "temporal-worker", component: props.component },
    },
    metadata:
      props.syncWave === undefined
        ? undefined
        : {
            annotations: {
              "argocd.argoproj.io/sync-wave": String(props.syncWave),
            },
          },
  });
  setRevisionHistoryLimit(deployment, 5);

  const container = deployment.addContainer(
    withCommonProps({
      name: props.name,
      image: `ghcr.io/shepherdjerred/temporal-worker:${versions["shepherdjerred/temporal-worker"]}`,
      ports: [
        { number: 9464, name: "metrics" },
        { number: 9465, name: "app-metrics" },
        ...(props.ports ?? []),
      ],
      securityContext: {
        user: 1000,
        group: 1000,
        readOnlyRootFilesystem: false,
      },
      resources: {
        cpu: {
          request: props.cpuRequest,
          ...(props.cpuLimit === undefined ? {} : { limit: props.cpuLimit }),
        },
        memory: {
          request: props.memoryRequest,
          ...(props.memoryLimit === undefined
            ? {}
            : { limit: props.memoryLimit }),
        },
      },
      ...temporalWorkerHealthProbes(),
      envVariables: props.envVariables,
    }),
  );
  container.mount(
    "/tmp",
    Volume.fromEmptyDir(chart, `${props.name}-tmp`, `${props.component}-tmp`),
  );
  for (const mount of props.volumeMounts ?? []) {
    container.mount(mount.path, mount.volume, { readOnly: mount.readOnly });
  }

  const selector = Pods.select(chart, `${props.name}-selector`, {
    labels: { component: props.component },
  });
  const sdkMetricsComponent = `${props.component}-sdk-metrics`;
  new Service(chart, `${props.name}-metrics-service`, {
    selector,
    metadata: { labels: { component: sdkMetricsComponent } },
    ports: [{ port: 9464, name: "metrics" }],
  });
  createServiceMonitor(chart, {
    name: `${props.name}-metrics`,
    matchLabels: { component: sdkMetricsComponent },
  });

  const appMetricsComponent = `${props.component}-app-metrics`;
  new Service(chart, `${props.name}-app-metrics-service`, {
    selector,
    metadata: {
      name: `${props.name}-app-metrics`,
      labels: { component: appMetricsComponent },
    },
    ports: [{ name: "app-metrics", port: 9465, targetPort: 9465 }],
  });
  createServiceMonitor(chart, {
    name: `${props.name}-app-metrics`,
    port: "app-metrics",
    interval: "30s",
    matchLabels: { component: appMetricsComponent },
  });

  return deployment;
}
