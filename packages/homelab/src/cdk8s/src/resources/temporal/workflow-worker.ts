import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import { Cpu, type Deployment, EnvValue } from "cdk8s-plus-31";
import { createTemporalDomainWorker } from "./domain-worker.ts";

const DEPLOYMENT_NAME = "monorepo-central-workflows";

function createWorkflowWorker(
  chart: Chart,
  props: {
    serverServiceName: string;
    track: "stable" | "candidate";
  },
): Deployment {
  return createTemporalDomainWorker(chart, {
    name: `temporal-workflows-${props.track}`,
    component: `central-workflows-${props.track}`,
    podLabels: { "worker-family": "central-workflows" },
    imageKey: `shepherdjerred/temporal-worker/workflows/${props.track}`,
    cpuRequest: Cpu.millis(250),
    cpuLimit: Cpu.millis(1000),
    memoryRequest: Size.mebibytes(512),
    memoryLimit: Size.gibibytes(2),
    automountServiceAccountToken: false,
    envVariables: {
      TEMPORAL_ADDRESS: EnvValue.fromValue(`${props.serverServiceName}:7233`),
      TEMPORAL_NAMESPACE: EnvValue.fromValue("default"),
      TEMPORAL_METRICS_ADDRESS: EnvValue.fromValue("0.0.0.0:9464"),
      TEMPORAL_WORKER_ROLE: EnvValue.fromValue("workflows"),
      TEMPORAL_WORKER_DEPLOYMENT_NAME: EnvValue.fromValue(DEPLOYMENT_NAME),
      ENVIRONMENT: EnvValue.fromValue("production"),
      TELEMETRY_ENABLED: EnvValue.fromValue("true"),
      OTLP_ENDPOINT: EnvValue.fromValue(
        "http://tempo.tempo.svc.cluster.local:4318",
      ),
      TELEMETRY_SERVICE_NAME: EnvValue.fromValue("temporal-central-workflows"),
    },
  });
}

export function createTemporalWorkflowWorkers(
  chart: Chart,
  props: { serverServiceName: string },
): { stable: Deployment; candidate: Deployment } {
  return {
    stable: createWorkflowWorker(chart, { ...props, track: "stable" }),
    candidate: createWorkflowWorker(chart, { ...props, track: "candidate" }),
  };
}
